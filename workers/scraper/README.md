# Sunney.io AEMO Scraper

## Overview

The Sunney.io AEMO Scraper is a Cloudflare Worker that collects real-time and historical energy market data from the Australian Energy Market Operator (AEMO). It runs every 5 minutes to ensure fresh data for the platform's trading applications and dashboards.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   AEMO NEMWEB                                │
│            https://nemweb.com.au/Reports/                    │
└────────────────────┬─────────────────────────────────────────┘
                     │ Fetch every 5 minutes
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              SUNNEY-SCRAPER WORKER                           │
│         Deployed at: sunney-scraper.workers.dev              │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Main Functions (index.ts)                          │    │
│  │  - fetchDispatchData()    - Every 5 min            │    │
│  │  - fetchP5MinData()       - Every 5 min            │    │
│  │  - fetchFCASData()        - Every 5 min            │    │
│  │  - checkAndFetchForecasts() - Schedule-based       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Validation Module (validation.ts)                  │    │
│  │  - Runs every 15 minutes (00, 15, 30, 45)         │    │
│  │  - Checks freshness, completeness, consistency     │    │
│  │  - Sends Google Chat alerts on failure             │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Parsers                                            │    │
│  │  - aemo-parser.ts: Core CSV/ZIP parsing            │    │
│  │  - aemo-comprehensive-parser.ts: Advanced parsing  │    │
│  │  - duid-fuel-mapping.ts: 500+ generator mappings   │    │
│  └─────────────────────────────────────────────────────┘    │
└────────────────────┬─────────────────────────────────────────┘
                     │ Stores data in
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    STORAGE LAYER                             │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │ D1: sunney-market (Time-series data)               │     │
│  │ - dispatch_prices (5-min spot prices)              │     │
│  │ - generator_scada (unit generation)                │     │
│  │ - fcas_prices (ancillary services)                │     │
│  │ - battery_dispatch (BESS operations)               │     │
│  │ - p5min_forecasts, predispatch_forecasts           │     │
│  │ - stpasa_forecasts, validation_log                 │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │ KV: sunney-cache (Hot data, TTL: 5 min)            │     │
│  │ - prices:latest (current spot prices)              │     │
│  │ - prices:{region} (region-specific)                │     │
│  │ - fcas:latest (current FCAS prices)                │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │ R2: sunney-archive (Raw file backup)               │     │
│  │ - /raw/YYYY/MM/DD/dispatch/*.zip                   │     │
│  │ - /raw/YYYY/MM/DD/p5min/*.zip                      │     │
│  │ - /archive/predispatch/*.zip                       │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Current Status

### ✅ What's Working

1. **Core Dispatch Data** (Every 5 minutes)
   - Real-time spot prices for all 5 NEM regions
   - Regional demand data
   - Settlement timestamps
   - Data freshness: <10 minutes

2. **FCAS Markets** (8 of 9 services)
   - Raise/Lower Regulation
   - Raise/Lower 6 sec
   - Raise/Lower 60 sec
   - Raise/Lower 5 min

3. **Database Schema**
   - All tables created and indexed
   - 500+ DUID-to-fuel mappings configured
   - Validation logging active

4. **Monitoring & Alerts**
   - Integrated validation every 15 minutes
   - Google Chat webhook alerts on failures
   - Manual validation endpoint: `/validate`

### ⚠️ Partial Implementation

1. **Forecasting Data**
   - Code complete for PREDISPATCH (2-day)
   - Code complete for ST PASA (7-day)
   - Not yet fetching due to schedule logic

2. **Generator SCADA**
   - Table created but no data
   - Parser needs implementation

3. **Battery Dispatch**
   - Schema ready
   - Parser exists but not active

### ❌ Not Implemented

1. **Trading Prices** (30-min settlements)
2. **Interconnector Flows**
3. **Network Constraints**
4. **Unit Commitment Status**

## Cron Schedule

```
Main Scraper: */5 * * * * (every 5 minutes)
├── Dispatch Data: Every run
├── P5MIN Data: Every run  
├── FCAS Data: Every run
├── Validation: Minutes 00, 15, 30, 45
├── PREDISPATCH: Minutes 00, 30 (when implemented)
└── ST PASA: Daily at 01:00 (when implemented)
```

## Data Storage Strategy

### D1 Database (sunney-market)
- **Purpose**: Queryable time-series data
- **Retention**: 7 days detailed, 90 days aggregated
- **Tables**: 13 tables with indexes
- **Size**: ~0.78 MB (growing)

### KV Cache (sunney-cache)
- **Purpose**: Ultra-fast reads for live data
- **TTL**: 300 seconds (5 minutes)
- **Keys**: prices:latest, prices:{region}, fcas:latest

### R2 Archive (sunney-archive)
- **Purpose**: Raw ZIP file backup
- **Structure**: /raw/YYYY/MM/DD/{type}/{filename}.zip
- **Retention**: Indefinite

## API Endpoints

### Public Endpoints

```bash
# Health check
GET https://sunney-scraper.eddie-37d.workers.dev/health

# Manual trigger (POST required)
POST https://sunney-scraper.eddie-37d.workers.dev/trigger

# Validation status
GET https://sunney-scraper.eddie-37d.workers.dev/validate

# Test AEMO connectivity
GET https://sunney-scraper.eddie-37d.workers.dev/test
```

### Response Examples

```json
// GET /validate
{
  "passed": false,
  "issues": ["Missing FCAS services: only 8/9 reporting"],
  "warnings": ["Low generator count: 0 (expected 400+)"],
  "metrics": {
    "latestDispatchAge": 4.5,
    "regionCount": 5,
    "generatorCount": 0,
    "fcasServiceCount": 8,
    "batteryCount": 0,
    "forecastHorizon": 0,
    "cacheHitRate": 25
  },
  "timestamp": "2025-08-23T23:49:33.119Z"
}
```

## Quick Start

### Deploy the Scraper

```bash
# Install dependencies
npm install

# Deploy to Cloudflare
wrangler deploy

# Set Google Chat webhook
wrangler secret put GOOGLE_CHAT_WEBHOOK --name sunney-scraper
# Enter: https://chat.googleapis.com/v1/spaces/YOUR_SPACE/messages?key=KEY&token=TOKEN

# Initialize database schema
wrangler d1 execute sunney-market --file init-schema.sql --remote
```

### Manual Operations

```bash
# Trigger data fetch
curl -X POST https://sunney-scraper.eddie-37d.workers.dev/trigger

# Check validation
curl https://sunney-scraper.eddie-37d.workers.dev/validate | jq '.'

# View logs
wrangler tail sunney-scraper

# Query latest prices
wrangler d1 execute sunney-market --command \
  "SELECT region, price, demand, settlement_date FROM dispatch_prices ORDER BY settlement_date DESC LIMIT 5" --remote
```

## Data Access Patterns

### Get Latest Prices (from API worker)

```javascript
// From KV (fastest, <50ms)
const cached = await env.CACHE.get('prices:latest');
if (cached) return JSON.parse(cached);

// From D1 (if cache miss)
const result = await env.DB.prepare(`
  SELECT region, price, demand, settlement_date
  FROM dispatch_prices
  WHERE settlement_date = (SELECT MAX(settlement_date) FROM dispatch_prices)
`).all();
```

### Get Historical Data

```javascript
// 24-hour price history
const history = await env.DB.prepare(`
  SELECT 
    region,
    AVG(price) as avg_price,
    MAX(price) as max_price,
    MIN(price) as min_price,
    DATE(settlement_date) as date
  FROM dispatch_prices
  WHERE settlement_date >= datetime('now', '-1 day')
  GROUP BY region, DATE(settlement_date)
  ORDER BY region, date
`).all();
```

### Get FCAS Prices

```javascript
// Latest FCAS prices by service
const fcas = await env.DB.prepare(`
  SELECT DISTINCT
    service,
    region,
    price,
    enablement_min,
    enablement_max
  FROM fcas_prices
  WHERE settlement_date = (SELECT MAX(settlement_date) FROM fcas_prices)
  ORDER BY service, region
`).all();
```

### Get Battery Status

```javascript
// Battery state of charge and dispatch
const batteries = await env.DB.prepare(`
  SELECT 
    duid,
    totalcleared as mw_output,
    soc_percent,
    energy_mwh,
    settlement_date
  FROM battery_dispatch
  WHERE settlement_date >= datetime('now', '-30 minutes')
  ORDER BY duid, settlement_date DESC
`).all();
```

## Troubleshooting

### Common Issues

1. **Data Not Fresh**
   - Check worker is running: `wrangler tail sunney-scraper`
   - Manually trigger: `curl -X POST https://sunney-scraper.eddie-37d.workers.dev/trigger`
   - Verify AEMO site is up: `curl -I https://nemweb.com.au`

2. **Missing Data**
   - Run validation: `curl https://sunney-scraper.eddie-37d.workers.dev/validate`
   - Check specific table: `wrangler d1 execute sunney-market --command "SELECT COUNT(*) FROM table_name" --remote`

3. **Google Chat Not Working**
   - Test webhook: `./test-google-chat.sh`
   - Check secret: `wrangler secret list --name sunney-scraper`

## Files Structure

```
workers/scraper/
├── src/
│   ├── index.ts                    # Main worker entry point
│   ├── validation.ts               # Integrated validation module
│   ├── aemo-parser.ts              # Core CSV/ZIP parsing
│   ├── aemo-comprehensive-parser.ts # Advanced data structures
│   ├── forecasting-fetcher.ts     # PREDISPATCH & ST PASA
│   ├── comprehensive-fetcher.ts   # Complex data fetching
│   └── duid-fuel-mapping.ts       # Generator mappings
├── init-schema.sql                 # Database schema
├── test-google-chat.sh            # Webhook test script
├── wrangler.toml                  # Worker configuration
├── package.json                   # Dependencies
├── README.md                      # This file
└── VALIDATION.md                  # Validation documentation
```

## Next Steps

### Priority 1: Complete Core Data
1. Implement SCADA parser for generator data
2. Activate PREDISPATCH fetching (30-min schedule)
3. Enable battery dispatch parsing

### Priority 2: Enhance Coverage
1. Add trading prices (30-min settlements)
2. Implement interconnector flows
3. Add network constraints

### Priority 3: Optimize Performance
1. Improve cache hit rate to >80%
2. Implement data compression for R2
3. Add retry logic for failed fetches

## Support

- **Documentation**: See VALIDATION.md for detailed validation info
- **Architecture**: See /Users/eddiemacpro/Sunney.io/ARCHITECTURE.md
- **Main Platform**: See /Users/eddiemacpro/Sunney.io/README.md

---

**Version**: 2.0.0
**Last Updated**: August 24, 2025
**Status**: Core Operational - Dispatch prices working, ancillary data pending