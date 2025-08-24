# AEMO Data Validation & Monitoring Guide

## Overview

The validation system is integrated directly into the Sunney.io AEMO scraper worker, ensuring data integrity, freshness, and reliability. Validation runs automatically every 15 minutes as part of the main scraper cron job.

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   SUNNEY-SCRAPER WORKER                      │
│                   Runs every 5 minutes                       │
└────────────┬─────────────────────────────────────────────────┘
             │
     ┌───────▼───────┐
     │  Data Fetch   │
     │  - DISPATCH   │
     │  - P5MIN      │
     │  - FCAS       │
     └───────┬───────┘
             │
     ┌───────▼──────────┐
     │  Every 15 min?   │
     │  (00,15,30,45)   │
     └───────┬──────────┘
             │ Yes
     ┌───────▼───────┐
     │  Run Validation │
     │  validation.ts  │
     └───────┬────────┘
             │
    ┌────────┴──────────┬──────────────┬──────────────┬────────────┐
    ▼                   ▼              ▼              ▼            ▼
Freshness          Completeness   Consistency   Forecasting    Cache
- <10 min old      - All regions   - Gen≈Demand   - P5MIN 1hr    - KV hit rate
- SCADA current    - 400+ units    - Price bounds - PREDISPATCH  - TTL valid
- Trading <35min   - 9 FCAS mkts   - SOC valid    - ST PASA      - Fuel mix
    │                   │              │              │            │
    └────────┬──────────┴──────────────┴──────────────┴────────────┘
             │
      ┌──────▼──────┐
      │   Results   │
      └──────┬──────┘
             │
    ┌────────┴──────────┬──────────────┐
    ▼                   ▼              ▼
 D1 Log            Google Chat    API Response
 validation_log    Alert if fail   /validate endpoint
```

## Deployment Status

### ✅ What's Deployed

1. **Main Scraper Worker** (`sunney-scraper`)
   - URL: https://sunney-scraper.eddie-37d.workers.dev
   - Schedule: */5 * * * * (every 5 minutes)
   - Includes integrated validation module
   - Google Chat webhook configured

2. **Database Schema** (D1: `sunney-market`)
   - All tables created and indexed
   - dispatch_prices, generator_scada, fcas_prices
   - battery_dispatch, trading_prices
   - p5min_forecasts, predispatch_forecasts, stpasa_forecasts
   - validation_log

3. **Storage Configuration**
   - KV: `sunney-cache` for hot data
   - R2: `sunney-archive` for raw files
   - D1: `sunney-market` for time-series

### 📊 Current Data Coverage

| Data Type | Source | Status | Validation | Notes |
|-----------|--------|--------|------------|-------|
| **Energy Prices** | DISPATCHIS | ✅ Live | ✅ Freshness <10min | 5-min updates |
| **Regional Demand** | DISPATCHIS | ✅ Live | ✅ 5 regions check | All NEM regions |
| **Generation** | DISPATCHSCADA | ✅ Live | ⚠️ Low count | Need SCADA parser |
| **FCAS (9 markets)** | DISPATCHIS | ✅ Live | ✅ 8/9 services | Missing 1-sec market |
| **Battery Dispatch** | DISPATCHLOAD | ✅ Schema | ⚠️ No data yet | Parser ready |
| **Fuel Mix** | DUID mapping | ✅ Mapped | ✅ 500+ DUIDs | duid-fuel-mapping.ts |
| **Trading Prices** | TRADINGIS | ⚠️ Schema | ⚠️ No fetch | 30-min intervals |
| **P5MIN Forecasts** | P5MIN | ⚠️ Schema | ⚠️ No data | 1-hour ahead |
| **PREDISPATCH** | PREDISPATCH | ✅ Code | ⚠️ Not running | 2-day forecast |
| **ST PASA** | STPASA | ✅ Code | ⚠️ Not running | 7-day forecast |

## Validation Checks

### 1. Freshness Validation ✅
- **Dispatch prices**: Must be <10 minutes old
- **SCADA data**: Must be <10 minutes old
- **Trading prices**: Must be <35 minutes old
- **Status**: Working, dispatch data is fresh

### 2. Completeness Validation ⚠️
- **Regions**: Expecting 5 (NSW1, VIC1, QLD1, SA1, TAS1) ✅
- **Generators**: Expecting 400+ in SCADA ❌ (0 currently)
- **FCAS Services**: Expecting 9 ⚠️ (8/9 currently)
- **Batteries**: Expecting 30+ ❌ (0 currently)

### 3. Consistency Validation ⚠️
- **Energy Balance**: Generation ≈ Demand (±5% tolerance)
- **Price Bounds**: -$1,000 ≤ Price ≤ $16,600
- **Battery SOC**: 0% ≤ State_of_Charge ≤ 100%
- **Status**: Warnings due to missing SCADA data

### 4. Forecasting Validation ❌
- **P5MIN**: Should have 12+ intervals (1 hour ahead)
- **PREDISPATCH**: Should have 96+ intervals (48 hours ahead)
- **ST PASA**: Should have 336+ intervals (7 days ahead)
- **Status**: No forecast data yet

### 5. Cache Health ⚠️
- **Hit Rate**: 25% (low due to missing data)
- **prices:latest**: ✅ Cached
- **fcas:latest**: ❌ Not cached

## Google Chat Integration

### Configuration
```bash
# Webhook is stored as a secret
wrangler secret put GOOGLE_CHAT_WEBHOOK --name sunney-scraper
# Enter: https://chat.googleapis.com/v1/spaces/YOUR_SPACE/messages?key=YOUR_KEY&token=YOUR_TOKEN
```

### Alert Format
- **Critical Issues**: Red alerts for data staleness or missing regions
- **Warnings**: Yellow alerts for low counts or imbalances
- **Metrics**: Key stats in each alert
- **Actions**: Links to dashboard and logs

### Test Webhook
```bash
# Run the test script
./test-google-chat.sh

# Or manually trigger validation
curl https://sunney-scraper.eddie-37d.workers.dev/validate
```

## Manual Operations

### Trigger Scraper
```bash
curl -X POST https://sunney-scraper.eddie-37d.workers.dev/trigger
```

### Check Validation
```bash
curl https://sunney-scraper.eddie-37d.workers.dev/validate | jq '.'
```

### View Latest Data
```sql
-- Check latest dispatch prices
wrangler d1 execute sunney-market --command "SELECT region, price, demand, MAX(settlement_date) as latest FROM dispatch_prices GROUP BY region" --remote

-- Check validation history
wrangler d1 execute sunney-market --command "SELECT * FROM validation_log ORDER BY timestamp DESC LIMIT 5" --remote
```

### Monitor Logs
```bash
# Live tail of scraper logs
wrangler tail sunney-scraper

# Filter for validation events
wrangler tail sunney-scraper --filter validation
```

## Known Issues & Next Steps

### 🔴 Critical Issues
1. **SCADA Parser Not Running**: generator_scada table empty
   - Need to implement DISPATCHSCADA parsing in aemo-parser.ts
   - Will populate generator data and fuel mix

2. **Forecasting Not Active**: 
   - PREDISPATCH and ST PASA parsers ready but not fetching
   - Need to verify AEMO URLs and file formats

3. **Battery Dispatch Missing**:
   - Parser exists but DISPATCHLOAD not being fetched
   - Critical for BESS optimization features

### 🟡 Warnings
1. **FCAS Missing 1 Service**: Only 8/9 FCAS markets reporting
2. **Cache Hit Rate Low**: 25% due to missing data
3. **Energy Imbalance**: 162% difference (no generation data)

### 🟢 Working Well
1. **Dispatch Prices**: Fresh data every 5 minutes
2. **Regional Coverage**: All 5 NEM regions reporting
3. **Google Chat Alerts**: Webhook configured and tested
4. **Database Schema**: All tables created with indexes
5. **DUID Mapping**: 500+ generators mapped to fuel types

## Troubleshooting

### Data Not Fresh
```bash
# Check scraper is running
wrangler tail sunney-scraper

# Manually trigger
curl -X POST https://sunney-scraper.eddie-37d.workers.dev/trigger

# Check AEMO connectivity
curl -I https://nemweb.com.au/Reports/Current/DispatchIS_Reports/
```

### Missing Regions
```sql
-- Check which regions are reporting
SELECT region, MAX(settlement_date) as latest 
FROM dispatch_prices 
GROUP BY region;
```

### Google Chat Not Receiving Alerts
```bash
# Test webhook directly
./test-google-chat.sh

# Check secret is set
wrangler secret list --name sunney-scraper

# View recent validation results
wrangler d1 execute sunney-market --command "SELECT * FROM validation_log WHERE passed = 0 ORDER BY timestamp DESC LIMIT 5" --remote
```

## Performance Metrics

### Current Status (as of latest validation)
```json
{
  "latestDispatchAge": 4.5,  // minutes - ✅ Good
  "regionCount": 5,          // ✅ All regions
  "generatorCount": 0,        // ❌ Need SCADA parser
  "fcasServiceCount": 8,      // ⚠️ Missing 1 service
  "batteryCount": 0,          // ❌ Need battery parser
  "forecastHorizon": 0,       // ❌ Need forecast fetcher
  "cacheHitRate": 25          // ⚠️ Low
}
```

### Target SLAs
- **Data Latency**: <10 minutes ✅ Achieving
- **Validation Runtime**: <5 seconds ✅ Achieving
- **Cache Hit Rate**: >80% ❌ Currently 25%
- **Uptime**: >99.9% ✅ Worker deployed

## Next Implementation Priority

1. **Fix SCADA Parser** - Enable generator data collection
2. **Activate Forecasting** - Enable PREDISPATCH (30-min schedule)
3. **Add Battery Dispatch** - Parse DISPATCHLOAD files
4. **Improve Cache Strategy** - Cache FCAS and fuel mix data
5. **Add Trading Prices** - Parse TRADINGIS (30-min intervals)

---

**Last Updated**: August 24, 2025
**Version**: 2.0.0 (Integrated Architecture)
**Status**: Partially Operational - Core dispatch working, ancillary data pending