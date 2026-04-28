export interface GrailedItem {
  id: string
  title: string
  price: number
  currency: string
  brand: string
  category: string
  size: string | null
  condition: string
  seller: {
    id: string
    username: string
    rating: number | null
  }
  images: string[]
  url: string
  listedAt: Date
  soldAt: Date | null
  isSold: boolean
  likesCount: number
}

export interface TrackedItem extends GrailedItem {
  firstSeenAt: Date
  lastSeenAt: Date
  checkCount: number
}

export type VelocityScore = 'high' | 'medium' | 'low' | 'unknown'

export interface VelocityResult {
  item: GrailedItem
  velocity: VelocityScore
  hoursToSell: number | null
  isNew: boolean
  isSold: boolean
}

export interface Snapshot {
  timestamp: Date
  items: GrailedItem[]
}

export interface DiscordEmbed {
  title: string
  description?: string
  url?: string
  color: number
  fields: {
    name: string
    value: string
    inline?: boolean
  }[]
  image?: {
    url: string
  }
  thumbnail?: {
    url: string
  }
  timestamp?: string
}

export interface DiscordWebhookPayload {
  content?: string
  embeds: DiscordEmbed[]
}

export interface FilterOptions {
  minPrice?: number
  maxPrice?: number | null
  brands?: string[]
  categories?: string[]
  onlyAvailable?: boolean
}
