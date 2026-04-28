#!/usr/bin/env bun
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/bun'
import type { ServerWebSocket } from 'bun'
import { GrailedArbitrageBot } from '../../index.js'
import { getConfig, saveConfig } from '../../config.js'
import { VelocityTracker } from '../../tracker.js'
import { DiscordNotifier } from '../../notifier.js'
import { getSoldListingsScraper } from '../../soldListings.js'
import type { VelocityResult } from '../../types.js'

const app = new Hono()
const bot = new GrailedArbitrageBot()
const tracker = new VelocityTracker()

const clients = new Set<ServerWebSocket<unknown>>()

let scanState: {
  isScanning: boolean
  lastScan: Date | null
  results: VelocityResult[]
  error: string | null
} = {
  isScanning: false,
  lastScan: null,
  results: [],
  error: null,
}

app.use('*', cors())
app.use('*', logger())

app.get('/api/status', (c) => {
  const config = getConfig()
  return c.json({
    isScanning: scanState.isScanning,
    lastScan: scanState.lastScan?.toISOString() || null,
    itemCount: scanState.results.length,
    highVelocityCount: scanState.results.filter(r => r.velocity === 'high').length,
    newCount: scanState.results.filter(r => r.isNew).length,
    soldCount: scanState.results.filter(r => r.isSold).length,
    config: {
      minPrice: config.minPrice,
      maxPrice: config.maxPrice,
      brands: config.brands,
      discordConfigured: !!config.discordWebhookUrl,
    },
  })
})

app.get('/api/items', async (c) => {
  const filter = c.req.query('filter') || 'all'
  const search = c.req.query('search')?.toLowerCase() || ''
  const brand = c.req.query('brand')?.toLowerCase() || ''

  let items = scanState.results

  switch (filter) {
    case 'new':
      items = items.filter(r => r.isNew)
      break
    case 'sold':
      items = items.filter(r => r.isSold)
      break
    case 'high-velocity':
      items = items.filter(r => r.velocity === 'high')
      break
    case 'available':
      items = items.filter(r => !r.isSold)
      break
  }

  if (search) {
    const terms = search.split(/\s+/).filter(t => t.length > 0)
    items = items.filter(r => {
      const text = `${r.item.brand} ${r.item.title} ${r.item.category}`.toLowerCase()
      return terms.every(term => text.includes(term))
    })
  }

  if (brand) {
    items = items.filter(r => r.item.brand.toLowerCase().includes(brand))
  }

  return c.json(items)
})

app.get('/api/items/:id', (c) => {
  const id = c.req.param('id')
  const item = scanState.results.find(r => r.item.id === id)
  if (!item) return c.json({ error: 'Not found' }, 404)
  return c.json(item)
})

app.get('/api/search', async (c) => {
  const q = c.req.query('q')?.toLowerCase() || ''
  if (!q) return c.json({ error: 'Query required' }, 400)

  const terms = q.split(/\s+/).filter(t => t.length > 0)

  const matches = scanState.results.filter(r => {
    const text = `${r.item.brand} ${r.item.title} ${r.item.category} ${r.item.condition}`.toLowerCase()
    return terms.every(term => text.includes(term))
  })

  const grouped = matches.reduce((acc, result) => {
    const title = result.item.title
    const type = title.replace(new RegExp(`^${result.item.brand}\\s*`, 'i'), '').trim()
      .replace(/\b(vintage|rare|limited|edition|collaboration|collab)\b/gi, '').trim()
      .replace(/\s+/g, ' ')

    if (!acc[type]) {
      acc[type] = {
        type,
        brand: result.item.brand,
        count: 0,
        avgPrice: 0,
        soldCount: 0,
        avgTimeToSell: 0,
        items: [],
      }
    }

    const group = acc[type]
    group.count++
    group.avgPrice = (group.avgPrice * (group.count - 1) + result.item.price) / group.count
    if (result.isSold) {
      group.soldCount++
      if (result.hoursToSell) {
        group.avgTimeToSell = (group.avgTimeToSell * (group.soldCount - 1) + result.hoursToSell) / group.soldCount
      }
    }
    group.items.push(result)

    return acc
  }, {} as Record<string, any>)

  const results = Object.values(grouped).map((group: any) => ({
    ...group,
    velocityScore: Math.round((group.soldCount / group.count) * 100),
    sellThroughRate: group.count > 0 ? (group.soldCount / group.count) * 100 : 0,
  }))

  return c.json({
    query: q,
    totalMatches: matches.length,
    groups: results.sort((a: any, b: any) => b.velocityScore - a.velocityScore),
    items: matches,
  })
})

app.post('/api/scan', async (c) => {
  if (scanState.isScanning) {
    return c.json({ error: 'Scan already in progress' }, 409)
  }

  const body = await c.req.json().catch(() => ({}))
  const options = {
    brands: body.brands,
    minPrice: body.minPrice,
    maxPrice: body.maxPrice,
    notify: body.notify ?? false,
    verbose: false,
  }

  runScan(options)

  return c.json({ message: 'Scan started' })
})

app.get('/api/sold', async (c) => {
  const query = c.req.query('q') || ''
  const brand = c.req.query('brand') || ''
  const maxResults = parseInt(c.req.query('max') || '50')

  const scraper = getSoldListingsScraper()
  const sold = await scraper.fetchSoldListings(query, { brand, maxResults })

  return c.json(sold)
})

app.get('/api/market-data', (c) => {
  const scraper = getSoldListingsScraper()
  const data = scraper.loadMarketData()
  return c.json(data)
})

app.post('/api/deals', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const minDealScore = body.minDealScore || 60

  const deals = await bot.findDeals({ minDealScore })
  return c.json(deals)
})

app.get('/api/config', (c) => {
  const config = getConfig()
  return c.json({
    minPrice: config.minPrice,
    maxPrice: config.maxPrice,
    brands: config.brands,
    categories: config.categories,
    scanIntervalMinutes: config.scanIntervalMinutes,
    velocityThresholdHours: config.velocityThresholdHours,
    discordWebhookUrl: config.discordWebhookUrl ? '***configured***' : null,
  })
})

app.post('/api/config', async (c) => {
  const body = await c.req.json()
  saveConfig({
    minPrice: body.minPrice,
    maxPrice: body.maxPrice,
    brands: body.brands,
    scanIntervalMinutes: body.scanIntervalMinutes,
    velocityThresholdHours: body.velocityThresholdHours,
    discordWebhookUrl: body.discordWebhookUrl,
  })
  return c.json({ message: 'Config saved' })
})

app.post('/api/test-discord', async (c) => {
  const notifier = new DiscordNotifier()
  const success = await notifier.sendTestMessage()
  return c.json({ success })
})

app.post('/api/clear-data', (c) => {
  bot.clearData()
  scanState.results = []
  broadcast({ type: 'data-cleared' })
  return c.json({ message: 'Data cleared' })
})

app.get('/api/stats', (c) => {
  const allTime = tracker.getHighVelocityItems('low')

  const priceDistribution: Record<string, number> = {
    '150-300': 0, '300-500': 0, '500-750': 0, '750-1000': 0, '1000+': 0,
  }

  for (const r of scanState.results) {
    const p = r.item.price
    if (p < 300) priceDistribution['150-300']++
    else if (p < 500) priceDistribution['300-500']++
    else if (p < 750) priceDistribution['500-750']++
    else if (p < 1000) priceDistribution['750-1000']++
    else priceDistribution['1000+']++
  }

  const brandStats = scanState.results.reduce((acc, r) => {
    const brand = r.item.brand
    if (!acc[brand]) {
      acc[brand] = { count: 0, avgPrice: 0, soldCount: 0 }
    }
    acc[brand].count++
    acc[brand].avgPrice = (acc[brand].avgPrice * (acc[brand].count - 1) + r.item.price) / acc[brand].count
    if (r.isSold) acc[brand].soldCount++
    return acc
  }, {} as Record<string, { count: number; avgPrice: number; soldCount: number }>)

  const prices = scanState.results.map(r => r.item.price)

  return c.json({
    totalScanned: scanState.results.length,
    highVelocityCount: allTime.filter(r => r.velocity === 'high').length,
    mediumVelocityCount: allTime.filter(r => r.velocity === 'medium').length,
    soldCount: scanState.results.filter(r => r.isSold).length,
    brandStats,
    priceDistribution,
    priceRange: {
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      avg: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
    },
  })
})

app.use('/*', serveStatic({ root: './src/grailed-bot/web/client', index: 'index.html' }))

const server = Bun.serve({
  port: 3333,
  fetch: (req, server) => {
    const url = new URL(req.url)

    if (url.pathname === '/ws') {
      const success = server.upgrade(req)
      if (!success) {
        return new Response('WebSocket upgrade failed', { status: 400 })
      }
      return new Response(null)
    }

    return app.fetch(req, server)
  },
  websocket: {
    open(ws: ServerWebSocket<unknown>) {
      clients.add(ws)
      console.log('Client connected, total:', clients.size)

      ws.send(JSON.stringify({
        type: 'state',
        data: scanState,
      }))
    },
    close(ws: ServerWebSocket<unknown>) {
      clients.delete(ws)
      console.log('Client disconnected, total:', clients.size)
    },
    message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
      try {
        const data = JSON.parse(message.toString())
        handleClientMessage(ws, data)
      } catch {
        console.error('Invalid WebSocket message')
      }
    },
  },
})

function handleClientMessage(ws: ServerWebSocket<unknown>, data: { type: string; payload?: unknown }) {
  switch (data.type) {
    case 'start-scan':
      if (!scanState.isScanning) {
        runScan({ notify: false, verbose: false })
      }
      break
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }))
      break
  }
}

function broadcast(message: unknown) {
  const data = JSON.stringify(message)
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data)
    }
  }
}

async function runScan(options: { brands?: string[]; minPrice?: number; maxPrice?: number; notify?: boolean; verbose?: boolean }) {
  scanState.isScanning = true
  scanState.error = null
  broadcast({ type: 'scan-started' })

  try {
    const results = await bot.run(options)
    scanState.results = results
    scanState.lastScan = new Date()
    broadcast({ type: 'scan-completed', results })
  } catch (error) {
    scanState.error = error instanceof Error ? error.message : 'Unknown error'
    broadcast({ type: 'scan-error', error: scanState.error })
  } finally {
    scanState.isScanning = false
    broadcast({ type: 'state', data: scanState })
  }
}

console.log('🚀 Grailed Bot Dashboard running at http://localhost:3333')
console.log('Press Ctrl+C to stop')
