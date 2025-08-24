# Time Handling Strategy for Sunney.io Platform

## Critical Overview

The Australian National Electricity Market (NEM) operates on **Australian Eastern Standard Time (AEST, UTC+10)** with **NO daylight saving adjustments**. This means the market clock remains fixed year-round at UTC+10, even when some Australian regions observe daylight saving time.

**GOLDEN RULE**: All time handling in the Sunney.io platform MUST use the `TimeUtil` class. Direct `new Date()` calls are prohibited.

## Why This Matters

1. **AEMO Data Consistency**: All AEMO timestamps are in AEST (UTC+10) without DST
2. **Settlement Periods**: Energy is settled in 5-minute intervals aligned to AEST
3. **Trading Intervals**: Prices are calculated for 30-minute trading intervals
4. **Peak/Off-Peak**: Tariffs depend on AEST time, not local time
5. **Global Access**: Platform users may be anywhere, but NEM operates on AEST

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        DATA FLOW                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  AEMO Sources          Scraper            Database          │
│  ┌──────────┐         ┌────────┐         ┌────────┐        │
│  │   AEST   │ ──────> │  Parse │ ──────> │  UTC   │        │
│  │ UTC+10   │         │ to UTC │         │Storage │        │
│  │  No DST  │         └────────┘         └────────┘        │
│  └──────────┘                                  │            │
│                                                 ▼            │
│  Frontend              API                 Database          │
│  ┌──────────┐         ┌────────┐         ┌────────┐        │
│  │  Local   │ <────── │Convert │ <────── │  UTC   │        │
│  │Timezone  │         │from UTC│         │ Query  │        │
│  └──────────┘         └────────┘         └────────┘        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Core Principles

### 1. Storage Layer (D1, KV, R2)
- **ALWAYS** store timestamps in **UTC ISO format**
- Example: `2025-08-24T02:00:00.000Z` (represents 12:00 PM AEST)
- This enables consistent global querying

### 2. Ingestion Layer (Scraper)
- **ALWAYS** parse AEMO timestamps using `TimeUtil.parseAEMOToUTC()`
- AEMO formats: `"2025/08/24 12:00:00"`, `"20250824120000"`, `"2025-08-24 12:00:00"`
- All assumed to be AEST (UTC+10)

### 3. API Layer
- **ALWAYS** return UTC timestamps
- Include AEST in response for NEM-specific data
- Let frontend handle user timezone conversion

### 4. Frontend Layer
- **ALWAYS** use `TimeUtil.utcToLocal()` for display
- Default to 'Australia/Sydney' for NEM data
- Allow user timezone preference for general timestamps

## Usage Examples

### Correct Usage ✅

```typescript
// Getting current time
const nowUTC = TimeUtil.nowUTC();  // "2025-08-24T02:00:00.000Z"
const nowAEST = TimeUtil.nowAEST(); // "2025/08/24 12:00:00"

// Parsing AEMO data
const aemoTimestamp = "2025/08/24 12:00:00";
const utcTimestamp = TimeUtil.parseAEMOToUTC(aemoTimestamp);
// Returns: "2025-08-24T02:00:00.000Z"

// Storing in database
await env.DB.prepare(`
  INSERT INTO dispatch_prices (settlement_date, price)
  VALUES (?, ?)
`).bind(utcTimestamp, 150.50).run();

// Displaying to user
const displayTime = TimeUtil.formatForDisplay(utcTimestamp);
// Returns: "24/08/2025 12:00:00 AEST"

// Checking peak period
const isPeak = TimeUtil.isNEMPeakPeriod(utcTimestamp);
// Returns: true (12 PM AEST is within 7am-10pm weekday peak)

// Getting settlement period (5-min interval)
const settlementPeriod = TimeUtil.getSettlementPeriod(utcTimestamp);
// Returns: "2025-08-24T02:00:00.000Z" (rounded to 5-min)

// Getting trading interval (30-min interval)
const tradingInterval = TimeUtil.getTradingInterval(utcTimestamp);
// Returns: "2025-08-24T02:00:00.000Z" (rounded to 30-min)
```

### Incorrect Usage ❌

```typescript
// NEVER do this:
const timestamp = new Date().toISOString();  // Server timezone dependent
const aestTime = new Date();
aestTime.setHours(aestTime.getHours() + 10); // Manual offset calculation

// NEVER parse AEMO dates manually:
const parts = aemoDate.split(' ');  // Fragile parsing
const date = new Date(parts[0]);    // Timezone ambiguous

// NEVER store local times:
const localTime = new Date().toLocaleString(); // Timezone specific
await db.insert({ time: localTime });          // Not queryable globally
```

## NEM-Specific Time Concepts

### 1. Settlement Periods
- **Duration**: 5 minutes
- **Per Day**: 288 periods (numbered 1-288)
- **Alignment**: Always on 5-minute boundaries (00, 05, 10, 15, etc.)
- **Usage**: Energy volume and SCADA data

### 2. Trading Intervals
- **Duration**: 30 minutes
- **Per Day**: 48 intervals (numbered 1-48)
- **Alignment**: Always on 30-minute boundaries (00, 30)
- **Usage**: Spot prices and FCAS prices

### 3. Trading Day
- **Start**: 4:00 AM AEST
- **End**: 4:00 AM AEST next day
- **Note**: NOT midnight-to-midnight
- **Usage**: Daily settlements and reports

### 4. Peak Periods
- **Standard Peak**: Weekdays 7:00 AM - 10:00 PM AEST
- **Off-Peak**: All other times including weekends
- **Usage**: Tariff calculations and demand forecasting

## Scheduling and Cron Jobs

### PREDISPATCH Fetching
```typescript
// Runs at AEST times, not server local time
const nowAEST = TimeUtil.nowAEST();
const [_, time] = nowAEST.split(' ');
const [hour, minute] = time.split(':').map(Number);

// Fetch at 00, 05, 30, 35 minutes AEST
if (minute === 0 || minute === 5 || minute === 30 || minute === 35) {
  await fetchPredispatchData();
}
```

### ST PASA Fetching
```typescript
// Daily at 1:00 AM AEST
if (hour === 1 && minute < 5) {
  await fetchStPasaData();
}
```

## Database Queries

### Correct Time Queries ✅

```sql
-- Get last 24 hours of data (UTC-based)
SELECT * FROM dispatch_prices 
WHERE settlement_date >= datetime('now', '-24 hours');

-- Get data for specific AEST date
-- Convert AEST date to UTC before querying
SELECT * FROM dispatch_prices
WHERE settlement_date >= '2025-08-23T14:00:00.000Z'  -- 2025-08-24 00:00 AEST
  AND settlement_date < '2025-08-24T14:00:00.000Z';  -- 2025-08-25 00:00 AEST

-- Get current trading interval
SELECT * FROM dispatch_prices
WHERE settlement_date = (
  SELECT MAX(settlement_date) FROM dispatch_prices
  WHERE settlement_date <= datetime('now')
);
```

### Incorrect Queries ❌

```sql
-- NEVER use local time functions
SELECT * FROM dispatch_prices 
WHERE DATE(settlement_date) = DATE('now', 'localtime');  -- Wrong!

-- NEVER assume timezone
SELECT * FROM dispatch_prices
WHERE settlement_date = '2025-08-24 12:00:00';  -- Ambiguous!
```

## API Response Format

### Standard Response
```json
{
  "data": {
    "region": "NSW1",
    "price": 150.50,
    "settlement_date_utc": "2025-08-24T02:00:00.000Z",
    "settlement_date_aest": "2025/08/24 12:00:00"
  },
  "metadata": {
    "timestamp_utc": "2025-08-24T02:30:00.000Z",
    "timestamp_aest": "2025/08/24 12:30:00",
    "trading_interval": 25,
    "settlement_period": 147
  }
}
```

## Validation Checks

### Data Freshness
```typescript
// Check if data is stale (>10 minutes old)
const dataAge = Date.now() - new Date(utcTimestamp).getTime();
const minutesOld = dataAge / (1000 * 60);
if (minutesOld > 10) {
  console.warn(`Data is ${minutesOld} minutes old`);
}
```

### Time Consistency
```typescript
// Ensure AEMO timestamp is valid
if (!TimeUtil.isValidAEMOTimestamp(aemoString)) {
  throw new Error(`Invalid AEMO timestamp: ${aemoString}`);
}

// Ensure UTC storage
if (!timestamp.endsWith('Z')) {
  throw new Error(`Timestamp not in UTC: ${timestamp}`);
}
```

## Common Pitfalls and Solutions

### Pitfall 1: DST Confusion
**Problem**: Sydney observes DST (Oct-Apr), but NEM doesn't
**Solution**: Always use fixed AEST (UTC+10) for NEM operations
**Example**: During Sydney DST (UTC+11), NEM remains at UTC+10
```typescript
// Oct 5, 2025: Sydney "springs forward" 2 AM -> 3 AM
// But NEM treats 2:30 AM as valid (no gap)
const dstEdge = "2025/10/05 02:30:00";
const utc = TimeUtil.parseAEMOToUTC(dstEdge);
// Returns: "2025-10-04T16:30:00.000Z" (correctly ignores DST)
```

### Pitfall 2: Hour Borrowing in Date Math
**Problem**: Subtracting 10 hours from early morning AEST crosses date boundary
**Solution**: Use Date.setHours() which handles borrowing automatically
**Example**: 2 AM AEST - 10 hours = 4 PM UTC previous day

### Pitfall 3: Server Timezone
**Problem**: Cloudflare Workers run in different regions
**Solution**: Always use UTC for storage and calculations
**Never**: Rely on server's local timezone

### Pitfall 4: User Timezone
**Problem**: Users in Perth (UTC+8) see different local time
**Solution**: Show both AEST (for NEM) and local time (for user)
**Display**: "12:00 PM AEST (10:00 AM AWST)"

### Pitfall 5: Date Boundaries
**Problem**: Trading day starts at 4 AM AEST, not midnight
**Solution**: Use `TimeUtil.getNEMTradingDayStart()`
**Note**: A single trading day spans two calendar days

### Pitfall 6: Interval Alignment
**Problem**: Data arrives at 12:03, needs 12:00 interval
**Solution**: Use `TimeUtil.getSettlementPeriod()` for rounding
**Formula**: `Math.floor(minutes / 5) * 5`

## Testing Checklist

- [ ] All timestamps stored as UTC ISO strings
- [ ] AEMO parser handles all date formats
- [ ] Peak period detection works across DST changes
- [ ] Trading day boundaries correct at 4 AM AEST
- [ ] Settlement periods align to 5-minute boundaries
- [ ] Trading intervals align to 30-minute boundaries
- [ ] Frontend displays correct local time
- [ ] API returns both UTC and AEST
- [ ] Validation checks data freshness correctly
- [ ] Scheduling runs at AEST times, not server time
- [ ] DST edge cases handled (e.g., Oct/Apr transitions)
- [ ] Hour borrowing works for early morning times
- [ ] Negative data age handled correctly

## Known AEMO Quirks

1. **Trading Day ≠ Calendar Day**: Runs 4 AM to 4 AM AEST
2. **Period Numbering**: Starts at 1, not 0 (periods 1-288, intervals 1-48)
3. **Fixed Timezone**: UTC+10 year-round, even during DST
4. **Settlement Timing**: 5-min data published ~5 mins after interval end
5. **Revision Cycles**: Initial, preliminary, final prices at different times
6. **Weekend Peaks**: No peak periods on weekends/holidays
7. **FCAS Co-optimization**: Runs on same 5-min cycle as energy

## Migration Guide

If you find code using direct `Date()` calls:

1. **Replace timestamp generation**:
   ```typescript
   // Old
   const timestamp = new Date().toISOString();
   // New
   const timestamp = TimeUtil.nowUTC();
   ```

2. **Replace AEMO parsing**:
   ```typescript
   // Old
   const date = new Date(aemoString);
   // New
   const utcDate = TimeUtil.parseAEMOToUTC(aemoString);
   ```

3. **Replace display formatting**:
   ```typescript
   // Old
   const display = new Date(utc).toLocaleString();
   // New
   const display = TimeUtil.formatForDisplay(utc);
   ```

## Enforcement

1. **Code Reviews**: Reject PRs with direct `Date()` usage
2. **Linting**: Add ESLint rule to flag `new Date()`
3. **Testing**: Require TimeUtil in all time-related tests
4. **Documentation**: Link to this guide in code comments

## Testing Edge Cases

```typescript
// DST Transition Test
TimeUtil.testDSTEdge(); // Verifies DST is ignored

// Early Morning Borrowing
const early = TimeUtil.parseAEMOToUTC("2025/08/24 02:00:00");
console.assert(early === "2025-08-23T16:00:00.000Z"); // Previous day UTC

// Trading Day Boundary
const beforeTrading = TimeUtil.parseAEMOToUTC("2025/08/24 03:59:00");
const tradingStart = TimeUtil.getNEMTradingDayStart(beforeTrading);
console.assert(tradingStart === "2025-08-22T18:00:00.000Z"); // Previous day 4 AM AEST

// Settlement Period Alignment
const unaligned = TimeUtil.parseAEMOToUTC("2025/08/24 12:03:27");
const aligned = TimeUtil.getSettlementPeriod(unaligned);
console.assert(aligned === "2025-08-24T02:00:00.000Z"); // Rounds to 12:00 AEST
```

## Support

For questions about time handling:
1. Check this documentation first
2. Review `shared/utils/time.ts` implementation
3. Run `TimeUtil.testDSTEdge()` to verify setup
4. Test edge cases with examples above
5. Contact platform team if unclear

---

**Version**: 1.1.0
**Last Updated**: August 2025
**Critical**: This is the single source of truth for time handling in Sunney.io
**Changes**: Added DST edge handling, hour borrowing fixes, AEMO quirks section