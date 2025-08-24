// Scraper Worker - Fetches AEMO data every 5 minutes
import { 
  parseDispatchData, 
  parseFCASData,
  fetchWithTruncationHandling,
  extractZipLinksFromHTML,
  getLatestFile,
  parseBatteryDispatchData
} from './aemo-parser';
import { parseSCADAData } from './aemo-comprehensive-parser';
import { checkAndFetchForecasts } from './forecasting-fetcher';
import { validateDataPipeline, sendGoogleChatAlert } from './validation';
import { TimeUtil } from '../../../shared/utils/time';

// Import Cloudflare Workers types
/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ARCHIVE: R2Bucket;
  TRADING_ROOM: DurableObjectNamespace;
  GOOGLE_CHAT_WEBHOOK?: string;
}

const AEMO_BASE = 'https://nemweb.com.au';

export default {
  // Scheduled handler - runs every 5 minutes
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    console.log(`Scraper running at ${TimeUtil.nowUTC()} (${TimeUtil.nowAEST()} AEST)`);
    
    try {
      // Fetch dispatch data
      console.log('Fetching dispatch data...');
      await fetchDispatchData(env);
      
      // Fetch P5MIN data  
      console.log('Fetching P5MIN data...');
      await fetchP5MinData(env);
      
      // Fetch SCADA data
      console.log('Fetching SCADA data...');
      await fetchScadaData(env);
      
      // Fetch Battery Dispatch data
      console.log('Fetching Battery Dispatch data...');
      await fetchBatteryDispatchData(env);
      
      // Fetch FCAS data
      console.log('Fetching FCAS data...');
      await fetchFCASData(env);
      
      // Check and fetch forecasting data (PREDISPATCH, ST PASA)
      console.log('Checking forecasting schedules...');
      await checkAndFetchForecasts(env);
      
      // Run validation every 3rd execution (every 15 minutes)
      const currentTime = TimeUtil.nowUTC();
      const minute = new Date(currentTime).getMinutes();
      if (minute % 15 === 0) {
        console.log('Running validation checks...');
        const validationResult = await validateDataPipeline(env);
        
        if (!validationResult.passed && env.GOOGLE_CHAT_WEBHOOK) {
          await sendGoogleChatAlert(env.GOOGLE_CHAT_WEBHOOK, validationResult);
        }
        
        console.log(`Validation ${validationResult.passed ? 'passed' : 'failed'}: ${validationResult.issues.length} issues`);
      }
      
      console.log('Scraper completed successfully');
    } catch (error) {
      console.error('Scraper error:', error);
      if (error instanceof Error) {
        console.error('Error stack:', error.stack);
      }
    }
  },
  
  // Manual trigger for testing
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/trigger' && request.method === 'POST') {
      await this.scheduled(
        { scheduledTime: Date.now(), cron: '*/5 * * * *' } as unknown as ScheduledEvent,
        env,
        { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext
      );
      
      return new Response('Scraper triggered', { status: 200 });
    }
    
    if (url.pathname === '/test' && request.method === 'GET') {
      // Test AEMO fetch and parsing
      try {
        const testUrl = `${AEMO_BASE}/Reports/Current/DispatchIS_Reports/`;
        console.log('Test: Fetching from', testUrl);
        
        const response = await fetch(testUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        console.log('Test: Got HTML length', html.length);
        
        const files = extractZipLinksFromHTML(html);
        console.log('Test: Found files', files.length);
        
        const latestFile = getLatestFile(files, 'DISPATCHIS');
        console.log('Test: Latest file', latestFile);
        
        if (latestFile) {
          const fileUrl = `${testUrl}${latestFile}`;
          console.log('Test: Downloading from', fileUrl);
          
          const fileResponse = await fetch(fileUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
              'Accept': 'application/zip,application/octet-stream,*/*'
            }
          });
          
          if (!fileResponse.ok) {
            throw new Error(`ZIP download failed: ${fileResponse.status} ${fileResponse.statusText}`);
          }
          
          const arrayBuffer = await fileResponse.arrayBuffer();
          console.log('Test: Downloaded bytes', arrayBuffer.byteLength);
          
          // Try to parse
          let data: any[] = [];
          let parseError = null;
          try {
            data = await parseDispatchData(arrayBuffer);
            console.log('Test: Parsed records', data.length);
          } catch (e: any) {
            parseError = e.message;
            console.error('Test: Parse error', e);
          }
          
          return new Response(JSON.stringify({
            success: data.length > 0,
            htmlLength: html.length,
            filesFound: files.length,
            latestFile,
            fileUrl,
            bytesDownloaded: arrayBuffer.byteLength,
            recordsParsed: data.length,
            parseError,
            sampleData: data.slice(0, 2)
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        return new Response(JSON.stringify({
          success: false,
          htmlLength: html.length,
          filesFound: files.length,
          message: 'No DISPATCHIS file found'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
        
      } catch (error: any) {
        console.error('Test error:', error);
        return new Response(JSON.stringify({
          success: false,
          error: error.message,
          stack: error.stack
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'sunney-scraper',
        timestamp: TimeUtil.nowUTC()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/validate' && request.method === 'GET') {
      // Manual validation trigger
      console.log('Manual validation triggered');
      const validationResult = await validateDataPipeline(env);
      
      return new Response(JSON.stringify(validationResult), {
        status: validationResult.passed ? 200 : 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Scraper worker - POST /trigger to run manually', { status: 200 });
  }
};

async function fetchDispatchData(env: Env) {
  const url = `${AEMO_BASE}/Reports/Current/DispatchIS_Reports/`;
  
  try {
    // Fetch the directory listing with truncation handling
    console.log(`Fetching directory listing from: ${url}`);
    const html = await fetchWithTruncationHandling(url);
    console.log(`HTML length: ${html.length}`);
    
    // Extract latest DISPATCHIS file
    const files = extractZipLinksFromHTML(html);
    console.log(`Found ${files.length} ZIP files`);
    
    const latestFile = getLatestFile(files, 'DISPATCHIS');
    
    if (!latestFile) {
      console.log('No dispatch files found in:', files.slice(0, 5));
      return;
    }
    
    console.log(`Fetching dispatch file: ${latestFile}`);
    
    // Download and process
    const fileResponse = await fetch(`${url}${latestFile}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
        'Accept': 'application/zip,application/octet-stream,*/*'
      }
    });
    
    if (!fileResponse.ok) {
      throw new Error(`Failed to download ${latestFile}: ${fileResponse.status}`);
    }
    
    const arrayBuffer = await fileResponse.arrayBuffer();
    
    // Store raw file in R2
    const timestamp = TimeUtil.nowUTC();
    const r2Key = `raw/${timestamp.split('T')[0]}/dispatch/${latestFile}`;
    await env.ARCHIVE.put(r2Key, arrayBuffer, {
      httpMetadata: {
        contentType: 'application/zip'
      },
      customMetadata: {
        source: 'AEMO',
        type: 'DISPATCH',
        timestamp
      }
    });
    
    // Parse CSV data from ZIP (simplified - in production use proper ZIP library)
    const data = await parseDispatchData(arrayBuffer);
    
    // Store in database
    const stmt = env.DB.prepare(`
      INSERT INTO dispatch_prices (region, price, demand, generation, settlement_date, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(region, settlement_date) DO UPDATE SET
        price = excluded.price,
        demand = excluded.demand,
        generation = excluded.generation,
        created_at = excluded.created_at
    `);
    
    const batch: any[] = [];
    for (const record of data) {
      batch.push(stmt.bind(
        record.region,
        record.price,
        record.demand,
        record.generation || 0,
        record.settlementDate
      ));
    }
    
    await env.DB.batch(batch);
    
    // Update cache
    const latestData = {
      timestamp: TimeUtil.nowUTC(),
      settlement_date: data[0]?.settlementDate,
      regions: data.map(d => ({
        region: d.region,
        price: d.price,
        demand: d.demand,
        generation: d.generation
      }))
    };
    
    await env.CACHE.put('prices:latest', JSON.stringify(latestData), {
      expirationTtl: 300 // 5 minutes
    });
    
    // Broadcast to WebSocket clients via Durable Object
    if (env.TRADING_ROOM) {
      try {
        const id = env.TRADING_ROOM.idFromName('global');
        const room = env.TRADING_ROOM.get(id);
        
        await room.fetch(new Request('https://internal/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(latestData)
        }));
        
        console.log('Broadcasted price update to WebSocket clients');
      } catch (error) {
        console.error('Error broadcasting prices:', error);
      }
    }
    
    console.log(`Stored ${data.length} dispatch records`);
  } catch (error) {
    console.error('Error fetching dispatch data:', error);
  }
}

async function fetchP5MinData(env: Env) {
  const url = `${AEMO_BASE}/Reports/Current/P5_Reports/`;
  
  try {
    // Fetch with truncation handling
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
    const timestamp = TimeUtil.nowUTC();
    const r2Key = `raw/${timestamp.split('T')[0]}/p5min/${latestFile}`;
    await env.ARCHIVE.put(r2Key, arrayBuffer, {
      httpMetadata: {
        contentType: 'application/zip'
      },
      customMetadata: {
        source: 'AEMO',
        type: 'P5MIN',
        timestamp
      }
    });
    
    console.log('P5MIN data stored');
  } catch (error) {
    console.error('Error fetching P5MIN data:', error);
  }
}

async function fetchFCASData(env: Env) {
  console.log('Fetching FCAS data...');
  
  try {
    // FCAS data is included in the DISPATCHIS files
    // We'll extract it from the same dispatch report
    const url = `${AEMO_BASE}/Reports/Current/DispatchIS_Reports/`;
    
    const html = await fetchWithTruncationHandling(url);
    const files = extractZipLinksFromHTML(html);
    const latestFile = getLatestFile(files, 'DISPATCHIS');
    
    if (!latestFile) {
      console.log('No dispatch files found for FCAS');
      return;
    }
    
    console.log(`Fetching FCAS from dispatch file: ${latestFile}`);
    
    const fileResponse = await fetch(`${url}${latestFile}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
        'Accept': 'application/zip,application/octet-stream,*/*'
      }
    });
    
    if (!fileResponse.ok) {
      throw new Error(`Failed to download FCAS ${latestFile}: ${fileResponse.status}`);
    }
    
    const arrayBuffer = await fileResponse.arrayBuffer();
    
    // Parse FCAS data from the dispatch file
    const fcasData = await parseFCASData(arrayBuffer);
    
    if (fcasData.length === 0) {
      console.log('No FCAS data found in dispatch file');
      return;
    }
    
    // Store in database
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
    for (const record of fcasData) {
      batch.push(stmt.bind(
        record.region,
        record.service,
        record.price,
        record.enablement_min,
        record.enablement_max,
        record.settlement_date
      ));
    }
    
    await env.DB.batch(batch);
    
    // Update cache
    const latestFCAS = {
      timestamp: TimeUtil.nowUTC(),
      settlement_date: fcasData[0]?.settlement_date,
      services: fcasData
    };
    
    await env.CACHE.put('fcas:latest', JSON.stringify(latestFCAS), {
      expirationTtl: 300 // 5 minutes
    });
    
    console.log(`Stored ${fcasData.length} FCAS records`);
  } catch (error) {
    console.error('Error fetching FCAS data:', error);
  }
}

async function fetchScadaData(env: Env) {
  const url = `${AEMO_BASE}/Reports/Current/Dispatch_SCADA/`;
  
  try {
    // Fetch the directory listing
    const html = await fetchWithTruncationHandling(url);
    const files = extractZipLinksFromHTML(html);
    const latestFile = getLatestFile(files, 'DISPATCHSCADA');
    
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
    const scadaData = await parseSCADAData(arrayBuffer);
    
    if (scadaData.length === 0) {
      console.log('No SCADA data found');
      return;
    }
    
    // Store in database
    const stmt = env.DB.prepare(`
      INSERT INTO generator_scada (duid, scada_value, settlement_date, created_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(duid, settlement_date) DO UPDATE SET
        scada_value = excluded.scada_value,
        created_at = excluded.created_at
    `);
    
    const batch: any[] = [];
    for (const record of scadaData) {
      batch.push(stmt.bind(
        record.duid,
        record.scadavalue,
        record.settlement_date
      ));
    }
    
    await env.DB.batch(batch);
    
    console.log(`Stored ${scadaData.length} SCADA records`);
    
    // Aggregate by fuel type using DUID mapping
    await aggregateFuelTypes(env, scadaData[0]?.settlement_date);
    
  } catch (error) {
    console.error('Error fetching SCADA data:', error);
  }
}

async function fetchBatteryDispatchData(env: Env) {
  const url = `${AEMO_BASE}/Reports/Current/DispatchIS_Reports/`;
  
  try {
    const html = await fetchWithTruncationHandling(url);
    const files = extractZipLinksFromHTML(html);
    const latestFile = getLatestFile(files, 'DISPATCHIS');
    
    if (!latestFile) {
      console.log('No dispatch files found for battery data');
      return;
    }
    
    console.log(`Fetching battery dispatch from: ${latestFile}`);
    
    const fileResponse = await fetch(`${url}${latestFile}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Sunney-Scraper/1.0)',
        'Accept': 'application/zip,application/octet-stream,*/*'
      }
    });
    
    if (!fileResponse.ok) {
      throw new Error(`Failed to download dispatch file: ${fileResponse.status}`);
    }
    
    const arrayBuffer = await fileResponse.arrayBuffer();
    
    // Parse battery dispatch data
    const batteryData = await parseBatteryDispatchData(arrayBuffer);
    
    if (batteryData.length === 0) {
      console.log('No battery dispatch data found');
      return;
    }
    
    // Store in database
    const stmt = env.DB.prepare(`
      INSERT INTO battery_dispatch (
        duid, totalcleared, soc_percent, energy_mwh,
        raise_6sec, lower_6sec, raise_60sec, lower_60sec,
        raise_5min, lower_5min, raise_reg, lower_reg,
        settlement_date, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(duid, settlement_date) DO UPDATE SET
        totalcleared = excluded.totalcleared,
        soc_percent = excluded.soc_percent,
        energy_mwh = excluded.energy_mwh,
        raise_6sec = excluded.raise_6sec,
        lower_6sec = excluded.lower_6sec,
        raise_60sec = excluded.raise_60sec,
        lower_60sec = excluded.lower_60sec,
        raise_5min = excluded.raise_5min,
        lower_5min = excluded.lower_5min,
        raise_reg = excluded.raise_reg,
        lower_reg = excluded.lower_reg,
        created_at = excluded.created_at
    `);
    
    const batch: any[] = [];
    for (const record of batteryData) {
      batch.push(stmt.bind(
        record.duid,
        record.totalcleared,
        record.soc_percent || 0,
        record.energy_mwh || 0,
        0, 0, 0, 0, 0, 0, 0, 0, // FCAS values would come from separate parsing
        record.settlement_date
      ));
    }
    
    await env.DB.batch(batch);
    
    console.log(`Stored ${batteryData.length} battery dispatch records`);
  } catch (error) {
    console.error('Error fetching battery dispatch data:', error);
  }
}

async function aggregateFuelTypes(env: Env, settlementDate: string) {
  try {
    // Import DUID mappings
    const { DUID_FUEL_MAP } = await import('./duid-fuel-mapping');
    
    // Get all SCADA data for this interval
    const scadaResult = await env.DB.prepare(`
      SELECT duid, scada_value
      FROM generator_scada
      WHERE settlement_date = ?
    `).bind(settlementDate).all();
    
    // Aggregate by fuel type
    const fuelAggregation: Record<string, { total_mw: number; unit_count: number }> = {};
    
    for (const row of scadaResult.results || []) {
      const duid = (row as any).duid;
      const scadaValue = (row as any).scada_value;
      const mapping = DUID_FUEL_MAP[duid];
      
      if (mapping && scadaValue > 0) {
        const fuelType = mapping.fuel_type;
        if (!fuelAggregation[fuelType]) {
          fuelAggregation[fuelType] = { total_mw: 0, unit_count: 0 };
        }
        fuelAggregation[fuelType].total_mw += scadaValue;
        fuelAggregation[fuelType].unit_count += 1;
      }
    }
    
    // Store aggregated data
    const stmt = env.DB.prepare(`
      INSERT INTO generation_by_fuel (fuel_type, total_mw, unit_count, settlement_date, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(fuel_type, settlement_date) DO UPDATE SET
        total_mw = excluded.total_mw,
        unit_count = excluded.unit_count,
        created_at = excluded.created_at
    `);
    
    const batch: any[] = [];
    for (const [fuelType, data] of Object.entries(fuelAggregation)) {
      batch.push(stmt.bind(
        fuelType,
        data.total_mw,
        data.unit_count,
        settlementDate
      ));
    }
    
    if (batch.length > 0) {
      await env.DB.batch(batch);
      console.log(`Aggregated generation for ${batch.length} fuel types`);
    }
  } catch (error) {
    console.error('Error aggregating fuel types:', error);
  }
}