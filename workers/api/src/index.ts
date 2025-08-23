// API Gateway Worker - Serves all data to frontend apps
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';
import { CacheManager, RequestCoalescer } from './cache-manager';

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ARCHIVE: R2Bucket;
  AUTH_WORKER: Service;
  TRADING_ROOM: DurableObjectNamespace;
}

// Global request coalescer instance
const coalescer = new RequestCoalescer();

const app = new Hono<{ Bindings: Env }>();

// CORS configuration
app.use('*', cors({
  origin: ['https://sunney.io', 'http://localhost:3000'],
  credentials: true
}));

// Authentication middleware for all /api routes
app.use('/api/*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized - no token provided' }, 401);
  }
  
  const token = authHeader.substring(7);
  
  try {
    // Verify token with auth worker via service binding
    const authResponse = await c.env.AUTH_WORKER.fetch(
      new Request('http://auth-worker/auth/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
          // No body or Content-Type needed for verification
        }
      })
    );
    
    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      console.error('Auth verification failed:', authResponse.status, errorText);
      return c.json({
        error: 'Invalid token',
        status: authResponse.status,
        details: errorText
      }, 401);
    }
    
    const authData = await authResponse.json() as any;
    
    // Check if the token is valid
    if (!authData.valid) {
      console.error('Token not valid:', authData);
      return c.json({ error: 'Invalid token - verification failed' }, 401);
    }
    
    c.set('userId', authData.userId);
    c.set('email', authData.email);
    
    await next();
  } catch (error: any) {
    console.error('Auth middleware error:', error);
    return c.json({ 
      error: 'Authentication error',
      details: error.message
    }, 500);
  }
});

// Health check (no auth required)
app.get('/health', (c) => {
  return c.json({ 
    status: 'healthy',
    service: 'sunney-api',
    timestamp: new Date().toISOString()
  });
});

// API info (no auth required)
app.get('/', (c) => {
  return c.json({
    name: 'Sunney API Gateway',
    version: '1.0.0',
    endpoints: {
      prices: '/api/prices',
      forward: '/api/forward',
      fcas: '/api/fcas',
      demand: '/api/demand',
      trading: '/api/trading',
      bess: '/api/bess',
      websocket: '/api/ws'
    }
  });
});

// Live prices endpoint with tiered caching and coalescing
app.get('/api/prices/latest', async (c) => {
  const cache = new CacheManager(c.env.CACHE);
  const cacheKey = 'prices:latest';
  
  // Try tiered cache
  const cached = await cache.get(cacheKey, c.req.raw);
  if (cached) {
    // Add cache hit header for monitoring
    return c.json(cached.data, {
      headers: {
        'X-Cache': cached.source,
        'Cache-Control': 'public, max-age=60'
      }
    });
  }
  
  // Use request coalescing to prevent duplicate DB queries
  const data = await coalescer.coalesce(cacheKey, async () => {
    // Query database
    const result = await c.env.DB.prepare(`
      SELECT 
        region, 
        price, 
        demand,
        generation,
        settlement_date,
        created_at
      FROM dispatch_prices
      WHERE settlement_date = (SELECT MAX(settlement_date) FROM dispatch_prices)
      ORDER BY region
    `).all();
    
    return {
      timestamp: new Date().toISOString(),
      settlement_date: result.results[0]?.settlement_date,
      regions: result.results.map(r => ({
        region: r.region,
        price: r.price,
        demand: r.demand,
        generation: r.generation
      }))
    };
  });
  
  // Store in tiered cache
  const response = c.json(data);
  await cache.set(cacheKey, data, 60, c.req.raw, response);
  
  return c.json(data, {
    headers: {
      'X-Cache': 'miss',
      'Cache-Control': 'public, max-age=60'
    }
  });
});

// Historical prices
app.get('/api/prices/history/:region', async (c) => {
  const region = c.req.param('region').toUpperCase();
  const hours = parseInt(c.req.query('hours') || '24');
  
  const result = await c.env.DB.prepare(`
    SELECT 
      price,
      demand,
      settlement_date
    FROM dispatch_prices
    WHERE region = ?
      AND settlement_date > datetime('now', '-${hours} hours')
    ORDER BY settlement_date DESC
  `).bind(region).all();
  
  return c.json({
    region,
    hours,
    count: result.results.length,
    data: result.results
  });
});

// Forward prices with tiered caching and coalescing
app.get('/api/forward/:region', async (c) => {
  const region = c.req.param('region').toUpperCase();
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];
  const cache = new CacheManager(c.env.CACHE);
  const cacheKey = `forward:${region}:${date}`;
  
  // Try tiered cache
  const cached = await cache.get(cacheKey, c.req.raw);
  if (cached) {
    return c.json(cached.data, {
      headers: {
        'X-Cache': cached.source,
        'Cache-Control': 'public, max-age=3600'
      }
    });
  }
  
  // Use request coalescing
  const data = await coalescer.coalesce(cacheKey, async () => {
    const result = await c.env.DB.prepare(`
      SELECT 
        interval,
        price,
        source
      FROM forward_prices
      WHERE region = ? AND date = ?
      ORDER BY interval
    `).bind(region, date).all();
    
    return {
      region,
      date,
      intervals: result.results,
      timestamp: new Date().toISOString()
    };
  });
  
  // Store in tiered cache
  const response = c.json(data);
  await cache.set(cacheKey, data, 3600, c.req.raw, response);
  
  return c.json(data, {
    headers: {
      'X-Cache': 'miss',
      'Cache-Control': 'public, max-age=3600'
    }
  });
});

// FCAS prices with tiered caching and coalescing
app.get('/api/fcas/latest', async (c) => {
  const cache = new CacheManager(c.env.CACHE);
  const cacheKey = 'fcas:latest';
  
  // Try tiered cache
  const cached = await cache.get(cacheKey, c.req.raw);
  if (cached) {
    return c.json(cached.data, {
      headers: {
        'X-Cache': cached.source,
        'Cache-Control': 'public, max-age=60'
      }
    });
  }
  
  // Use request coalescing
  const data = await coalescer.coalesce(cacheKey, async () => {
    const result = await c.env.DB.prepare(`
      SELECT 
        region,
        service,
        price,
        enablement_min,
        enablement_max,
        settlement_date
      FROM fcas_prices
      WHERE settlement_date = (SELECT MAX(settlement_date) FROM fcas_prices)
      ORDER BY region, service
    `).all();
    
    return {
      timestamp: new Date().toISOString(),
      settlement_date: result.results[0]?.settlement_date,
      services: result.results
    };
  });
  
  // Store in tiered cache
  const response = c.json(data);
  await cache.set(cacheKey, data, 60, c.req.raw, response);
  
  return c.json(data, {
    headers: {
      'X-Cache': 'miss',
      'Cache-Control': 'public, max-age=60'
    }
  });
});

// Demand forecast with caching
app.get('/api/demand/forecast', async (c) => {
  const region = c.req.query('region')?.toUpperCase() || 'NSW1';
  const cache = new CacheManager(c.env.CACHE);
  const cacheKey = `demand:forecast:${region}`;
  
  // Try tiered cache
  const cached = await cache.get(cacheKey, c.req.raw);
  if (cached) {
    return c.json(cached.data, {
      headers: {
        'X-Cache': cached.source,
        'Cache-Control': 'public, max-age=300'
      }
    });
  }
  
  // Use request coalescing
  const data = await coalescer.coalesce(cacheKey, async () => {
    const result = await c.env.DB.prepare(`
      SELECT 
        forecast_date,
        forecast_demand,
        temperature_forecast
      FROM demand_forecast
      WHERE region = ?
        AND forecast_date > datetime('now')
        AND forecast_date < datetime('now', '+24 hours')
      ORDER BY forecast_date
    `).bind(region).all();
    
    return {
      region,
      forecasts: result.results,
      timestamp: new Date().toISOString()
    };
  });
  
  // Store in tiered cache (5 minutes)
  const response = c.json(data);
  await cache.set(cacheKey, data, 300, c.req.raw, response);
  
  return c.json(data, {
    headers: {
      'X-Cache': 'miss',
      'Cache-Control': 'public, max-age=300'
    }
  });
});

// Trading endpoints
app.get('/api/trading/positions', async (c) => {
  const userId = c.get('userId');
  
  const result = await c.env.DB.prepare(`
    SELECT 
      id,
      region,
      position_type,
      entry_price,
      quantity,
      entry_time,
      exit_price,
      exit_time,
      pnl,
      status
    FROM trading_positions
    WHERE user_id = ?
    ORDER BY entry_time DESC
    LIMIT 100
  `).bind(userId).all();
  
  return c.json({
    positions: result.results
  });
});

app.post('/api/trading/position', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  
  const result = await c.env.DB.prepare(`
    INSERT INTO trading_positions 
    (user_id, region, position_type, entry_price, quantity, entry_time, status)
    VALUES (?, ?, ?, ?, ?, datetime('now'), 'OPEN')
    RETURNING id
  `).bind(
    userId,
    body.region,
    body.position_type,
    body.entry_price,
    body.quantity
  ).first();
  
  return c.json({
    success: true,
    position_id: result.id
  });
});

app.post('/api/trading/close/:id', async (c) => {
  const userId = c.get('userId');
  const positionId = c.req.param('id');
  const body = await c.req.json();
  
  // Get current position
  const position = await c.env.DB.prepare(`
    SELECT entry_price, quantity, position_type
    FROM trading_positions
    WHERE id = ? AND user_id = ? AND status = 'OPEN'
  `).bind(positionId, userId).first();
  
  if (!position) {
    return c.json({ error: 'Position not found' }, 404);
  }
  
  // Calculate PnL
  const pnl = position.position_type === 'LONG' 
    ? (body.exit_price - position.entry_price) * position.quantity
    : (position.entry_price - body.exit_price) * position.quantity;
  
  // Update position
  await c.env.DB.prepare(`
    UPDATE trading_positions
    SET exit_price = ?, exit_time = datetime('now'), pnl = ?, status = 'CLOSED'
    WHERE id = ? AND user_id = ?
  `).bind(body.exit_price, pnl, positionId, userId).run();
  
  return c.json({
    success: true,
    pnl
  });
});

// BESS optimization endpoint
app.post('/api/bess/optimize', async (c) => {
  const body = await c.req.json();
  const { region, capacity_mwh, power_mw, efficiency, start_date, end_date } = body;
  
  // Get historical prices for optimization
  const prices = await c.env.DB.prepare(`
    SELECT 
      settlement_date,
      price
    FROM dispatch_prices
    WHERE region = ?
      AND settlement_date BETWEEN ? AND ?
    ORDER BY settlement_date
  `).bind(region, start_date, end_date).all();
  
  // Simple optimization logic (charge when cheap, discharge when expensive)
  const priceArray = prices.results.map(p => p.price);
  const avgPrice = priceArray.reduce((a, b) => a + b, 0) / priceArray.length;
  
  let soc = capacity_mwh / 2; // Start at 50% state of charge
  let revenue = 0;
  const operations = [];
  
  for (const period of prices.results) {
    if (period.price < avgPrice * 0.8 && soc < capacity_mwh * 0.9) {
      // Charge
      const chargeAmount = Math.min(power_mw / 12, capacity_mwh - soc);
      soc += chargeAmount * efficiency;
      revenue -= period.price * chargeAmount;
      operations.push({
        time: period.settlement_date,
        action: 'CHARGE',
        mw: chargeAmount * 12,
        price: period.price
      });
    } else if (period.price > avgPrice * 1.2 && soc > capacity_mwh * 0.1) {
      // Discharge
      const dischargeAmount = Math.min(power_mw / 12, soc);
      soc -= dischargeAmount;
      revenue += period.price * dischargeAmount * efficiency;
      operations.push({
        time: period.settlement_date,
        action: 'DISCHARGE',
        mw: dischargeAmount * 12,
        price: period.price
      });
    }
  }
  
  return c.json({
    total_revenue: revenue,
    operations_count: operations.length,
    operations: operations.slice(0, 100), // Limit response size
    avg_price: avgPrice
  });
});

// WebSocket endpoint for real-time updates
app.get('/api/ws', async (c) => {
  // Get or create Trading Room Durable Object
  const id = c.env.TRADING_ROOM.idFromName('global');
  const room = c.env.TRADING_ROOM.get(id);
  
  // Forward the request to the Durable Object
  const url = new URL(c.req.url);
  url.searchParams.set('userId', c.get('userId') || 'anonymous');
  
  return room.fetch(new Request(url, c.req.raw));
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Endpoint not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('API Error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Export Durable Object
export { TradingRoom } from './trading-room';
export default app;