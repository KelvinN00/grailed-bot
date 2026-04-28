#!/usr/bin/env node
import { initDataDir, getConfig, saveConfig } from './config.js'
import { fetchAllListings, filterByBrands, filterByPrice, sortByVelocity } from './scraper.js'
import { VelocityTracker, formatVelocity } from './tracker.js'
import { DiscordNotifier } from './notifier.js'
import { getSoldListingsScraper, type MarketComparison } from './soldListings.js'
import type { FilterOptions, VelocityResult } from './types.js'

interface RunOptions {
  brands?: string[]
  minPrice?: number
  maxPrice?: number | null
  notify?: boolean
  verbose?: boolean
  dryRun?: boolean
}

export class GrailedArbitrageBot {
  private tracker: VelocityTracker
  private notifier: DiscordNotifier
  private config: ReturnType<typeof getConfig>

  constructor() {
    initDataDir()
    this.config = getConfig()
    this.tracker = new VelocityTracker()
    this.notifier = new DiscordNotifier()
  }

  async run(options: RunOptions = {}): Promise<VelocityResult[]> {
    const startTime = Date.now()

    if (options.verbose) {
      console.log('🔍 Starting Grailed arbitrage scan...')
      console.log(`   Min price: $${options.minPrice ?? this.config.minPrice}`)
      console.log(`   Brands: ${options.brands?.length ? options.brands.join(', ') : 'All'}`)
    }

    const filterOptions: FilterOptions = {
      minPrice: options.minPrice ?? this.config.minPrice,
      maxPrice: options.maxPrice ?? this.config.maxPrice,
      brands: options.brands?.length ? options.brands : this.config.brands,
      onlyAvailable: false,
    }

    try {
      if (options.verbose) console.log('📡 Fetching listings from Grailed...')
      const items = await fetchAllListings(filterOptions, 3)

      if (options.verbose) console.log(`   Found ${items.length} items`)

      let filteredItems = items
      if (options.brands?.length) {
        filteredItems = filterByBrands(items, options.brands)
        if (options.verbose) console.log(`   After brand filter: ${filteredItems.length} items`)
      }

      filteredItems = filterByPrice(
        filteredItems,
        options.minPrice ?? this.config.minPrice,
        options.maxPrice ?? this.config.maxPrice
      )
      if (options.verbose) console.log(`   After price filter: ${filteredItems.length} items`)

      if (options.verbose) console.log('📊 Analyzing item velocity...')
      const results = this.tracker.analyze(filteredItems)

      const sortedResults = this.sortResults(results)

      if (options.verbose || !options.dryRun) {
        this.displayResults(sortedResults)
      }

      if (options.notify !== false && !options.dryRun) {
        await this.notifier.sendAlert(sortedResults)
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      if (options.verbose) {
        console.log(`\n✅ Scan complete in ${duration}s`)
      }

      return sortedResults

    } catch (error) {
      console.error('❌ Scan failed:', error)
      throw error
    }
  }

  async runOnce(options: RunOptions = {}): Promise<VelocityResult[]> {
    return this.run({ ...options, notify: true })
  }

  async runContinuous(intervalMinutes: number = this.config.scanIntervalMinutes): Promise<void> {
    console.log(`🤖 Starting continuous monitoring (every ${intervalMinutes} minutes)`)
    console.log('Press Ctrl+C to stop\n')

    await this.runOnce({ verbose: true })

    const intervalMs = intervalMinutes * 60 * 1000

    while (true) {
      await sleep(intervalMs)
      console.log(`\n[${new Date().toISOString()}] Running scheduled scan...`)
      await this.runOnce({ verbose: false })
    }
  }

  async findDeals(options: { minDealScore?: number; brands?: string[] } = {}): Promise<MarketComparison[]> {
    const scraper = getSoldListingsScraper()

    console.log('🔍 Finding deals using sold listings data...')

    const filterOptions: FilterOptions = {
      minPrice: this.config.minPrice,
      maxPrice: this.config.maxPrice,
      brands: options.brands?.length ? options.brands : this.config.brands,
      onlyAvailable: true,
    }

    const activeItems = await fetchAllListings(filterOptions, 3)
    console.log(`   Found ${activeItems.length} active listings`)

    const deals = await scraper.findDeals(activeItems, {
      minDealScore: options.minDealScore || 60,
    })

    console.log(`   Found ${deals.length} potential deals`)

    if (deals.length > 0) {
      console.log('\n💰 Top Deals:')
      console.log('─'.repeat(60))
      for (const deal of deals.slice(0, 10)) {
        const arrow = deal.priceVsMarket === 'below' ? '⬇️' : deal.priceVsMarket === 'above' ? '⬆️' : '➡️'
        console.log(`   ${arrow} ${deal.item.brand} - $${deal.item.price}`)
        console.log(`      Market avg: $${Math.round(deal.marketData!.avgSoldPrice)}`)
        console.log(`      Deal score: ${deal.dealScore}/100`)
        console.log(`      ${deal.priceDifferencePercent > 0 ? '+' : ''}${Math.round(deal.priceDifferencePercent)}% vs market`)
        console.log('')
      }
    }

    return deals
  }

  async fetchSoldListings(
    query: string,
    options: { brand?: string; maxResults?: number } = {}
  ): Promise<ReturnType<SoldListingsScraper['fetchSoldListings']>> {
    const scraper = getSoldListingsScraper()
    return scraper.fetchSoldListings(query, options)
  }

  getHighVelocityItems(minScore: 'high' | 'medium' = 'medium') {
    return this.tracker.getHighVelocityItems(minScore)
  }

  clearData(): void {
    this.tracker.clear()
    console.log('🗑️  Cleared all tracking data')
  }

  private sortResults(results: VelocityResult[]): VelocityResult[] {
    return results.sort((a, b) => {
      const scorePriority: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 }
      const aScore = scorePriority[a.velocity] ?? 0
      const bScore = scorePriority[b.velocity] ?? 0

      if (aScore !== bScore) return bScore - aScore

      if (a.isNew && !b.isNew) return -1
      if (!a.isNew && b.isNew) return 1

      if (a.item.likesCount !== b.item.likesCount) {
        return b.item.likesCount - a.item.likesCount
      }

      return b.item.price - a.item.price
    })
  }

  private displayResults(results: VelocityResult[]): void {
    const newItems = results.filter(r => r.isNew)
    const soldItems = results.filter(r => r.isSold)
    const highVelocity = results.filter(r => r.velocity === 'high')

    console.log('\n📈 Results Summary')
    console.log('─'.repeat(50))
    console.log(`Total items: ${results.length}`)
    console.log(`New listings: ${newItems.length}`)
    console.log(`Sold items: ${soldItems.length}`)
    console.log(`High velocity: ${highVelocity.length}`)

    if (newItems.length > 0) {
      console.log('\n🆕 New Listings:')
      for (const result of newItems.slice(0, 5)) {
        console.log(`   ${result.item.brand} - $${result.item.price} - ${result.item.title.slice(0, 50)}...`)
      }
      if (newItems.length > 5) {
        console.log(`   ... and ${newItems.length - 5} more`)
      }
    }

    if (soldItems.length > 0) {
      console.log('\n💰 Recently Sold:')
      for (const result of soldItems.slice(0, 5)) {
        const timeStr = formatVelocity(result)
        console.log(`   ${result.item.brand} - $${result.item.price} - ${timeStr}`)
      }
    }

    if (highVelocity.length > 0) {
      console.log('\n🚀 High Velocity Items:')
      for (const result of highVelocity.slice(0, 5)) {
        console.log(`   ${result.item.brand} - $${result.item.price} - ${formatVelocity(result)}`)
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'run'

  const bot = new GrailedArbitrageBot()

  switch (command) {
    case 'run':
    case 'scan': {
      const brands = parseBrandsArg(args.find(a => a.startsWith('--brands=')))
      const minPrice = parseIntArg(args.find(a => a.startsWith('--min=')))
      const maxPrice = parseIntArg(args.find(a => a.startsWith('--max=')))
      const verbose = args.includes('--verbose') || args.includes('-v')
      const noNotify = args.includes('--no-notify')

      await bot.runOnce({
        brands,
        minPrice,
        maxPrice,
        verbose,
        notify: !noNotify,
      })
      break
    }

    case 'find-deals': {
      const minDealScore = parseIntArg(args.find(a => a.startsWith('--min-score='))) || 60
      const brands = parseBrandsArg(args.find(a => a.startsWith('--brands=')))
      await bot.findDeals({ minDealScore, brands })
      break
    }

    case 'watch':
    case 'monitor': {
      const interval = parseIntArg(args.find(a => a.startsWith('--interval='))) ?? 15
      await bot.runContinuous(interval)
      break
    }

    case 'test-discord': {
      const notifier = new DiscordNotifier()
      const success = await notifier.sendTestMessage()
      process.exit(success ? 0 : 1)
    }

    case 'config': {
      if (args.includes('--set-webhook')) {
        const url = args[args.indexOf('--set-webhook') + 1]
        if (url) {
          saveConfig({ discordWebhookUrl: url })
          console.log('✅ Discord webhook configured')
        } else {
          console.error('Usage: --set-webhook <url>')
          process.exit(1)
        }
      }

      if (args.includes('--add-brand')) {
        const brand = args[args.indexOf('--add-brand') + 1]
        if (brand) {
          const config = getConfig()
          const brands = [...new Set([...config.brands, brand])]
          saveConfig({ brands })
          console.log(`✅ Added brand: ${brand}`)
        }
      }

      if (args.includes('--set-min-price')) {
        const price = parseInt(args[args.indexOf('--set-min-price') + 1])
        if (!isNaN(price)) {
          saveConfig({ minPrice: price })
          console.log(`✅ Set minimum price: $${price}`)
        }
      }

      const config = getConfig()
      console.log('\n📋 Current Configuration:')
      console.log(`   Data directory: ${config.dataDir}`)
      console.log(`   Discord webhook: ${config.discordWebhookUrl ? 'Configured' : 'Not set'}`)
      console.log(`   Min price: $${config.minPrice}`)
      console.log(`   Max price: ${config.maxPrice ?? 'Unlimited'}`)
      console.log(`   Brands: ${config.brands.length ? config.brands.join(', ') : 'All'}`)
      console.log(`   Scan interval: ${config.scanIntervalMinutes} minutes`)
      break
    }

    case 'clear':
    case 'reset': {
      bot.clearData()
      break
    }

    case 'help':
    default:
      console.log(`
Grailed Arbitrage Bot

Commands:
  run, scan              Run a single scan
  find-deals             Find underpriced items vs sold prices
  watch, monitor         Run continuous monitoring
  test-discord           Test Discord webhook
  config                 Show/edit configuration
  clear, reset           Clear tracking data
  help                   Show this help

Options:
  --brands=BRAND1,BRAND2 Filter by brand names
  --min=PRICE            Minimum price (default: 150)
  --max=PRICE            Maximum price
  --min-score=SCORE      Minimum deal score (default: 60)
  --interval=MINUTES     Scan interval for watch mode (default: 15)
  --verbose, -v          Show detailed output
  --no-notify            Skip Discord notifications
  --set-webhook URL      Configure Discord webhook
  --add-brand BRAND      Add brand to filter list
  --set-min-price PRICE  Set default minimum price

Examples:
  bun run grailed-bot scan --brands=Nike,Supreme --min=200 -v
  bun run grailed-bot find-deals --brands=Kapital --min-score=70
  bun run grailed-bot watch --interval=30
  bun run grailed-bot config --set-webhook https://discord.com/api/webhooks/...
`)
  }
}

function parseBrandsArg(arg: string | undefined): string[] | undefined {
  if (!arg) return undefined
  const match = arg.match(/--brands=(.+)/)
  if (!match) return undefined
  return match[1].split(',').map(b => b.trim()).filter(Boolean)
}

function parseIntArg(arg: string | undefined): number | undefined {
  if (!arg) return undefined
  const match = arg.match(/=(\d+)/)
  if (!match) return undefined
  const num = parseInt(match[1], 10)
  return isNaN(num) ? undefined : num
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
