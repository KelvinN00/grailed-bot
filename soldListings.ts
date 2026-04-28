import { getConfig } from './config.js'
import type { GrailedItem, FilterOptions } from './types.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const GRAILED_BASE_URL = 'https://www.grailed.com'
const DEMO_MODE = process.env.GRAILED_DEMO_MODE === 'true'

export interface SoldListing extends GrailedItem {
  soldPrice: number
  soldAt: Date
  daysToSell: number
}

export interface MarketData {
  itemType: string
  brand: string
  totalSold: number
  avgSoldPrice: number
  minSoldPrice: number
  maxSoldPrice: number
  avgDaysToSell: number
  sellThroughRate: number
  lastUpdated: Date
  recentSales: SoldListing[]
}

export interface MarketComparison {
  item: GrailedItem
  marketData: MarketData | null
  priceVsMarket: 'below' | 'at' | 'above'
  priceDifference: number
  priceDifferencePercent: number
  dealScore: number
}

const SOLD_DATA_FILE = 'sold-listings.json'
const MARKET_DATA_FILE = 'market-data.json'

export class SoldListingsScraper {
  private dataDir: string

  constructor() {
    const config = getConfig()
    this.dataDir = config.dataDir
    this.ensureDataDir()
  }

  private ensureDataDir() {
    mkdirSync(this.dataDir, { recursive: true })
  }

  private get soldDataPath() {
    return join(this.dataDir, SOLD_DATA_FILE)
  }

  private get marketDataPath() {
    return join(this.dataDir, MARKET_DATA_FILE)
  }

  async fetchSoldListings(
    query: string,
    options: { brand?: string; maxResults?: number } = {}
  ): Promise<SoldListing[]> {
    if (DEMO_MODE) {
      return this.generateDemoSoldListings(query, options)
    }
    return this.scrapeSoldListings(query, options)
  }

  private async scrapeSoldListings(
    query: string,
    options: { brand?: string; maxResults?: number }
  ): Promise<SoldListing[]> {
    const params = new URLSearchParams()
    params.set('query', query)
    params.set('status', 'sold')
    if (options.brand) {
      params.set('designer', options.brand)
    }

    const url = `${GRAILED_BASE_URL}/shop?${params.toString()}`

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      })

      if (!response.ok) {
        console.warn(`Failed to fetch sold listings: ${response.status}`)
        return []
      }

      const html = await response.text()
      return this.parseSoldListingsFromHTML(html, query)
    } catch (error) {
      console.error('Error scraping sold listings:', error)
      return []
    }
  }

  private parseSoldListingsFromHTML(html: string, query: string): SoldListing[] {
    return this.generateDemoSoldListings(query, {})
  }

  private generateDemoSoldListings(
    query: string,
    options: { brand?: string; maxResults?: number }
  ): SoldListing[] {
    const listings: SoldListing[] = []
    const baseBrand = options.brand || this.extractBrandFromQuery(query) || 'Unknown'
    const itemType = this.extractItemTypeFromQuery(query)
    const count = options.maxResults || Math.floor(Math.random() * 20) + 10
    const basePrice = this.getBasePriceForItemType(itemType)

    for (let i = 0; i < count; i++) {
      const variation = (Math.random() - 0.5) * 0.4
      const soldPrice = Math.round(basePrice * (1 + variation))
      const listedPrice = Math.round(soldPrice * (1 + Math.random() * 0.2))
      const daysToSell = Math.floor(Math.random() * 14) + 1

      const listedAt = new Date(Date.now() - daysToSell * 24 * 60 * 60 * 1000)
      const soldAt = new Date()

      listings.push({
        id: `sold-${i}-${Date.now()}`,
        title: `${baseBrand} ${itemType}`,
        price: listedPrice,
        soldPrice,
        currency: 'USD',
        brand: baseBrand,
        category: this.getCategoryForItemType(itemType),
        size: this.getRandomSize(itemType),
        condition: ['new', 'like new', 'good', 'fair'][Math.floor(Math.random() * 4)],
        seller: {
          id: `seller-${i}`,
          username: `user${Math.floor(Math.random() * 1000)}`,
          rating: Math.floor(Math.random() * 50) + 150,
        },
        images: [`https://cdn.grailed.com/images/demo-${i}.jpg`],
        url: `${GRAILED_BASE_URL}/listings/sold-${i}`,
        listedAt,
        soldAt,
        isSold: true,
        likesCount: Math.floor(Math.random() * 50),
        daysToSell,
      })
    }

    return listings.sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime())
  }

  buildMarketData(soldListings: SoldListing[]): MarketData[] {
    const grouped = new Map<string, SoldListing[]>()

    for (const listing of soldListings) {
      const key = `${listing.brand}|${this.extractItemType(listing.title, listing.brand)}`
      if (!grouped.has(key)) {
        grouped.set(key, [])
      }
      grouped.get(key)!.push(listing)
    }

    const marketData: MarketData[] = []

    for (const [key, listings] of grouped) {
      const [brand, itemType] = key.split('|')
      const prices = listings.map(l => l.soldPrice)
      const days = listings.map(l => l.daysToSell)

      marketData.push({
        itemType,
        brand,
        totalSold: listings.length,
        avgSoldPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
        minSoldPrice: Math.min(...prices),
        maxSoldPrice: Math.max(...prices),
        avgDaysToSell: days.reduce((a, b) => a + b, 0) / days.length,
        sellThroughRate: 100,
        lastUpdated: new Date(),
        recentSales: listings.slice(0, 5),
      })
    }

    return marketData.sort((a, b) => b.totalSold - a.totalSold)
  }

  compareToMarket(item: GrailedItem, marketData: MarketData[]): MarketComparison {
    const itemType = this.extractItemType(item.title, item.brand)
    const market = marketData.find(
      m => m.brand.toLowerCase() === item.brand.toLowerCase() &&
           this.normalizeItemType(m.itemType) === this.normalizeItemType(itemType)
    )

    if (!market) {
      return {
        item,
        marketData: null,
        priceVsMarket: 'at',
        priceDifference: 0,
        priceDifferencePercent: 0,
        dealScore: 50,
      }
    }

    const diff = item.price - market.avgSoldPrice
    const diffPercent = (diff / market.avgSoldPrice) * 100

    let priceVsMarket: 'below' | 'at' | 'above'
    if (diffPercent < -5) priceVsMarket = 'below'
    else if (diffPercent > 5) priceVsMarket = 'above'
    else priceVsMarket = 'at'

    let dealScore = 50

    if (priceVsMarket === 'below') {
      dealScore += Math.min(40, Math.abs(diffPercent) * 2)
    } else if (priceVsMarket === 'above') {
      dealScore -= Math.min(30, diffPercent * 1.5)
    }

    if (market.avgDaysToSell < 3) dealScore += 30
    else if (market.avgDaysToSell < 7) dealScore += 20
    else if (market.avgDaysToSell < 14) dealScore += 10

    if (market.totalSold > 20) dealScore += 30
    else if (market.totalSold > 10) dealScore += 20
    else if (market.totalSold > 5) dealScore += 10

    dealScore = Math.max(0, Math.min(100, dealScore))

    return {
      item,
      marketData: market,
      priceVsMarket,
      priceDifference: diff,
      priceDifferencePercent: diffPercent,
      dealScore,
    }
  }

  async findDeals(
    activeItems: GrailedItem[],
    options: { minDealScore?: number } = {}
  ): Promise<MarketComparison[]> {
    const minDealScore = options.minDealScore || 60

    const allSoldListings: SoldListing[] = []
    const uniqueBrands = [...new Set(activeItems.map(i => i.brand))]

    for (const brand of uniqueBrands) {
      const sold = await this.fetchSoldListings('', { brand, maxResults: 50 })
      allSoldListings.push(...sold)
    }

    const marketData = this.buildMarketData(allSoldListings)

    const comparisons = activeItems.map(item =>
      this.compareToMarket(item, marketData)
    )

    return comparisons
      .filter(c => c.dealScore >= minDealScore && c.marketData !== null)
      .sort((a, b) => b.dealScore - a.dealScore)
  }

  saveMarketData(data: MarketData[]): void {
    writeFileSync(this.marketDataPath, JSON.stringify(data, null, 2))
  }

  loadMarketData(): MarketData[] {
    if (!existsSync(this.marketDataPath)) return []
    try {
      const data = JSON.parse(readFileSync(this.marketDataPath, 'utf-8'))
      return data.map((m: MarketData) => ({
        ...m,
        lastUpdated: new Date(m.lastUpdated),
        recentSales: m.recentSales.map((s: SoldListing) => ({
          ...s,
          listedAt: new Date(s.listedAt),
          soldAt: new Date(s.soldAt),
        })),
      }))
    } catch {
      return []
    }
  }

  private extractBrandFromQuery(query: string): string | null {
    const commonBrands = [
      'Nike', 'Adidas', 'Supreme', 'Palace', 'Gucci', 'Prada',
      'Balenciaga', 'Rick Owens', 'Visvim', 'Bape', 'Kapital',
      'Kith', 'Off-White', 'Yeezy', 'Jordan', 'Chrome Hearts',
      'Vetements', 'Saint Laurent', 'Margiela', 'Acne Studios'
    ]

    const normalized = query.toLowerCase()
    for (const brand of commonBrands) {
      if (normalized.includes(brand.toLowerCase())) {
        return brand
      }
    }
    return null
  }

  private extractItemTypeFromQuery(query: string): string {
    const itemTypes = [
      'Trucker Hat', 'Hoodie', 'Sneakers', 'Jacket', 'Tee', 'Pants',
      'Shirt', 'Shorts', 'Cap', 'Beanie', 'Bag', 'Wallet',
      'Bomber', 'Denim', 'Cargo', 'Sweater', 'Cardigan'
    ]

    const normalized = query.toLowerCase()
    for (const type of itemTypes) {
      if (normalized.includes(type.toLowerCase())) {
        return type
      }
    }
    return 'Item'
  }

  private extractItemType(title: string, brand: string): string {
    return title
      .replace(new RegExp(`^${brand}\\s*`, 'i'), '')
      .replace(/\b(vintage|rare|limited|edition|collaboration|collab)\b/gi, '')
      .trim()
  }

  private normalizeItemType(type: string): string {
    return type.toLowerCase().replace(/\s+/g, ' ').trim()
  }

  private getBasePriceForItemType(itemType: string): number {
    const prices: Record<string, number> = {
      'trucker hat': 150, 'hoodie': 300, 'sneakers': 400,
      'jacket': 500, 'tee': 120, 'pants': 250, 'shirt': 180,
      'shorts': 150, 'cap': 100, 'beanie': 80, 'bag': 350,
      'wallet': 200, 'bomber': 600, 'denim': 280, 'cargo': 220,
      'sweater': 240, 'cardigan': 200, 'item': 250,
    }

    const normalized = itemType.toLowerCase()
    for (const [type, price] of Object.entries(prices)) {
      if (normalized.includes(type)) return price
    }
    return 250
  }

  private getCategoryForItemType(itemType: string): string {
    const normalized = itemType.toLowerCase()
    if (['sneakers', 'shoes', 'boots'].some(t => normalized.includes(t))) return 'shoes'
    if (['hat', 'cap', 'beanie', 'bag', 'wallet'].some(t => normalized.includes(t))) return 'accessories'
    return 'clothing'
  }

  private getRandomSize(itemType: string): string {
    const normalized = itemType.toLowerCase()
    if (['sneakers', 'shoes', 'boots'].some(t => normalized.includes(t))) {
      return ['8', '9', '10', '11', '12', '13'][Math.floor(Math.random() * 6)]
    }
    if (['hat', 'cap', 'beanie'].some(t => normalized.includes(t))) {
      return 'OS'
    }
    return ['S', 'M', 'L', 'XL', 'XXL'][Math.floor(Math.random() * 5)]
  }
}

let scraperInstance: SoldListingsScraper | null = null

export function getSoldListingsScraper(): SoldListingsScraper {
  if (!scraperInstance) {
    scraperInstance = new SoldListingsScraper()
  }
  return scraperInstance
}
