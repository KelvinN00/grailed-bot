 Grailed Arbitrage Bot 🤖                                
                                                                                                                                                   
  An automated arbitrage bot that monitors [Grailed](https://www.grailed.com) for underpriced items by comparing active listings to sold prices.
                                                                                                                                                   
  ## Features                                               

  ### Core Functionality
  - **🔍 Listing Scanner** - Scans Grailed for items $150+ (configurable)
  - **📊 Velocity Tracking** - Tracks how fast items sell
  - **💰 Deal Finder** - Compares active listings to sold prices to find deals
  - **🔔 Discord Alerts** - Sends notifications for hot deals via webhooks
  - **🏷️  Brand Filtering** - Focus on specific brands (Nike, Supreme, Kapital, etc.)

  ### Sold Listings Analysis
  - **Market Data Engine** - Builds database of sold prices
  - **Price Comparison** - Shows if item is below/above market average
  - **Deal Score** - 0-100 rating (higher = better deal)
  - **Sell-Through Rate** - Percentage of items that actually sell
  - **Days to Sell** - Average time items take to sell

  ### Web Dashboard
  - **Real-time Updates** - Live scan results via WebSocket
  - **Search & Filter** - Find specific items (e.g., "Kapital Trucker Hat")
  - **Price Charts** - Visual price distribution
  - **Brand Stats** - Top brands with counts and averages
  - **Activity Log** - Real-time event tracking

  ## Installation

  ```bash
  # Clone the repo
  git clone https://github.com/KelvinN00/grailed-bot.git
  cd grailed-bot

  # Install dependencies
  bun install

  # Or with npm
  npm install

  Configuration

  Set your preferences in the dashboard or via CLI:

  # Set minimum price
  bun run grailed-bot config --set-min-price 200

  # Add brands to track
  bun run grailed-bot config --add-brand "Kapital"
  bun run grailed-bot config --add-brand "Nike"

  # Set Discord webhook (optional)
  bun run grailed-bot config --set-webhook "https://discord.com/api/webhooks/..."

  Usage

  CLI Commands

  # Run a single scan
  bun run grailed-bot scan

  # Scan specific brands
  bun run grailed-bot scan --brands="Kapital,Supreme" --min=300

  # Find deals (compares to sold prices)
  bun run grailed-bot find-deals

  # Continuous monitoring (every 15 min)
  bun run grailed-bot watch

  # Clear tracking data
  bun run grailed-bot clear

  # Test Discord webhook
  bun run grailed-bot test-discord

  # Show help
  bun run grailed-bot help

  Web Dashboard

  # Start the dashboard
  bun run grailed-dashboard

  # Or with demo data
  GRAILED_DEMO_MODE=true bun run grailed-dashboard

  Then open http://localhost:3333 in your browser.

  Dashboard Features:

  - Start Scan - Run a new scan
  - Search Bar - Search items like "Kapital Trucker Hat"
  - Filter Tabs - All / New / Sold / High Velocity / Available / Deals
  - Find Deals Button - Automatically find underpriced items
  - Settings - Configure brands, prices, Discord webhook

  API Endpoints

  The dashboard exposes these REST endpoints:

  # Get status
  GET /api/status

  # Get items (filter: all, new, sold, high-velocity, available, deals)
  GET /api/items?filter=deals

  # Search items
  GET /api/search?q=trucker%20hat

  # Start scan
  POST /api/scan

  # Get sold listings
  GET /api/sold?q=kapital&brand=Kapital

  # Get market data
  GET /api/market-data

  # Find deals
  POST /api/deals

  # Get config
  GET /api/config

  # Update config
  POST /api/config

  How It Works

  1. Scanning

  - Fetches active listings from Grailed
  - Filters by price ($150+ default) and brands
  - Tracks velocity (how fast items sell)

  2. Sold Listings Analysis

  - Searches sold listings for the same items
  - Builds market data (average sold price, days to sell)
  - Calculates sell-through rate

  3. Deal Detection

  - Compares active price to average sold price
  - Calculates deal score (0-100)
  - Alerts when deal score > 60

  Example Output:

  💰 Top Deals:
     ⬇️  Kapital - $120
        Market avg: $180
        Deal score: 85/100
        -33% vs market

  File Structure

  src/grailed-bot/
  ├── index.ts          # Main bot + CLI
  ├── scraper.ts        # Grailed data fetching
  ├── soldListings.ts   # Sold listings scraper
  ├── tracker.ts        # Velocity tracking
  ├── notifier.ts       # Discord alerts
  ├── config.ts         # Configuration
  ├── types.ts          # TypeScript types
  └── web/
      ├── server/
      │   └── index.ts  # Hono server + API
      └── client/
          ├── index.html    # Dashboard UI
          ├── styles.css    # Dark theme
          └── app.js        # Frontend logic

  Demo Mode

  The bot includes a demo mode that generates realistic data:

  GRAILED_DEMO_MODE=true bun run grailed-bot scan

  This is useful for testing without hitting Grailed's servers.

  Environment Variables

  # Enable demo mode
  GRAILED_DEMO_MODE=true

  # Discord webhook URL
  DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

  # Data directory (default: ~/.local/share/grailed-bot-nodejs)
  CAREER_DIR=/custom/path

  Tips

  1. Start with demo mode - Test everything works first
  2. Add your brands - Focus on what you know
  3. Set price range - Avoid low-margin items
  4. Check deal scores - 70+ is usually a good deal
  5. Verify sold prices - Market data is key

  Disclaimer

  This tool is for educational purposes. Respect Grailed's Terms of Service and rate limits. Don't abuse their servers.
