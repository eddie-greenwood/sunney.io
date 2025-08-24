/**
 * Comprehensive Data Fetcher for AEMO
 * Fetches and stores ALL market data
 */

import { 
  parseComprehensiveDispatchData, 
  parseSCADAData, 
  parseNextDayDispatch, 
  parseP5MinData,
  parseTradingData,
  type TradingData 
} from './aemo-comprehensive-parser';
import { fetchWithTruncationHandling, extractZipLinksFromHTML, getLatestFile } from './aemo-parser';
import { getGeneratorInfo, aggregateFuelTypes } from './duid-fuel-mapping';
import { TimeUtil } from '../../../shared/utils/time';

const AEMO_BASE = 'https://nemweb.com.au';
const AEMO_BASE_CAPITAL = 'https://www.nemweb.com.au/REPORTS';  // Some paths use capitals

/**
 * Fetch with retry logic for resilience
 */
async function fetchWithRetry(
  url: string, 
  options: RequestInit = {}, 
  maxRetries: number = 3,
  backoffMs: number = 1000
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
          'Accept': 'application/zip,application/octet-stream,*/*',
          ...options.headers
        }
      });
      
      if (response.ok) {
        return response;
      }
      
      // For server errors, retry with backoff
      if (response.status >= 500) {
        lastError = new Error(`Server error ${response.status}: ${response.statusText}`);
        console.log(`Retry ${attempt + 1}/${maxRetries} for ${url} after ${response.status} error`);
        await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, attempt)));
        continue;
      }
      
      // For client errors, don't retry
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      
    } catch (error) {
      lastError = error as Error;
      
      // Network errors - retry with backoff
      if (attempt < maxRetries - 1) {
        console.log(`Retry ${attempt + 1}/${maxRetries} for ${url} after network error`);
        await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, attempt)));
      }
    }
  }
  
  throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries} attempts`);
}

export async function fetchAndStoreComprehensiveData(env: any): Promise<void> {
  console.log('Starting comprehensive AEMO data fetch...');
  
  try {
    // Parallel fetch for independent data sources
    const fetchPromises = [
      // Critical real-time data
      fetchDispatchData(env).catch(err => {
        console.error('DISPATCHIS fetch failed:', err);
        return null;
      }),
      
      // SCADA for real-time generation
      fetchScadaData(env).catch(err => {
        console.error('SCADA fetch failed:', err);
        return null;
      }),
      
      // P5MIN for 5-minute forecasts
      fetchP5MinData(env).catch(err => {
        console.error('P5MIN fetch failed:', err);
        return null;
      })
    ];
    
    // Execute parallel fetches
    const results = await Promise.all(fetchPromises);
    
    // Log fetch results
    const successCount = results.filter(r => r !== null).length;
    console.log(`Parallel fetch completed: ${successCount}/${fetchPromises.length} successful`);
    
    // Sequential fetch for less critical or dependent data with rate limiting
    try {
      await fetchNextDayDispatchData(env);
      await new Promise(resolve => setTimeout(resolve, 500));  // Rate limit delay
    } catch (err) {
      console.error('Next Day Dispatch fetch failed (non-critical):', err);
    }
    
    try {
      await fetchTradingData(env);
      await new Promise(resolve => setTimeout(resolve, 500));  // Rate limit delay
    } catch (err) {
      console.error('Trading data fetch failed (non-critical):', err);
    }
    
    console.log('Comprehensive data fetch completed');
  } catch (error) {
    console.error('Comprehensive fetch error:', error);
    throw error;
  }
}

async function fetchDispatchData(env: any): Promise<void> {
  const url = `${AEMO_BASE}/Reports/Current/DispatchIS_Reports/`;
  
  try {
    const html = await fetchWithTruncationHandling(url);
    const files = extractZipLinksFromHTML(html);
    const latestFile = getLatestFile(files, 'DISPATCHIS');
    
    if (!latestFile) {
      console.log('No DISPATCHIS files found');
      return;
    }
    
    console.log(`Fetching comprehensive dispatch data from: ${latestFile}`);
    
    const fileResponse = await fetchWithRetry(`${url}${latestFile}`);
    
    if (!fileResponse.ok) {
      throw new Error(`Failed to download ${latestFile}: ${fileResponse.status}`);
    }
    
    const arrayBuffer = await fileResponse.arrayBuffer();
    
    // Store raw file in R2
    const timestamp = TimeUtil.nowUTC();
    const r2Key = `raw/${timestamp.split('T')[0]}/dispatch/${latestFile}`;
    await env.ARCHIVE.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType: 'application/zip' },
      customMetadata: {
        source: 'AEMO',
        type: 'DISPATCH',
        timestamp
      }
    });
    
    // Parse comprehensive data
    const data = await parseComprehensiveDispatchData(arrayBuffer);
    
    // Store all data types
    await storeDispatchPrices(env, data);
    await storeInterconnectorFlows(env, data);
    await storeConstraints(env, data);
    await storeFCASPrices(env, data);
    await storeGeneratorDispatch(env, data);
    
    // Update cache with latest comprehensive data
    await updateComprehensiveCache(env, data);
    
    console.log(`Stored comprehensive dispatch data: ${data.prices.length} prices, ${data.interconnectors.length} interconnectors, ${data.constraints.length} constraints`);
    
  } catch (error) {
    console.error('Error fetching dispatch data:', error);
    throw error;
  }
}

async function storeDispatchPrices(env: any, data: any): Promise<void> {
  if (data.prices.length === 0) return;
  
  const stmt = env.DB.prepare(`
    INSERT INTO dispatch_prices (region, price, demand, generation, net_interchange, settlement_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(region, settlement_date) DO UPDATE SET
      price = excluded.price,
      demand = excluded.demand,
      generation = excluded.generation,
      net_interchange = excluded.net_interchange,
      created_at = excluded.created_at
  `);
  
  const batch: any[] = [];
  for (const price of data.prices) {
    // Data already merged in parser
    batch.push(stmt.bind(
      price.region,
      price.rrp,
      price.demand || 0,
      price.generation || 0,
      price.net_interchange || 0,
      price.settlement_date
    ));
  }
  
  await env.DB.batch(batch);
}

async function storeInterconnectorFlows(env: any, data: any): Promise<void> {
  if (data.interconnectors.length === 0) return;
  
  const stmt = env.DB.prepare(`
    INSERT INTO interconnector_flows (interconnector, from_region, to_region, flow_mw, limit_mw, settlement_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(interconnector, settlement_date) DO UPDATE SET
      flow_mw = excluded.flow_mw,
      limit_mw = excluded.limit_mw,
      created_at = excluded.created_at
  `);
  
  const batch: any[] = [];
  for (const flow of data.interconnectors) {
    batch.push(stmt.bind(
      flow.interconnector_id,
      flow.from_region,
      flow.to_region,
      flow.mw_flow,
      flow.export_limit,
      flow.settlement_date
    ));
  }
  
  await env.DB.batch(batch);
}

async function storeConstraints(env: any, data: any): Promise<void> {
  // Create constraints table if it doesn't exist
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS constraints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      constraint_id TEXT NOT NULL,
      rhs REAL,
      marginal_value REAL,
      violation_degree REAL,
      settlement_date TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(constraint_id, settlement_date)
    )
  `).run();
  
  if (data.constraints.length === 0) return;
  
  const stmt = env.DB.prepare(`
    INSERT INTO constraints (constraint_id, rhs, marginal_value, violation_degree, settlement_date, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(constraint_id, settlement_date) DO UPDATE SET
      rhs = excluded.rhs,
      marginal_value = excluded.marginal_value,
      violation_degree = excluded.violation_degree,
      created_at = excluded.created_at
  `);
  
  const batch: any[] = [];
  for (const constraint of data.constraints) {
    batch.push(stmt.bind(
      constraint.constraint_id,
      constraint.rhs,
      constraint.marginal_value,
      constraint.violation_degree,
      constraint.settlement_date
    ));
  }
  
  await env.DB.batch(batch);
}

async function storeFCASPrices(env: any, data: any): Promise<void> {
  if (data.fcas.length === 0) return;
  
  const stmt = env.DB.prepare(`
    INSERT INTO fcas_prices (region, service, price, enablement_min, enablement_max, settlement_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(region, service, settlement_date) DO UPDATE SET
      price = excluded.price,
      enablement_min = excluded.enablement_min,
      enablement_max = excluded.enablement_max,
      created_at = excluded.created_at
  `);
  
  const batch: any[] = [];
  for (const fcas of data.fcas) {
    batch.push(stmt.bind(
      fcas.region,
      fcas.service,
      fcas.price,  // Changed from rrp to price to match interface
      fcas.enablement_min,
      fcas.enablement_max,
      fcas.settlement_date
    ));
  }
  
  await env.DB.batch(batch);
}

async function storeGeneratorDispatch(env: any, data: any): Promise<void> {
  // Create generator_dispatch table if it doesn't exist
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS generator_dispatch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      duid TEXT NOT NULL,
      initialmw REAL,
      totalcleared REAL,
      availability REAL,
      raise5min REAL,
      lower5min REAL,
      raise60sec REAL,
      lower60sec REAL,
      raise6sec REAL,
      lower6sec REAL,
      raisereg REAL,
      lowerreg REAL,
      semidispatch_cap REAL,
      intervention INTEGER DEFAULT 0,
      settlement_date TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(duid, settlement_date, intervention)
    )
  `).run();
  
  if (data.generators.length === 0) return;
  
  const stmt = env.DB.prepare(`
    INSERT INTO generator_dispatch (
      duid, initialmw, totalcleared, availability,
      raise5min, lower5min, raise60sec, lower60sec,
      raise6sec, lower6sec, raisereg, lowerreg,
      semidispatch_cap, intervention, settlement_date, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(duid, settlement_date, intervention) DO UPDATE SET
      initialmw = excluded.initialmw,
      totalcleared = excluded.totalcleared,
      availability = excluded.availability,
      created_at = excluded.created_at
  `);
  
  const batch: any[] = [];
  for (const gen of data.generators) {
    batch.push(stmt.bind(
      gen.duid,
      gen.initialmw,
      gen.totalcleared,
      gen.availability,
      gen.raise5min,
      gen.lower5min,
      gen.raise60sec,
      gen.lower60sec,
      gen.raise6sec,
      gen.lower6sec,
      gen.raisereg,
      gen.lowerreg,
      gen.semidispatch_cap,
      gen.intervention || 0,
      gen.settlement_date
    ));
  }
  
  await env.DB.batch(batch);
}

async function storeP5MinForecasts(env: any, data: any): Promise<void> {
  if (!data.regionSolutions || data.regionSolutions.length === 0) {
    console.log('No P5MIN forecasts to store');
    return;
  }
  
  // Store region forecasts
  const regionStmt = env.DB.prepare(`
    INSERT INTO p5min_region_forecasts (
      interval_datetime, region, rrp, eep, total_demand, 
      available_generation, available_load, dispatchable_generation, 
      dispatchable_load, net_interchange, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(interval_datetime, region) DO UPDATE SET
      rrp = excluded.rrp,
      eep = excluded.eep,
      total_demand = excluded.total_demand,
      available_generation = excluded.available_generation,
      available_load = excluded.available_load,
      dispatchable_generation = excluded.dispatchable_generation,
      dispatchable_load = excluded.dispatchable_load,
      net_interchange = excluded.net_interchange,
      created_at = excluded.created_at
  `);
  
  const regionBatch: any[] = [];
  for (const forecast of data.regionSolutions) {
    regionBatch.push(regionStmt.bind(
      forecast.interval_datetime,
      forecast.region,
      forecast.rrp,
      forecast.eep,
      forecast.total_demand,
      forecast.available_generation,
      forecast.available_load,
      forecast.dispatchable_generation,
      forecast.dispatchable_load,
      forecast.net_interchange
    ));
  }
  
  await env.DB.batch(regionBatch);
  console.log(`Stored ${data.regionSolutions.length} P5MIN region forecasts`);
  
  // Store unit forecasts if present
  if (data.unitSolutions && data.unitSolutions.length > 0) {
    const unitStmt = env.DB.prepare(`
      INSERT INTO p5min_unit_forecasts (
        interval_datetime, duid, agc_status, energy,
        raise6sec, raise60sec, raise5min, raisereg,
        lower6sec, lower60sec, lower5min, lowerreg,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(interval_datetime, duid) DO UPDATE SET
        agc_status = excluded.agc_status,
        energy = excluded.energy,
        raise6sec = excluded.raise6sec,
        raise60sec = excluded.raise60sec,
        raise5min = excluded.raise5min,
        raisereg = excluded.raisereg,
        lower6sec = excluded.lower6sec,
        lower60sec = excluded.lower60sec,
        lower5min = excluded.lower5min,
        lowerreg = excluded.lowerreg,
        created_at = excluded.created_at
    `);
    
    const unitBatch: any[] = [];
    for (const unit of data.unitSolutions) {
      unitBatch.push(unitStmt.bind(
        unit.interval_datetime,
        unit.duid,
        unit.agc_status,
        unit.energy,
        unit.raise6sec,
        unit.raise60sec,
        unit.raise5min,
        unit.raisereg,
        unit.lower6sec,
        unit.lower60sec,
        unit.lower5min,
        unit.lowerreg
      ));
    }
    
    await env.DB.batch(unitBatch);
    console.log(`Stored ${data.unitSolutions.length} P5MIN unit forecasts`);
  }
}

async function storeTradingData(env: any, data: TradingData): Promise<void> {
  // Create tables if they don't exist
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS trading_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_date TEXT NOT NULL,
      run_no INTEGER NOT NULL,
      region TEXT NOT NULL,
      period_id INTEGER NOT NULL,
      rrp REAL,
      eep REAL,
      rop REAL,
      apc_flag INTEGER,
      raise6sec_rrp REAL,
      raise60sec_rrp REAL,
      raise5min_rrp REAL,
      raisereg_rrp REAL,
      lower6sec_rrp REAL,
      lower60sec_rrp REAL,
      lower5min_rrp REAL,
      lowerreg_rrp REAL,
      raise1sec_rrp REAL,
      lower1sec_rrp REAL,
      price_status TEXT,
      lastchanged TEXT,
      invalid_flag TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(settlement_date, run_no, region, period_id)
    )
  `).run();
  
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS trading_region_sums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_date TEXT NOT NULL,
      run_no INTEGER NOT NULL,
      region TEXT NOT NULL,
      period_id INTEGER NOT NULL,
      total_demand REAL,
      available_generation REAL,
      available_load REAL,
      demand_forecast REAL,
      dispatchable_generation REAL,
      dispatchable_load REAL,
      net_interchange REAL,
      excess_generation REAL,
      lowerreg_dispatch REAL,
      raisereg_dispatch REAL,
      lower5min_dispatch REAL,
      raise5min_dispatch REAL,
      lastchanged TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(settlement_date, run_no, region, period_id)
    )
  `).run();
  
  // Batch insert prices
  if (data.prices.length > 0) {
    const stmt = env.DB.prepare(`
      INSERT INTO trading_prices (
        settlement_date, run_no, region, period_id, 
        rrp, eep, rop, apc_flag,
        raise6sec_rrp, raise60sec_rrp, raise5min_rrp, raisereg_rrp,
        lower6sec_rrp, lower60sec_rrp, lower5min_rrp, lowerreg_rrp,
        raise1sec_rrp, lower1sec_rrp,
        price_status, lastchanged, invalid_flag
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(settlement_date, run_no, region, period_id) DO UPDATE SET
        rrp = excluded.rrp,
        eep = excluded.eep,
        rop = excluded.rop,
        apc_flag = excluded.apc_flag,
        raise6sec_rrp = excluded.raise6sec_rrp,
        raise60sec_rrp = excluded.raise60sec_rrp,
        raise5min_rrp = excluded.raise5min_rrp,
        raisereg_rrp = excluded.raisereg_rrp,
        lower6sec_rrp = excluded.lower6sec_rrp,
        lower60sec_rrp = excluded.lower60sec_rrp,
        lower5min_rrp = excluded.lower5min_rrp,
        lowerreg_rrp = excluded.lowerreg_rrp,
        raise1sec_rrp = excluded.raise1sec_rrp,
        lower1sec_rrp = excluded.lower1sec_rrp,
        price_status = excluded.price_status,
        lastchanged = excluded.lastchanged,
        invalid_flag = excluded.invalid_flag
    `);
    
    const batch: any[] = [];
    for (const p of data.prices) {
      batch.push(stmt.bind(
        p.settlement_date,
        p.run_no,
        p.region,
        p.period_id,
        p.rrp,
        p.eep,
        p.rop,
        p.apc_flag || null,
        p.raise6sec_rrp || null,
        p.raise60sec_rrp || null,
        p.raise5min_rrp || null,
        p.raisereg_rrp || null,
        p.lower6sec_rrp || null,
        p.lower60sec_rrp || null,
        p.lower5min_rrp || null,
        p.lowerreg_rrp || null,
        p.raise1sec_rrp || null,
        p.lower1sec_rrp || null,
        p.price_status || null,
        p.lastchanged || null,
        p.invalid_flag || null
      ));
    }
    
    await env.DB.batch(batch);
    console.log(`Stored ${data.prices.length} trading prices`);
  }
  
  // Batch insert region sums
  if (data.regionSums.length > 0) {
    const stmt = env.DB.prepare(`
      INSERT INTO trading_region_sums (
        settlement_date, run_no, region, period_id,
        total_demand, available_generation, available_load, demand_forecast,
        dispatchable_generation, dispatchable_load, net_interchange, excess_generation,
        lowerreg_dispatch, raisereg_dispatch, lower5min_dispatch, raise5min_dispatch,
        lastchanged
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(settlement_date, run_no, region, period_id) DO UPDATE SET
        total_demand = excluded.total_demand,
        available_generation = excluded.available_generation,
        available_load = excluded.available_load,
        demand_forecast = excluded.demand_forecast,
        dispatchable_generation = excluded.dispatchable_generation,
        dispatchable_load = excluded.dispatchable_load,
        net_interchange = excluded.net_interchange,
        excess_generation = excluded.excess_generation,
        lowerreg_dispatch = excluded.lowerreg_dispatch,
        raisereg_dispatch = excluded.raisereg_dispatch,
        lower5min_dispatch = excluded.lower5min_dispatch,
        raise5min_dispatch = excluded.raise5min_dispatch,
        lastchanged = excluded.lastchanged
    `);
    
    const batch: any[] = [];
    for (const rs of data.regionSums) {
      batch.push(stmt.bind(
        rs.settlement_date,
        rs.run_no,
        rs.region,
        rs.period_id,
        rs.total_demand,
        rs.available_generation,
        rs.available_load,
        rs.demand_forecast,
        rs.dispatchable_generation,
        rs.dispatchable_load,
        rs.net_interchange,
        rs.excess_generation,
        rs.lowerreg_dispatch || null,
        rs.raisereg_dispatch || null,
        rs.lower5min_dispatch || null,
        rs.raise5min_dispatch || null,
        rs.lastchanged || null
      ));
    }
    
    await env.DB.batch(batch);
    console.log(`Stored ${data.regionSums.length} trading region sums`);
  }
}

async function updateComprehensiveCache(env: any, data: any): Promise<void> {
  const cacheData = {
    timestamp: TimeUtil.nowUTC(),
    settlement_date: data.prices[0]?.settlement_date,
    prices: data.prices.map((p: any) => ({
      region: p.region,
      rrp: p.rrp,
      eep: p.eep,
      rop: p.rop,
      apc_flag: p.apc_flag
    })),
    interconnectors: data.interconnectors.map((i: any) => ({
      id: i.interconnector_id,
      flow: i.mw_flow,
      losses: i.mw_losses,
      limit: i.export_limit
    })),
    constraints: data.constraints.filter((c: any) => c.marginal_value > 0).slice(0, 10), // Top 10 binding constraints
    fcas_summary: {
      raise_total: data.fcas.filter((f: any) => f.service.includes('RAISE')).reduce((sum: any, f: any) => sum + f.price, 0),
      lower_total: data.fcas.filter((f: any) => f.service.includes('LOWER')).reduce((sum: any, f: any) => sum + f.price, 0)
    },
    generators_count: data.generators.length
  };
  
  await env.CACHE.put('comprehensive:latest', JSON.stringify(cacheData), {
    expirationTtl: 300 // 5 minutes
  });
}

// P5MIN Predispatch
async function fetchP5MinData(env: any): Promise<void> {
  const url = `${AEMO_BASE}/Reports/Current/P5_Reports/`;
  
  try {
    const html = await fetchWithTruncationHandling(url);
    const files = extractZipLinksFromHTML(html);
    const latestFile = getLatestFile(files, 'P5MIN');
    
    if (!latestFile) {
      console.log('No P5MIN files found');
      return;
    }
    
    console.log(`Fetching P5MIN file: ${latestFile}`);
    
    const fileResponse = await fetch(`${url}${latestFile}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
        'Accept': 'application/zip,application/octet-stream,*/*'
      }
    });
    
    if (!fileResponse.ok) {
      throw new Error(`Failed to download P5MIN ${latestFile}: ${fileResponse.status}`);
    }
    
    const arrayBuffer = await fileResponse.arrayBuffer();
    
    // Store raw file
    const timestamp = new Date().toISOString();
    const r2Key = `raw/${timestamp.split('T')[0]}/p5min/${latestFile}`;
    await env.ARCHIVE.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType: 'application/zip' },
      customMetadata: {
        source: 'AEMO',
        type: 'P5MIN',
        timestamp
      }
    });
    
    // Parse P5MIN data
    const p5minData = await parseP5MinData(arrayBuffer);
    
    // Store P5MIN forecast data
    await storeP5MinForecasts(env, p5minData);
    console.log('P5MIN data archived');
    
  } catch (error) {
    console.error('Error fetching P5MIN data:', error);
  }
}

// Trading Interval Data (30-minute)
async function fetchTradingData(env: any): Promise<void> {
  // Note: TRADINGIS reports are typically published as weekly archives
  // Individual files in Current may be empty placeholders
  const urls = [
    `${AEMO_BASE_CAPITAL}/CURRENT/TradingIS_Reports/`,  // Try current first
    `${AEMO_BASE_CAPITAL}/ARCHIVE/TradingIS_Reports/`   // Fall back to archive
  ];
  
  for (const url of urls) {
    try {
      const html = await fetchWithTruncationHandling(url);
      const files = extractZipLinksFromHTML(html);
      let latestFile = getLatestFile(files, 'TRADINGIS');
    
    if (!latestFile) {
      console.log('No TRADINGIS files found');
      return;
    }
    
    console.log(`Fetching Trading file: ${latestFile}`);
    
    const fileResponse = await fetchWithRetry(`${url}${latestFile}`);
    
    if (!fileResponse.ok) {
      throw new Error(`Failed to download ${latestFile}: ${fileResponse.status}`);
    }
    
    const arrayBuffer = await fileResponse.arrayBuffer();
    
    // Store raw file in R2
    const timestamp = TimeUtil.nowUTC();
    const r2Key = `raw/${timestamp.split('T')[0]}/trading/${latestFile}`;
    await env.ARCHIVE.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType: 'application/zip' },
      customMetadata: {
        source: 'AEMO',
        type: 'TRADINGIS',
        timestamp
      }
    });
    
    // Parse Trading data
    const tradingData = await parseTradingData(arrayBuffer);
    
    // Store Trading data in database
    await storeTradingData(env, tradingData);
    console.log('TRADINGIS data archived and stored');
    return;  // Success - exit the loop
      
    } catch (error) {
      console.error(`Error fetching Trading data from ${url}:`, error);
      // Continue to next URL
    }
  }
  
  console.log('Failed to fetch TRADINGIS data from all sources');
}

// Next Day Dispatch - Contains UNIT_SOLUTION (generator) data
async function fetchNextDayDispatchData(env: any): Promise<void> {
  // Try both Current and Archive locations
  const urls = [
    `${AEMO_BASE}/Reports/Current/Next_Day_Dispatch/`,
    `${AEMO_BASE}/Reports/Archive/Next_Day/Dispatch/`
  ];
  
  for (const url of urls) {
    try {
      console.log(`Checking Next Day Dispatch at: ${url}`);
      const html = await fetchWithTruncationHandling(url);
      const files = extractZipLinksFromHTML(html);
      
      // Next Day Dispatch files have pattern: PUBLIC_NEXT_DAY_DISPATCH_YYYYMMDD_*.zip
      const nextDayFiles = files.filter(f => f.includes('NEXT_DAY_DISPATCH'));
      
      if (nextDayFiles.length === 0) {
        console.log(`No Next Day Dispatch files found at ${url}`);
        continue;
      }
      
      // Get the most recent file
      const latestFile = nextDayFiles.sort().pop();
      
      if (!latestFile) {
        continue;
      }
      
      console.log(`Fetching Next Day Dispatch file: ${latestFile}`);
      
      const fileResponse = await fetch(`${url}${latestFile}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
          'Accept': 'application/zip,application/octet-stream,*/*'
        }
      });
      
      if (!fileResponse.ok) {
        console.log(`Failed to download ${latestFile}: ${fileResponse.status}`);
        continue;
      }
      
      const arrayBuffer = await fileResponse.arrayBuffer();
      console.log(`Downloaded Next Day Dispatch: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
      
      // Parse Next Day Dispatch data using specialized parser
      const data = await parseNextDayDispatch(arrayBuffer);
      
      // Store generator dispatch data if we got UNIT_SOLUTION records
      if (data.generators.length > 0) {
        await storeGeneratorDispatch(env, data);
        console.log(`Stored ${data.generators.length} generator UNIT_SOLUTION records from Next Day Dispatch`);
      }
      
      // Store other data types from Next Day Dispatch
      if (data.constraints.length > 0) {
        await storeConstraints(env, data);
      }
      
      // Archive raw file
      const timestamp = TimeUtil.nowUTC();
      const r2Key = `raw/${timestamp.split('T')[0]}/nextday/${latestFile}`;
      await env.ARCHIVE.put(r2Key, arrayBuffer, {
        httpMetadata: { contentType: 'application/zip' },
        customMetadata: {
          source: 'AEMO',
          type: 'NEXT_DAY_DISPATCH',
          timestamp,
          generators: data.generators.length.toString(),
          constraints: data.constraints.length.toString()
        }
      });
      
      // Success - exit loop
      return;
      
    } catch (error) {
      console.error(`Error fetching Next Day Dispatch from ${url}:`, error);
    }
  }
  
  console.log('Could not fetch Next Day Dispatch from any source');
}

// SCADA Real-time Generation
async function fetchScadaData(env: any): Promise<void> {
  const url = `${AEMO_BASE}/Reports/Current/Dispatch_SCADA/`;
  
  try {
    const html = await fetchWithTruncationHandling(url);
    const files = extractZipLinksFromHTML(html);
    const latestFile = getLatestFile(files, 'DISPATCHSCADA');  // Correct prefix
    
    if (!latestFile) {
      console.log('No SCADA files found');
      return;
    }
    
    console.log(`Fetching SCADA file: ${latestFile}`);
    
    const fileResponse = await fetch(`${url}${latestFile}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
        'Accept': 'application/zip,application/octet-stream,*/*'
      }
    });
    
    if (!fileResponse.ok) {
      throw new Error(`Failed to download SCADA ${latestFile}: ${fileResponse.status}`);
    }
    
    const arrayBuffer = await fileResponse.arrayBuffer();
    
    // Parse SCADA data
    const scadaUnits = await parseSCADAData(arrayBuffer);
    
    // Store SCADA data
    await storeSCADAData(env, scadaUnits);
    
    // Archive raw file
    const timestamp = new Date().toISOString();
    const r2Key = `raw/${timestamp.split('T')[0]}/scada/${latestFile}`;
    await env.ARCHIVE.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType: 'application/zip' },
      customMetadata: {
        source: 'AEMO',
        type: 'SCADA',
        timestamp
      }
    });
    
    console.log(`Stored ${scadaUnits.length} SCADA unit records (real-time generator output)`);
    
  } catch (error) {
    console.error('Error fetching SCADA data:', error);
  }
}

// Store SCADA generator data with fuel type mapping
async function storeSCADAData(env: any, scadaUnits: any[]): Promise<void> {
  // Create enhanced table with fuel type and station info
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS generator_scada (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      duid TEXT NOT NULL,
      scadavalue REAL NOT NULL,
      settlement_date TEXT NOT NULL,
      fuel_type TEXT,
      fuel_category TEXT,
      station_name TEXT,
      capacity_mw REAL,
      region TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(duid, settlement_date)
    )
  `).run();
  
  // Create aggregation table for fuel types
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS generation_by_fuel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_date TEXT NOT NULL,
      fuel_type TEXT NOT NULL,
      fuel_category TEXT NOT NULL,
      total_mw REAL NOT NULL,
      unit_count INTEGER NOT NULL,
      region TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(settlement_date, fuel_type, region)
    )
  `).run();
  
  if (scadaUnits.length === 0) return;
  
  // Process SCADA units with fuel type mapping
  const stmt = env.DB.prepare(`
    INSERT INTO generator_scada (
      duid, scadavalue, settlement_date, 
      fuel_type, fuel_category, station_name, capacity_mw, region,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(duid, settlement_date) DO UPDATE SET
      scadavalue = excluded.scadavalue,
      fuel_type = excluded.fuel_type,
      fuel_category = excluded.fuel_category,
      station_name = excluded.station_name,
      capacity_mw = excluded.capacity_mw,
      region = excluded.region,
      created_at = excluded.created_at
  `);
  
  const batch: any[] = [];
  const fuelAggregation: Record<string, { 
    total_mw: number; 
    unit_count: number; 
    fuel_category: string;
    regions: Set<string>;
  }> = {};
  
  for (const unit of scadaUnits) {
    // Get generator info from DUID mapping
    const genInfo = getGeneratorInfo(unit.duid);
    const fuelType = genInfo ? genInfo.fuel_type : 'unknown';
    const fuelCategory = aggregateFuelTypes(fuelType);
    
    // Store individual unit data
    batch.push(stmt.bind(
      unit.duid,
      unit.scadavalue,
      unit.settlement_date,
      fuelType,
      fuelCategory,
      genInfo?.station_name || null,
      genInfo?.capacity_mw || null,
      genInfo?.region || null
    ));
    
    // Aggregate by fuel type (only positive generation)
    if (unit.scadavalue > 0) {
      if (!fuelAggregation[fuelType]) {
        fuelAggregation[fuelType] = {
          total_mw: 0,
          unit_count: 0,
          fuel_category: fuelCategory,
          regions: new Set()
        };
      }
      fuelAggregation[fuelType].total_mw += unit.scadavalue;
      fuelAggregation[fuelType].unit_count += 1;
      if (genInfo?.region) {
        fuelAggregation[fuelType].regions.add(genInfo.region);
      }
    }
  }
  
  // Store individual unit data
  await env.DB.batch(batch);
  
  // Store aggregated fuel type data
  if (Object.keys(fuelAggregation).length > 0 && scadaUnits[0]) {
    const aggStmt = env.DB.prepare(`
      INSERT INTO generation_by_fuel (
        settlement_date, fuel_type, fuel_category, 
        total_mw, unit_count, region, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(settlement_date, fuel_type, region) DO UPDATE SET
        fuel_category = excluded.fuel_category,
        total_mw = excluded.total_mw,
        unit_count = excluded.unit_count,
        created_at = excluded.created_at
    `);
    
    const aggBatch: any[] = [];
    const settlementDate = scadaUnits[0].settlement_date;
    
    for (const [fuelType, data] of Object.entries(fuelAggregation)) {
      // Store one record per fuel type (NEM-wide)
      aggBatch.push(aggStmt.bind(
        settlementDate,
        fuelType,
        data.fuel_category,
        data.total_mw,
        data.unit_count,
        'NEM' // NEM-wide aggregation
      ));
    }
    
    await env.DB.batch(aggBatch);
    
    // Log summary
    console.log(`SCADA Generation Summary for ${settlementDate}:`);
    const categories: Record<string, number> = {};
    for (const [, data] of Object.entries(fuelAggregation)) {
      if (!categories[data.fuel_category]) {
        categories[data.fuel_category] = 0;
      }
      categories[data.fuel_category] += data.total_mw;
    }
    
    for (const [category, total] of Object.entries(categories)) {
      console.log(`  ${category}: ${total.toFixed(1)} MW`);
    }
  }
}