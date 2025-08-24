/**
 * Forecasting Data Fetcher
 * Implements PREDISPATCH (2-day) and ST PASA (7-day) fetching
 */

import { 
  parsePredispatchData, 
  parseStPasaData,
  type PredispatchData,
  type StPasaData
} from './aemo-comprehensive-parser';
import { fetchWithTruncationHandling, extractZipLinksFromHTML, getLatestFile } from './aemo-parser';
import { TimeUtil } from '../../../shared/utils/time';

const AEMO_BASE = 'https://nemweb.com.au';

/**
 * Fetch and store PREDISPATCH data (2-day ahead, 30-min intervals)
 * Runs every 30 minutes
 */
export async function fetchPredispatchData(env: any): Promise<void> {
  console.log('Fetching PREDISPATCH data...');
  
  try {
    // Fetch the report listing page
    const url = `${AEMO_BASE}/Reports/Current/PredispatchIS_Reports/`;
    const html = await fetchWithTruncationHandling(url);
    
    // Extract ZIP file links
    const files = extractZipLinksFromHTML(html);
    const latestFile = getLatestFile(files, 'PREDISPATCH');
    
    if (!latestFile) {
      console.log('No PREDISPATCH file found');
      return;
    }
    
    console.log(`Downloading PREDISPATCH: ${latestFile}`);
    
    // Download the ZIP file
    const fileUrl = `${url}${latestFile}`;
    const response = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
        'Accept': 'application/zip,application/octet-stream,*/*'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download PREDISPATCH: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    
    // Parse the data
    const data = await parsePredispatchData(arrayBuffer);
    console.log(`Parsed PREDISPATCH: ${data.regionSolutions.length} regions, ${data.unitSolutions.length} units`);
    
    // Store the data
    await storePredispatchForecasts(env, data);
    
    // Archive the raw file to R2
    const date = TimeUtil.nowUTC().split('T')[0];
    const r2Key = `archive/predispatch/${date}/${latestFile}`;
    await env.ARCHIVE.put(r2Key, arrayBuffer);
    
    console.log('PREDISPATCH data stored successfully');
    
  } catch (error) {
    console.error('Error fetching PREDISPATCH:', error);
  }
}

/**
 * Store PREDISPATCH forecasts in D1
 */
async function storePredispatchForecasts(env: any, data: PredispatchData): Promise<void> {
  // Create tables if not exist
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS predispatch_forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interval_datetime TEXT NOT NULL,
      region TEXT NOT NULL,
      rrp REAL,
      demand REAL,
      available_generation REAL,
      dispatchable_generation REAL,
      net_interchange REAL,
      -- FCAS requirements
      raise_6sec_req REAL,
      lower_6sec_req REAL,
      raise_60sec_req REAL,
      lower_60sec_req REAL,
      raise_5min_req REAL,
      lower_5min_req REAL,
      raise_reg_req REAL,
      lower_reg_req REAL,
      -- FCAS prices
      raise_6sec_price REAL,
      lower_6sec_price REAL,
      raise_60sec_price REAL,
      lower_60sec_price REAL,
      raise_5min_price REAL,
      lower_5min_price REAL,
      raise_reg_price REAL,
      lower_reg_price REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(interval_datetime, region)
    )
  `).run();
  
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS predispatch_unit_solutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interval_datetime TEXT NOT NULL,
      duid TEXT NOT NULL,
      traded_energy REAL,
      cleared_mw REAL,
      agc_status INTEGER,
      -- FCAS enablement
      raise_6sec REAL,
      lower_6sec REAL,
      raise_60sec REAL,
      lower_60sec REAL,
      raise_5min REAL,
      lower_5min REAL,
      raise_reg REAL,
      lower_reg REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(interval_datetime, duid)
    )
  `).run();
  
  // Batch insert region solutions
  if (data.regionSolutions.length > 0) {
    const stmt = env.DB.prepare(`
      INSERT INTO predispatch_forecasts (
        interval_datetime, region, rrp, demand, available_generation,
        dispatchable_generation, net_interchange,
        raise_6sec_req, lower_6sec_req, raise_60sec_req, lower_60sec_req,
        raise_5min_req, lower_5min_req, raise_reg_req, lower_reg_req,
        raise_6sec_price, lower_6sec_price, raise_60sec_price, lower_60sec_price,
        raise_5min_price, lower_5min_price, raise_reg_price, lower_reg_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(interval_datetime, region) DO UPDATE SET
        rrp = excluded.rrp,
        demand = excluded.demand,
        available_generation = excluded.available_generation,
        dispatchable_generation = excluded.dispatchable_generation,
        net_interchange = excluded.net_interchange,
        raise_6sec_req = excluded.raise_6sec_req,
        lower_6sec_req = excluded.lower_6sec_req,
        raise_60sec_req = excluded.raise_60sec_req,
        lower_60sec_req = excluded.lower_60sec_req,
        raise_5min_req = excluded.raise_5min_req,
        lower_5min_req = excluded.lower_5min_req,
        raise_reg_req = excluded.raise_reg_req,
        lower_reg_req = excluded.lower_reg_req,
        raise_6sec_price = excluded.raise_6sec_price,
        lower_6sec_price = excluded.lower_6sec_price,
        raise_60sec_price = excluded.raise_60sec_price,
        lower_60sec_price = excluded.lower_60sec_price,
        raise_5min_price = excluded.raise_5min_price,
        lower_5min_price = excluded.lower_5min_price,
        raise_reg_price = excluded.raise_reg_price,
        lower_reg_price = excluded.lower_reg_price,
        created_at = datetime('now')
    `);
    
    const batch: any[] = [];
    for (const solution of data.regionSolutions) {
      batch.push(stmt.bind(
        solution.interval_datetime,
        solution.region,
        solution.rrp,
        solution.demand,
        solution.available_generation,
        solution.dispatchable_generation,
        solution.net_interchange,
        solution.raise_6sec_req,
        solution.lower_6sec_req,
        solution.raise_60sec_req,
        solution.lower_60sec_req,
        solution.raise_5min_req,
        solution.lower_5min_req,
        solution.raise_reg_req,
        solution.lower_reg_req,
        solution.raise_6sec_price,
        solution.lower_6sec_price,
        solution.raise_60sec_price,
        solution.lower_60sec_price,
        solution.raise_5min_price,
        solution.lower_5min_price,
        solution.raise_reg_price,
        solution.lower_reg_price
      ));
    }
    
    await env.DB.batch(batch);
  }
  
  // Batch insert unit solutions (sample to avoid overwhelming DB)
  // Only store major generators to reduce storage
  const majorUnits = data.unitSolutions.filter(u => 
    u.cleared_mw > 50 || // Only units >50MW
    u.duid.includes('BATT') || // All batteries
    u.duid.includes('BES') // Battery energy storage
  );
  
  if (majorUnits.length > 0) {
    const unitStmt = env.DB.prepare(`
      INSERT INTO predispatch_unit_solutions (
        interval_datetime, duid, traded_energy, cleared_mw, agc_status,
        raise_6sec, lower_6sec, raise_60sec, lower_60sec,
        raise_5min, lower_5min, raise_reg, lower_reg
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(interval_datetime, duid) DO UPDATE SET
        traded_energy = excluded.traded_energy,
        cleared_mw = excluded.cleared_mw,
        agc_status = excluded.agc_status,
        raise_6sec = excluded.raise_6sec,
        lower_6sec = excluded.lower_6sec,
        raise_60sec = excluded.raise_60sec,
        lower_60sec = excluded.lower_60sec,
        raise_5min = excluded.raise_5min,
        lower_5min = excluded.lower_5min,
        raise_reg = excluded.raise_reg,
        lower_reg = excluded.lower_reg,
        created_at = datetime('now')
    `);
    
    const unitBatch: any[] = [];
    for (const unit of majorUnits) {
      unitBatch.push(unitStmt.bind(
        unit.interval_datetime,
        unit.duid,
        unit.traded_energy,
        unit.cleared_mw,
        unit.agc_status,
        unit.raise_6sec,
        unit.lower_6sec,
        unit.raise_60sec,
        unit.lower_60sec,
        unit.raise_5min,
        unit.lower_5min,
        unit.raise_reg,
        unit.lower_reg
      ));
    }
    
    await env.DB.batch(unitBatch);
  }
}

/**
 * Fetch and store ST PASA data (7-day ahead system adequacy)
 * Runs daily
 */
export async function fetchStPasaData(env: any): Promise<void> {
  console.log('Fetching ST PASA data...');
  
  try {
    // Fetch the report listing page
    const url = `${AEMO_BASE}/Reports/Current/STPASA_Reports/`;
    const html = await fetchWithTruncationHandling(url);
    
    // Extract ZIP file links
    const files = extractZipLinksFromHTML(html);
    const latestFile = getLatestFile(files, 'STPASA');
    
    if (!latestFile) {
      console.log('No ST PASA file found');
      return;
    }
    
    console.log(`Downloading ST PASA: ${latestFile}`);
    
    // Download the ZIP file
    const fileUrl = `${url}${latestFile}`;
    const response = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
        'Accept': 'application/zip,application/octet-stream,*/*'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download ST PASA: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    
    // Parse the data
    const data = await parseStPasaData(arrayBuffer);
    console.log(`Parsed ST PASA: ${data.regionSolutions.length} regions, ${data.unitAvailability.length} units`);
    
    // Store the data
    await storeStPasaForecasts(env, data);
    
    // Archive the raw file to R2
    const date = TimeUtil.nowUTC().split('T')[0];
    const r2Key = `archive/stpasa/${date}/${latestFile}`;
    await env.ARCHIVE.put(r2Key, arrayBuffer);
    
    console.log('ST PASA data stored successfully');
    
  } catch (error) {
    console.error('Error fetching ST PASA:', error);
  }
}

/**
 * Store ST PASA forecasts in D1
 */
async function storeStPasaForecasts(env: any, data: StPasaData): Promise<void> {
  // Create table if not exists
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS stpasa_forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interval_datetime TEXT NOT NULL,
      region TEXT NOT NULL,
      demand_forecast REAL,
      demand_10_percent REAL,
      demand_50_percent REAL,
      demand_90_percent REAL,
      scheduled_generation REAL,
      semi_scheduled_generation REAL,
      net_interchange REAL,
      reserve_requirement REAL,
      reserve_available REAL,
      surplus_reserve REAL,
      low_reserve_condition INTEGER,
      lack_of_reserve INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(interval_datetime, region)
    )
  `).run();
  
  // Batch insert region solutions
  if (data.regionSolutions.length > 0) {
    const stmt = env.DB.prepare(`
      INSERT INTO stpasa_forecasts (
        interval_datetime, region, demand_forecast,
        demand_10_percent, demand_50_percent, demand_90_percent,
        scheduled_generation, semi_scheduled_generation, net_interchange,
        reserve_requirement, reserve_available, surplus_reserve,
        low_reserve_condition, lack_of_reserve
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(interval_datetime, region) DO UPDATE SET
        demand_forecast = excluded.demand_forecast,
        demand_10_percent = excluded.demand_10_percent,
        demand_50_percent = excluded.demand_50_percent,
        demand_90_percent = excluded.demand_90_percent,
        scheduled_generation = excluded.scheduled_generation,
        semi_scheduled_generation = excluded.semi_scheduled_generation,
        net_interchange = excluded.net_interchange,
        reserve_requirement = excluded.reserve_requirement,
        reserve_available = excluded.reserve_available,
        surplus_reserve = excluded.surplus_reserve,
        low_reserve_condition = excluded.low_reserve_condition,
        lack_of_reserve = excluded.lack_of_reserve,
        created_at = datetime('now')
    `);
    
    const batch: any[] = [];
    for (const solution of data.regionSolutions) {
      batch.push(stmt.bind(
        solution.interval_datetime,
        solution.region,
        solution.demand_forecast,
        solution.demand_10_percent,
        solution.demand_50_percent,
        solution.demand_90_percent,
        solution.scheduled_generation,
        solution.semi_scheduled_generation,
        solution.net_interchange,
        solution.reserve_requirement,
        solution.reserve_available,
        solution.surplus_reserve,
        solution.low_reserve_condition,
        solution.lack_of_reserve
      ));
    }
    
    await env.DB.batch(batch);
  }
}

/**
 * Check if we should fetch forecasting data based on current time
 */
export async function checkAndFetchForecasts(env: any): Promise<void> {
  // Use UTC time and convert to AEST for scheduling
  const nowUTC = TimeUtil.nowUTC();
  const nowAEST = TimeUtil.nowAEST();
  
  // Parse AEST time for scheduling checks
  const aestParts = nowAEST.split(' ')[1].split(':');
  const hour = parseInt(aestParts[0]);
  const minute = parseInt(aestParts[1]);
  
  // Fetch PREDISPATCH every 30 minutes
  // Check if current minute is 0, 5, 30, or 35 (allowing for 5-minute cron)
  if (minute === 0 || minute === 5 || minute === 30 || minute === 35) {
    console.log(`Running PREDISPATCH fetch at ${hour}:${minute.toString().padStart(2, '0')}`);
    await fetchPredispatchData(env);
  }
  
  // Fetch ST PASA once daily at 1 AM (between 1:00 and 1:05)
  if (hour === 1 && minute < 5) {
    console.log(`Running ST PASA fetch at ${hour}:${minute.toString().padStart(2, '0')}`);
    await fetchStPasaData(env);
  }
}