// Scraper Worker - Fetches AEMO data every 5 minutes
import { 
  parseDispatchData, 
  parseP5MinData, 
  parseFCASData,
  fetchWithTruncationHandling,
  extractZipLinksFromHTML,
  getLatestFile 
} from './aemo-parser';

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ARCHIVE: R2Bucket;
  TRADING_ROOM: DurableObjectNamespace;
}

const AEMO_BASE = 'https://nemweb.com.au';
const REGIONS = ['NSW1', 'VIC1', 'QLD1', 'SA1', 'TAS1'];

export default {
  // Scheduled handler - runs every 5 minutes
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log(`Scraper running at ${new Date().toISOString()}`);
    
    try {
      // Fetch dispatch data
      await fetchDispatchData(env);
      
      // Fetch P5MIN data
      await fetchP5MinData(env);
      
      // Fetch FCAS data
      await fetchFCASData(env);
      
      console.log('Scraper completed successfully');
    } catch (error) {
      console.error('Scraper error:', error);
    }
  },
  
  // Manual trigger for testing
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/trigger' && request.method === 'POST') {
      await this.scheduled(
        { scheduledTime: Date.now(), cron: '*/5 * * * *' } as ScheduledEvent,
        env,
        { waitUntil: () => {}, passThroughOnException: () => {} } as ExecutionContext
      );
      
      return new Response('Scraper triggered', { status: 200 });
    }
    
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'sunney-scraper',
        timestamp: new Date().toISOString()
      }), {
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
    const html = await fetchWithTruncationHandling(url);
    
    // Extract latest DISPATCHIS file
    const files = extractZipLinksFromHTML(html);
    const latestFile = getLatestFile(files, 'DISPATCHIS');
    
    if (!latestFile) {
      console.log('No dispatch files found');
      return;
    }
    
    console.log(`Fetching dispatch file: ${latestFile}`);
    
    // Download and process
    const fileResponse = await fetch(`${url}${latestFile}`);
    const arrayBuffer = await fileResponse.arrayBuffer();
    
    // Store raw file in R2
    const timestamp = new Date().toISOString();
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
    
    const batch = [];
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
      timestamp: new Date().toISOString(),
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
    
    const fileResponse = await fetch(`${url}${latestFile}`);
    const arrayBuffer = await fileResponse.arrayBuffer();
    
    // Store raw file
    const timestamp = new Date().toISOString();
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
  // Similar structure to dispatch data
  // Fetch FCAS market data and store
  console.log('Fetching FCAS data...');
  
  // Mock FCAS data for now
  const fcasServices = [
    'RAISE6SEC', 'RAISE60SEC', 'RAISE5MIN', 'RAISEREG',
    'LOWER6SEC', 'LOWER60SEC', 'LOWER5MIN', 'LOWERREG'
  ];
  
  const stmt = env.DB.prepare(`
    INSERT INTO fcas_prices (region, service, price, enablement_min, enablement_max, settlement_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(region, service, settlement_date) DO UPDATE SET
      price = excluded.price,
      enablement_min = excluded.enablement_min,
      enablement_max = excluded.enablement_max,
      created_at = excluded.created_at
  `);
  
  const batch = [];
  const settlementDate = new Date().toISOString();
  
  for (const region of REGIONS) {
    for (const service of fcasServices) {
      // Mock prices for demonstration
      const price = Math.random() * 50;
      batch.push(stmt.bind(
        region,
        service,
        price,
        0,
        100,
        settlementDate
      ));
    }
  }
  
  await env.DB.batch(batch);
  console.log('FCAS data stored');
}