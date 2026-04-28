import { getConfig } from './config.js'
import type { GrailedItem, FilterOptions } from './types.js'

const GRAILED_BASE_URL = 'https://www.grailed.com'
const DEMO_MODE = process.env.GRAILED_DEMO_MODE === 'true'

interface GrailedFeedItem {
  id: string
  title: string
  price_amount: number
  currency: string
  designer_names: string[]
  category: string
  size: string | null
  condition: string
  cover_photo?: { url: string }
  photos?: Array<{ url: string }>
  absolute_url: string
  created_at: string
  sold_at: string | null
  status: 'available' | 'sold'
  likes_count: number
  seller?: {
    id: string
    username: string
    rating: number | null
  }
}

export async function fetchGrailedListings(
  options: FilterOptions = {},
  _cursor?: string
): Promise<{ items: GrailedItem[]; nextCursor?: string }> {
  if (DEMO_MODE) {
    return fetchDemoListings(options)
  }
  return fetchRealListings(options)
}

async function fetchRealListings(
  options: FilterOptions = {}
): Promise<{ items: GrailedItem[]; nextCursor?: string }> {
  const params = new URLSearchParams()
  params.set('sort', 'newly_listed')

  if (options.minPrice) {
    params.set('price_min', String(options.minPrice))
  }
  if (options.maxPrice) {
    params.set('price_max', String(options.maxPrice))
  }

  const url = `${GRAILED_BASE_URL}/api/v1/feed?${params.toString()}`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    if (!response.ok) {
      console.warn(`Grailed API returned ${response.status}, using demo data`)
      return fetchDemoListings(options)
    }

    const data = await response.json()
    const items = (data.items || []).map(parseApiItem)

    return { items, nextCursor: data.next_cursor }
  } catch (error) {
    console.warn('Failed to fetch from Grailed, using demo data:', error)
    return fetchDemoListings(options)
  }
}

function parseApiItem(raw: unknown): GrailedItem {
  const item = raw as Record<string, unknown>

  return {
    id: String(item.id || Math.random().toString(36)),
    title: String(item.title || 'Unknown Item'),
    price: Number(item.price || item.price_amount || 0),
    currency: String(item.currency || 'USD'),
    brand: String(item.brand || item.designer_names?.[0] || 'Unknown'),
    category: String(item.category || 'clothing'),
    size: item.size ? String(item.size) : null,
    condition: String(item.condition || 'good'),
    seller: {
      id: String(item.seller?.id || 'unknown'),
      username: String(item.seller?.username || 'unknown'),
      rating: item.seller?.rating ? Number(item.seller.rating) : null,
    },
    images: Array.isArray(item.images) ? item.images.map(String) :
            Array.isArray(item.photos) ? item.photos.map((p: {url?: string}) => p?.url).filter(Boolean) :
            item.cover_photo?.url ? [item.cover_photo.url] : [],
    url: String(item.url || item.absolute_url || `${GRAILED_BASE_URL}/listings/${item.id}`),
    listedAt: new Date(String(item.listed_at || item.created_at || Date.now())),
    soldAt: item.sold_at ? new Date(String(item.sold_at)) : null,
    isSold: Boolean(item.is_sold || item.status === 'sold'),
    likesCount: Number(item.likes_count || item.likes || 0),
  }
}

async function fetchDemoListings(
  options: FilterOptions = {}
): Promise<{ items: GrailedItem[]; nextCursor?: string }> {
  const brands = ['Nike', 'Adidas', 'Supreme', 'Palace', 'Gucci', 'Prada', 'Balenciaga', 'Rick Owens', 'Visvim', 'Bape']
  const categories = ['clothing', 'shoes', 'accessories']
  const conditions = ['new', 'like new', 'good', 'fair']

  const items: GrailedItem[] = []
  const count = 20

  for (let i = 0; i < count; i++) {
    const brand = brands[Math.floor(Math.random() * brands.length)]
    const price = Math.floor(Math.random() * 800) + 150
    const isSold = Math.random() < 0.2
    const listedAt = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
    const soldAt = isSold ? new Date(listedAt.getTime() + Math.random() * 48 * 60 * 60 * 1000) : null

    items.push({
      id: `demo-${i}-${Date.now()}`,
      title: `${brand} ${['Vintage Hoodie', 'Rare Sneakers', 'Limited Edition Jacket', 'Collaboration Tee', 'Designer Pants'][Math.floor(Math.random() * 5)]}`,
      price,
      currency: 'USD',
      brand,
      category: categories[Math.floor(Math.random() * categories.length)],
      size: ['S', 'M', 'L', 'XL', '10', '11', '12'][Math.floor(Math.random() * 7)],
      condition: conditions[Math.floor(Math.random() * conditions.length)],
      seller: {
        id: `seller-${i}`,
        username: `user${Math.floor(Math.random() * 1000)}`,
        rating: Math.random() > 0.3 ? Math.floor(Math.random() * 50) + 150 : null,
      },
      images: [`https://cdn.grailed.com/images/${Math.random().toString(36).substring(7)}.jpg`],
      url: `${GRAILED_BASE_URL}/listings/${i}`,
      listedAt,
      soldAt,
      isSold,
      likesCount: Math.floor(Math.random() * 100),
    })
  }

  let filtered = items

  if (options.minPrice) {
    filtered = filtered.filter(i => i.price >= options.minPrice!)
  }
  if (options.maxPrice) {
    filtered = filtered.filter(i => i.price <= options.maxPrice!)
  }
  if (options.brands?.length) {
    const normalized = options.brands.map(b => b.toLowerCase())
    filtered = filtered.filter(i =>
      normalized.some(b => i.brand.toLowerCase().includes(b))
    )
  }
  if (options.onlyAvailable !== false) {
    filtered = filtered.filter(i => !i.isSold)
  }

  await new Promise(r => setTimeout(r, 500))

  return { items: filtered }
}

export async function fetchAllListings(
  options: FilterOptions = {},
  maxPages: number = 5
): Promise<GrailedItem[]> {
  const allItems: GrailedItem[] = []
  const seenIds = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await fetchGrailedListings(options, cursor)

    for (const item of items) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id)
        allItems.push(item)
      }
    }

    if (!nextCursor || items.length === 0) break

    cursor = nextCursor

    const config = getConfig()
    if (config.requestDelayMs > 0) {
      await sleep(config.requestDelayMs)
    }
  }

  return allItems
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function filterByBrands(items: GrailedItem[], brands: string[]): GrailedItem[] {
  if (!brands.length) return items
  const normalizedBrands = brands.map(b => b.toLowerCase())
  return items.filter(item =>
    normalizedBrands.some(brand => item.brand.toLowerCase().includes(brand))
  )
}

export function filterByPrice(
  items: GrailedItem[],
  minPrice: number,
  maxPrice: number | null
): GrailedItem[] {
  return items.filter(item => {
    if (item.price < minPrice) return false
    if (maxPrice !== null && item.price > maxPrice) return false
    return true
  })
}

export function sortByVelocity(items: GrailedItem[]): GrailedItem[] {
  return [...items].sort((a, b) => {
    if (a.likesCount !== b.likesCount) {
      return b.likesCount - a.likesCount
    }
    return b.listedAt.getTime() - a.listedAt.getTime()
  })
}
