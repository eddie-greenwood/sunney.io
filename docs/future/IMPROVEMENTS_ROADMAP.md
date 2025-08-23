# Sunney.io Improvements Roadmap
## Based on NEM Reforms & Best Practices

## Phase 1: Critical Security & Real-time (Week 1-2)

### 1.1 Multi-Factor Authentication with Cloudflare Access

**Implementation in workers/auth/src/mfa.ts:**
```typescript
import { Authenticator } from '@otplib/authenticator';

export async function setupMFA(userId: string, env: Env) {
  const secret = Authenticator.generateSecret();
  
  // Store in D1
  await env.DB.prepare(
    'UPDATE users SET mfa_secret = ?, mfa_enabled = 0 WHERE id = ?'
  ).bind(secret, userId).run();
  
  // Generate QR code URL
  const otpauth = Authenticator.keyuri(
    userId, 
    'Sunney.io', 
    secret
  );
  
  return { secret, qrcode: otpauth };
}

export async function verifyMFA(userId: string, token: string, env: Env) {
  const user = await env.DB.prepare(
    'SELECT mfa_secret FROM users WHERE id = ?'
  ).bind(userId).first();
  
  return Authenticator.verify({
    token,
    secret: user.mfa_secret
  });
}
```

### 1.2 Durable Objects for Real-time Trading

**New file: workers/api/src/trading-room.ts:**
```typescript
export class TradingRoom {
  state: DurableObjectState;
  sessions: Map<WebSocket, string> = new Map();
  positions: Map<string, any> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      this.positions = await this.state.storage.get('positions') || new Map();
    });
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    
    if (url.pathname === '/websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      this.handleSession(server, request);
      
      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }
    
    return new Response('Trading Room Active', { status: 200 });
  }

  handleSession(ws: WebSocket, request: Request) {
    ws.accept();
    const userId = new URL(request.url).searchParams.get('userId');
    this.sessions.set(ws, userId);
    
    ws.addEventListener('message', async (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'TRADE') {
        await this.executeTrade(data, userId);
        this.broadcast({
          type: 'TRADE_UPDATE',
          positions: Array.from(this.positions.values())
        });
      }
    });
    
    ws.addEventListener('close', () => {
      this.sessions.delete(ws);
    });
  }

  async executeTrade(trade: any, userId: string) {
    // Execute trade logic
    this.positions.set(trade.id, {
      ...trade,
      userId,
      timestamp: new Date().toISOString()
    });
    
    await this.state.storage.put('positions', this.positions);
  }

  broadcast(message: any) {
    const msg = JSON.stringify(message);
    this.sessions.forEach((userId, ws) => {
      ws.send(msg);
    });
  }
}
```

## Phase 2: Advanced Data & Forecasting (Week 2-3)

### 2.1 Weather Integration for BESS Optimization

**New file: workers/api/src/services/weather.ts:**
```typescript
export class WeatherService {
  private readonly BOM_API = 'http://www.bom.gov.au/fwo/IDN60901/IDN60901.94767.json';
  
  async getForecast(region: string, env: Env): Promise<any> {
    // Check cache first
    const cached = await env.CACHE.get(`weather:${region}`, 'json');
    if (cached) return cached;
    
    // Fetch from BOM
    const response = await fetch(this.BOM_API);
    const data = await response.json();
    
    // Extract relevant data
    const forecast = {
      temperature: data.observations.data[0].air_temp,
      humidity: data.observations.data[0].rel_hum,
      wind_speed: data.observations.data[0].wind_spd_kmh,
      solar_radiation: this.estimateSolarRadiation(
        data.observations.data[0].cloud
      ),
      timestamp: new Date().toISOString()
    };
    
    // Cache for 30 minutes
    await env.CACHE.put(
      `weather:${region}`, 
      JSON.stringify(forecast),
      { expirationTtl: 1800 }
    );
    
    return forecast;
  }
  
  private estimateSolarRadiation(cloudCover: number): number {
    // Simple model: inverse relationship with cloud cover
    const maxRadiation = 1000; // W/m²
    return maxRadiation * (1 - cloudCover / 8);
  }
  
  async predictRenewableOutput(
    capacity_mw: number,
    weather: any
  ): Promise<number> {
    // Solar output prediction
    const solarEfficiency = 0.2; // 20% panel efficiency
    const areaPerMW = 4000; // m² per MW
    
    const output = (
      weather.solar_radiation * 
      solarEfficiency * 
      areaPerMW * 
      capacity_mw / 
      1000000 // Convert to MW
    );
    
    return Math.min(output, capacity_mw);
  }
}
```

### 2.2 Enhanced BESS Optimizer with ML

**Update workers/api/src/services/bess-optimizer.ts:**
```typescript
export class BessOptimizer {
  async optimizeWithForecasts(params: any, env: Env) {
    const weather = new WeatherService();
    const forecast = await weather.getForecast(params.region, env);
    
    // Get historical patterns
    const patterns = await this.analyzeHistoricalPatterns(
      params.region, 
      env.DB
    );
    
    // Price prediction using simple ARIMA-like model
    const predictedPrices = await this.predictPrices(
      patterns,
      forecast,
      24 // hours ahead
    );
    
    // Dynamic programming optimization
    const schedule = this.dpOptimize(
      predictedPrices,
      params.capacity_mwh,
      params.power_mw,
      params.efficiency
    );
    
    return {
      schedule,
      expectedRevenue: schedule.reduce((sum, s) => sum + s.revenue, 0),
      weatherImpact: forecast,
      confidence: this.calculateConfidence(patterns)
    };
  }
  
  private dpOptimize(
    prices: number[],
    capacity: number,
    power: number,
    efficiency: number
  ) {
    const intervals = prices.length;
    const states = 20; // Discretize SOC into 20 levels
    
    // DP table: [interval][soc_level] = max_revenue
    const dp = Array(intervals + 1).fill(null).map(() => 
      Array(states + 1).fill(-Infinity)
    );
    
    dp[0][states / 2] = 0; // Start at 50% SOC
    
    for (let t = 0; t < intervals; t++) {
      for (let soc = 0; soc <= states; soc++) {
        if (dp[t][soc] === -Infinity) continue;
        
        // Try charge, discharge, or idle
        for (const action of [-1, 0, 1]) {
          const energy = action * power / 12; // 5-min interval
          const newSoc = soc + action;
          
          if (newSoc < 0 || newSoc > states) continue;
          
          const revenue = action > 0 
            ? prices[t] * energy * efficiency  // Discharge
            : -prices[t] * energy / efficiency; // Charge
          
          dp[t + 1][newSoc] = Math.max(
            dp[t + 1][newSoc],
            dp[t][soc] + revenue
          );
        }
      }
    }
    
    // Backtrack to find optimal schedule
    return this.backtrackSchedule(dp, prices);
  }
}
```

## Phase 3: P2P Trading & DER Integration (Week 3-4)

### 3.1 P2P Trading Module

**New file: workers/api/src/services/p2p-trading.ts:**
```typescript
export class P2PTradingEngine {
  async createOffer(offer: any, env: Env) {
    // Validate prosumer has generation capacity
    const capacity = await this.validateCapacity(offer.userId, env);
    
    if (offer.energy_mwh > capacity.available) {
      throw new Error('Insufficient generation capacity');
    }
    
    // Store offer in D1
    const result = await env.DB.prepare(`
      INSERT INTO p2p_offers (
        seller_id, energy_mwh, price_per_mwh, 
        delivery_time, region, status
      ) VALUES (?, ?, ?, ?, ?, 'OPEN')
      RETURNING id
    `).bind(
      offer.userId,
      offer.energy_mwh,
      offer.price_per_mwh,
      offer.delivery_time,
      offer.region
    ).first();
    
    // Notify potential buyers via Durable Object
    await this.notifyBuyers(result.id, offer, env);
    
    return { offerId: result.id, status: 'OPEN' };
  }
  
  async matchOffers(env: Env) {
    // Get open buy and sell orders
    const buys = await env.DB.prepare(`
      SELECT * FROM p2p_offers 
      WHERE type = 'BUY' AND status = 'OPEN'
      ORDER BY price_per_mwh DESC
    `).all();
    
    const sells = await env.DB.prepare(`
      SELECT * FROM p2p_offers 
      WHERE type = 'SELL' AND status = 'OPEN'
      ORDER BY price_per_mwh ASC
    `).all();
    
    const matches = [];
    
    // Simple matching algorithm
    for (const buy of buys.results) {
      for (const sell of sells.results) {
        if (
          buy.price_per_mwh >= sell.price_per_mwh &&
          buy.region === sell.region &&
          buy.delivery_time === sell.delivery_time
        ) {
          const matchedEnergy = Math.min(
            buy.energy_mwh, 
            sell.energy_mwh
          );
          
          matches.push({
            buyId: buy.id,
            sellId: sell.id,
            energy: matchedEnergy,
            price: (buy.price_per_mwh + sell.price_per_mwh) / 2,
            timestamp: new Date().toISOString()
          });
          
          // Update remaining quantities
          buy.energy_mwh -= matchedEnergy;
          sell.energy_mwh -= matchedEnergy;
          
          if (sell.energy_mwh === 0) break;
        }
      }
    }
    
    // Execute matches
    await this.executeMatches(matches, env);
    
    return matches;
  }
}
```

### 3.2 Virtual Power Plant (VPP) Aggregator

**New file: workers/api/src/services/vpp.ts:**
```typescript
export class VPPAggregator {
  async aggregateDER(region: string, env: Env) {
    // Get all registered DER assets
    const assets = await env.DB.prepare(`
      SELECT * FROM der_assets 
      WHERE region = ? AND status = 'ONLINE'
    `).bind(region).all();
    
    // Calculate aggregate capacity
    const aggregate = {
      total_capacity_mw: 0,
      available_capacity_mw: 0,
      battery_capacity_mwh: 0,
      solar_capacity_mw: 0,
      response_time_sec: 0,
      assets: []
    };
    
    for (const asset of assets.results) {
      aggregate.total_capacity_mw += asset.capacity_mw;
      aggregate.available_capacity_mw += asset.available_mw;
      
      if (asset.type === 'BATTERY') {
        aggregate.battery_capacity_mwh += asset.storage_mwh;
      } else if (asset.type === 'SOLAR') {
        aggregate.solar_capacity_mw += asset.capacity_mw;
      }
      
      aggregate.assets.push({
        id: asset.id,
        type: asset.type,
        capacity: asset.capacity_mw
      });
    }
    
    // Calculate optimal dispatch
    const dispatch = await this.optimizeDispatch(
      aggregate,
      await this.getCurrentPrice(region, env)
    );
    
    return { aggregate, dispatch };
  }
  
  async bidIntoFCAS(vpp: any, service: string, env: Env) {
    // Calculate FCAS capability
    const capability = this.calculateFCASCapability(vpp, service);
    
    // Submit bid to market
    const bid = await env.DB.prepare(`
      INSERT INTO fcas_bids (
        vpp_id, service, capacity_mw, 
        price_per_mw, response_time_sec
      ) VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `).bind(
      vpp.id,
      service,
      capability.capacity,
      capability.price,
      capability.response_time
    ).first();
    
    return { bidId: bid.id, status: 'SUBMITTED' };
  }
}
```

## Phase 4: Monitoring & Compliance (Ongoing)

### 4.1 Audit Logging System

**New file: workers/api/src/middleware/audit.ts:**
```typescript
export async function auditMiddleware(c: Context, next: Function) {
  const start = Date.now();
  const request = {
    method: c.req.method,
    path: c.req.path,
    userId: c.get('userId'),
    ip: c.req.header('CF-Connecting-IP'),
    timestamp: new Date().toISOString()
  };
  
  await next();
  
  const response = {
    status: c.res.status,
    duration: Date.now() - start
  };
  
  // Store in R2 for long-term compliance
  const auditKey = `audit/${request.timestamp.split('T')[0]}/${request.userId}.jsonl`;
  const auditLog = JSON.stringify({ request, response }) + '\n';
  
  await c.env.ARCHIVE.put(auditKey, auditLog, {
    httpMetadata: { contentType: 'application/x-ndjson' }
  });
  
  // Alert on suspicious activity
  if (response.status === 429 || response.duration > 5000) {
    await c.env.ALERTS.send({
      type: 'SECURITY_ALERT',
      details: { request, response }
    });
  }
}
```

### 4.2 Cost Monitoring Action

**New file: .github/workflows/cost-monitor.yml:**
```yaml
name: Cost Monitor

on:
  schedule:
    - cron: '0 0 * * 1' # Weekly on Monday
  workflow_dispatch:

jobs:
  analyze-costs:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Analyze Cloudflare Usage
        run: |
          # Fetch usage via API
          USAGE=$(curl -X GET "https://api.cloudflare.com/client/v4/accounts/${{ secrets.CF_ACCOUNT_ID }}/billing/usage" \
            -H "Authorization: Bearer ${{ secrets.CF_API_TOKEN }}")
          
          # Parse and check thresholds
          WORKERS_COST=$(echo $USAGE | jq '.result.workers.cost')
          R2_COST=$(echo $USAGE | jq '.result.r2.cost')
          TOTAL_COST=$(echo $USAGE | jq '.result.total')
          
          if (( $(echo "$TOTAL_COST > 15" | bc -l) )); then
            echo "⚠️ WARNING: Monthly cost exceeds $15 threshold: $$TOTAL_COST"
            exit 1
          fi
          
          # Generate report
          echo "## Cost Report" >> $GITHUB_STEP_SUMMARY
          echo "- Workers: $$WORKERS_COST" >> $GITHUB_STEP_SUMMARY
          echo "- R2: $$R2_COST" >> $GITHUB_STEP_SUMMARY
          echo "- Total: $$TOTAL_COST" >> $GITHUB_STEP_SUMMARY
```

## Implementation Priority

### Week 1: Security & Real-time
- [ ] MFA implementation
- [ ] Durable Objects for trading
- [ ] Audit logging

### Week 2: Data Enhancement
- [ ] Weather integration
- [ ] Enhanced BESS optimizer
- [ ] Advanced caching

### Week 3: P2P Features
- [ ] P2P trading engine
- [ ] VPP aggregator
- [ ] DER integration

### Week 4: Polish & Deploy
- [ ] Cost monitoring
- [ ] Mobile optimization
- [ ] Compliance reports

## Estimated Impact

| Feature | User Value | Revenue Impact | Cost Impact |
|---------|-----------|----------------|-------------|
| MFA | High (security) | +10% retention | +$0/month |
| Real-time Trading | Very High | +30% engagement | +$2/month (DO) |
| Weather Integration | High (BESS) | +20% optimizer usage | +$1/month (API) |
| P2P Trading | Very High | New revenue stream | +$2/month |
| VPP Aggregation | High | Enterprise clients | +$3/month |

**Total Additional Cost**: ~$8/month
**New Total**: ~$18/month
**Potential Revenue Increase**: 50-100%

## Next Steps

1. **Prioritize based on users**: Survey current users for most wanted features
2. **Implement incrementally**: Start with security, then real-time
3. **A/B test features**: Use Cloudflare's percentage deployments
4. **Monitor closely**: Set up alerts for cost and performance

This roadmap transforms Sunney.io from a data platform into a comprehensive energy trading ecosystem while maintaining the lean, efficient architecture.