import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getConfig } from './config.js'
import type { GrailedItem, TrackedItem, VelocityResult, VelocityScore, Snapshot } from './types.js'

const SNAPSHOT_FILE = 'snapshot.json'
const TRACKED_FILE = 'tracked.json'

export class VelocityTracker {
  private dataDir: string

  constructor() {
    const config = getConfig()
    this.dataDir = config.dataDir
  }

  private get snapshotPath(): string {
    return join(this.dataDir, SNAPSHOT_FILE)
  }

  private get trackedPath(): string {
    return join(this.dataDir, TRACKED_FILE)
  }

  loadSnapshot(): Snapshot | null {
    if (!existsSync(this.snapshotPath)) return null
    try {
      const data = JSON.parse(readFileSync(this.snapshotPath, 'utf-8'))
      return {
        timestamp: new Date(data.timestamp),
        items: data.items.map((item: GrailedItem) => ({
          ...item,
          listedAt: new Date(item.listedAt),
          soldAt: item.soldAt ? new Date(item.soldAt) : null,
        })),
      }
    } catch {
      return null
    }
  }

  saveSnapshot(items: GrailedItem[]): void {
    const snapshot: Snapshot = {
      timestamp: new Date(),
      items,
    }
    writeFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2))
  }

  loadTrackedItems(): Map<string, TrackedItem> {
    if (!existsSync(this.trackedPath)) return new Map()
    try {
      const data = JSON.parse(readFileSync(this.trackedPath, 'utf-8'))
      const items = new Map<string, TrackedItem>()
      for (const [id, item] of Object.entries(data)) {
        items.set(id, {
          ...(item as TrackedItem),
          listedAt: new Date((item as TrackedItem).listedAt),
          soldAt: (item as TrackedItem).soldAt ? new Date((item as TrackedItem).soldAt!) : null,
          firstSeenAt: new Date((item as TrackedItem).firstSeenAt),
          lastSeenAt: new Date((item as TrackedItem).lastSeenAt),
        })
      }
      return items
    } catch {
      return new Map()
    }
  }

  saveTrackedItems(items: Map<string, TrackedItem>): void {
    const obj: Record<string, TrackedItem> = {}
    for (const [id, item] of items) {
      obj[id] = item
    }
    writeFileSync(this.trackedPath, JSON.stringify(obj, null, 2))
  }

  analyze(currentItems: GrailedItem[]): VelocityResult[] {
    const config = getConfig()
    const previousSnapshot = this.loadSnapshot()
    const trackedItems = this.loadTrackedItems()
    const now = new Date()
    const results: VelocityResult[] = []

    const currentById = new Map(currentItems.map(i => [i.id, i]))
    const previousById = previousSnapshot
      ? new Map(previousSnapshot.items.map(i => [i.id, i]))
      : new Map()

    for (const item of currentItems) {
      const previous = previousById.get(item.id)
      const tracked = trackedItems.get(item.id)

      let velocity: VelocityScore = 'unknown'
      let hoursToSell: number | null = null
      const isNew = !previous && !tracked

      if (tracked) {
        tracked.lastSeenAt = now
        tracked.checkCount++
        if (item.isSold && !tracked.isSold) {
          tracked.soldAt = now
        }
        tracked.isSold = item.isSold
        trackedItems.set(item.id, tracked)

        if (tracked.isSold && tracked.soldAt) {
          hoursToSell = (tracked.soldAt.getTime() - tracked.firstSeenAt.getTime()) / (1000 * 60 * 60)
          velocity = calculateVelocityScore(hoursToSell, config.velocityThresholdHours)
        }
      } else {
        const newTracked: TrackedItem = {
          ...item,
          firstSeenAt: now,
          lastSeenAt: now,
          checkCount: 1,
        }
        trackedItems.set(item.id, newTracked)
      }

      results.push({
        item,
        velocity,
        hoursToSell,
        isNew,
        isSold: item.isSold,
      })
    }

    if (previousSnapshot) {
      for (const prevItem of previousSnapshot.items) {
        if (!currentById.has(prevItem.id) && !prevItem.isSold) {
          const tracked = trackedItems.get(prevItem.id)
          if (tracked && !tracked.isSold) {
            tracked.isSold = true
            tracked.soldAt = now
            trackedItems.set(prevItem.id, tracked)

            const hoursToSell = (now.getTime() - tracked.firstSeenAt.getTime()) / (1000 * 60 * 60)
            const velocity = calculateVelocityScore(hoursToSell, config.velocityThresholdHours)

            results.push({
              item: { ...prevItem, isSold: true, soldAt: now },
              velocity,
              hoursToSell,
              isNew: false,
              isSold: true,
            })
          }
        }
      }
    }

    this.saveSnapshot(currentItems)
    this.saveTrackedItems(trackedItems)

    return results
  }

  getHighVelocityItems(minScore: VelocityScore = 'medium') {
    const tracked = this.loadTrackedItems()
    const results: VelocityResult[] = []
    const config = getConfig()

    for (const item of tracked.values()) {
      if (!item.isSold) continue

      const hoursToSell = item.soldAt
        ? (item.soldAt.getTime() - item.firstSeenAt.getTime()) / (1000 * 60 * 60)
        : null

      const velocity = hoursToSell ? calculateVelocityScore(hoursToSell, config.velocityThresholdHours) : 'unknown'

      const scorePriority: Record<VelocityScore, number> = {
        high: 3,
        medium: 2,
        low: 1,
        unknown: 0,
      }

      if (scorePriority[velocity] >= scorePriority[minScore]) {
        results.push({
          item,
          velocity,
          hoursToSell,
          isNew: false,
          isSold: true,
        })
      }
    }

    return results.sort((a, b) => (a.hoursToSell ?? Infinity) - (b.hoursToSell ?? Infinity))
  }

  clear(): void {
    if (existsSync(this.snapshotPath)) {
      writeFileSync(this.snapshotPath, JSON.stringify({ timestamp: new Date().toISOString(), items: [] }))
    }
    if (existsSync(this.trackedPath)) {
      writeFileSync(this.trackedPath, JSON.stringify({}))
    }
  }
}

function calculateVelocityScore(hoursToSell: number, thresholdHours: number): VelocityScore {
  if (hoursToSell <= thresholdHours / 2) return 'high'
  if (hoursToSell <= thresholdHours) return 'medium'
  if (hoursToSell <= thresholdHours * 3) return 'low'
  return 'unknown'
}

export function formatVelocity(result: VelocityResult): string {
  if (result.velocity === 'unknown') return 'Unknown'
  if (result.hoursToSell === null) return 'Not sold yet'

  const hours = result.hoursToSell
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

export function getVelocityColor(velocity: VelocityScore): number {
  switch (velocity) {
    case 'high': return 0x00ff00
    case 'medium': return 0xffff00
    case 'low': return 0xffa500
    default: return 0x808080
  }
}
