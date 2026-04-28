import { getConfig } from './config.js'
import type { VelocityResult, DiscordWebhookPayload, DiscordEmbed } from './types.js'
import { formatVelocity, getVelocityColor } from './tracker.js'

export class DiscordNotifier {
  private webhookUrl: string | null

  constructor() {
    const config = getConfig()
    this.webhookUrl = config.discordWebhookUrl
  }

  async sendAlert(results: VelocityResult[]): Promise<boolean> {
    if (!this.webhookUrl) {
      console.log('Discord webhook not configured, skipping notification')
      return false
    }

    const highVelocity = results.filter(r => r.velocity === 'high' || r.isNew)

    if (highVelocity.length === 0) {
      console.log('No high-velocity items to report')
      return false
    }

    const embeds: DiscordEmbed[] = []

    const soldCount = results.filter(r => r.isSold).length
    const newCount = results.filter(r => r.isNew).length
    const highVelocityCount = results.filter(r => r.velocity === 'high').length

    embeds.push({
      title: '📊 Grailed Arbitrage Scan Complete',
      description: `Found ${results.length} items | ${newCount} new | ${soldCount} sold | ${highVelocityCount} high velocity`,
      color: 0x0099ff,
      fields: [
        { name: 'New Listings', value: newCount.toString(), inline: true },
        { name: 'Sold Today', value: soldCount.toString(), inline: true },
        { name: 'High Velocity', value: highVelocityCount.toString(), inline: true },
      ],
      timestamp: new Date().toISOString(),
    })

    const topItems = highVelocity
      .filter(r => r.velocity === 'high' || (r.isNew && r.item.price >= 300))
      .slice(0, 5)

    for (const result of topItems) {
      const velocityEmoji = getVelocityEmoji(result.velocity)
      const priceEmoji = getPriceEmoji(result.item.price)

      embeds.push({
        title: `${velocityEmoji} ${result.item.brand} - $${result.item.price}`,
        description: result.item.title.slice(0, 200),
        url: result.item.url,
        color: getVelocityColor(result.velocity),
        fields: [
          { name: 'Brand', value: result.item.brand || 'Unknown', inline: true },
          { name: 'Price', value: `$${result.item.price} ${priceEmoji}`, inline: true },
          { name: 'Velocity', value: formatVelocity(result), inline: true },
          { name: 'Condition', value: result.item.condition, inline: true },
          { name: 'Likes', value: result.item.likesCount.toString(), inline: true },
          { name: 'Status', value: result.isSold ? '🔴 SOLD' : result.isNew ? '🟢 NEW' : '⚪ Listed', inline: true },
        ],
        thumbnail: result.item.images.length > 0 ? { url: result.item.images[0] } : undefined,
        timestamp: new Date().toISOString(),
      })
    }

    for (let i = 0; i < embeds.length; i += 10) {
      const batch = embeds.slice(i, i + 10)
      const payload: DiscordWebhookPayload = { embeds: batch }

      const success = await this.sendWebhook(payload)
      if (!success) return false

      if (i + 10 < embeds.length) {
        await sleep(1000)
      }
    }

    return true
  }

  async sendTestMessage(): Promise<boolean> {
    if (!this.webhookUrl) {
      console.error('Discord webhook URL not configured')
      console.log('Set DISCORD_WEBHOOK_URL environment variable or configure in ~/.grailed-bot/config.json')
      return false
    }

    const payload: DiscordWebhookPayload = {
      content: '🤖 Grailed Arbitrage Bot is online!',
      embeds: [{
        title: 'Test Alert',
        description: 'Your Discord webhook is configured correctly. You will receive alerts when high-velocity items are detected.',
        color: 0x00ff00,
        timestamp: new Date().toISOString(),
      }],
    }

    return await this.sendWebhook(payload)
  }

  private async sendWebhook(payload: DiscordWebhookPayload): Promise<boolean> {
    if (!this.webhookUrl) return false

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        console.error(`Discord webhook failed: ${response.status} ${response.statusText}`)
        return false
      }

      return true
    } catch (error) {
      console.error('Discord webhook error:', error)
      return false
    }
  }

  isConfigured(): boolean {
    return this.webhookUrl !== null
  }
}

function getVelocityEmoji(velocity: string): string {
  switch (velocity) {
    case 'high': return '🚀'
    case 'medium': return '⚡'
    case 'low': return '🐢'
    default: return '❓'
  }
}

function getPriceEmoji(price: number): string {
  if (price >= 1000) return '💎'
  if (price >= 500) return '💰'
  if (price >= 300) return '💵'
  return '💸'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
