import envPaths from 'env-paths'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const APP_NAME = 'grailed-bot'

export interface Config {
  minPrice: number
  maxPrice: number | null
  brands: string[]
  categories: string[]
  discordWebhookUrl: string | null
  scanIntervalMinutes: number
  dataDir: string
  grailedApiUrl: string
  requestDelayMs: number
  velocityThresholdHours: number
}

const defaultConfig: Config = {
  minPrice: 150,
  maxPrice: null,
  brands: [],
  categories: ['clothing', 'shoes', 'accessories'],
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || null,
  scanIntervalMinutes: 15,
  dataDir: envPaths(APP_NAME).data,
  grailedApiUrl: 'https://www.grailed.com/api/graphql',
  requestDelayMs: 2000,
  velocityThresholdHours: 24,
}

const configPath = join(defaultConfig.dataDir, 'config.json')

export function loadConfig(): Config {
  if (existsSync(configPath)) {
    try {
      const saved = JSON.parse(readFileSync(configPath, 'utf-8'))
      return { ...defaultConfig, ...saved }
    } catch {
      console.warn('Failed to load config, using defaults')
    }
  }
  return defaultConfig
}

export function saveConfig(config: Partial<Config>): void {
  const current = loadConfig()
  const updated = { ...current, ...config }
  mkdirSync(defaultConfig.dataDir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(updated, null, 2))
}

export function getConfig(): Config {
  return loadConfig()
}

export function initDataDir(): void {
  mkdirSync(defaultConfig.dataDir, { recursive: true })
}
