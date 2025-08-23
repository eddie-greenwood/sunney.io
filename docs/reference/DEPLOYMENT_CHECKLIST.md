# Sunney.io Deployment Checklist
## Critical Issues to Fix Before Deployment

### 🚨 BLOCKER: Data Pipeline is Using Mock Data!

The scraper worker is currently generating **FAKE DATA** instead of parsing real AEMO files. This is the most critical issue.

## 1. Fix AEMO Data Parser (URGENT)

### Current Problem:
```typescript
// workers/scraper/src/index.ts - Line 244
async function parseDispatchData(arrayBuffer: ArrayBuffer): Promise<any[]> {
  // In production, use proper ZIP library to extract CSV
  // For now, return mock data
  return REGIONS.map(region => ({
    region,
    price: 50 + Math.random() * 100,  // ❌ FAKE DATA!
    demand: 5000 + Math.random() * 3000,
    generation: 4500 + Math.random() * 3500,
    settlementDate
  }));
}
```

### Required Fix:
```bash
# Install dependencies in scraper worker
cd workers/scraper
npm install jszip csv-parse

# Implement real parsing
```

### Implementation Needed:
```typescript
import JSZip from 'jszip';
import { parse } from 'csv-parse/sync';

async function parseDispatchData(arrayBuffer: ArrayBuffer): Promise<any[]> {
  const zip = new JSZip();
  const content = await zip.loadAsync(arrayBuffer);
  
  // Find the CSV file (usually PUBLIC_DISPATCHIS_*.CSV)
  const csvFile = Object.keys(content.files).find(name => 
    name.includes('DISPATCHIS') && name.endsWith('.CSV')
  );
  
  if (!csvFile) throw new Error('No DISPATCHIS CSV found in ZIP');
  
  const csvText = await content.files[csvFile].async('string');
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true
  });
  
  // Extract price data from AEMO format
  const prices = records
    .filter(r => r.RECORDTYPE === 'PRICE')
    .map(r => ({
      region: r.REGIONID,
      price: parseFloat(r.RRP),
      demand: parseFloat(r.TOTALDEMAND),
      generation: parseFloat(r.AVAILABLEGENERATION),
      settlementDate: r.SETTLEMENTDATE
    }));
  
  return prices;
}
```

## 2. Handle Truncated HTML from NEMWEB

### Current Problem:
No handling for NEMWEB's truncated HTML responses

### Required Fix:
```typescript
async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      const html = await response.text();
      
      // Check for truncation indicators
      if (!html.includes('</html>') || html.length < 100) {
        console.log(`Truncated response, retry ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }
      
      return new Response(html);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
    }
  }
  throw new Error('Failed to fetch complete HTML after retries');
}

function extractZipLinks(html: string): string[] {
  // Handle potentially truncated HTML
  const safeHtml = html.includes('</html>') ? html : html + '</html>';
  
  const regex = /href="([^"]+\.zip)"/gi;
  const matches = [];
  let match;
  
  while ((match = regex.exec(safeHtml)) !== null) {
    matches.push(match[1]);
  }
  
  // If no matches and HTML is truncated, try alternative parsing
  if (matches.length === 0 && !html.includes('</html>')) {
    // Try to extract from partial HTML
    const partialRegex = /[A-Z]+_[\d]+\.zip/gi;
    let partialMatch;
    while ((partialMatch = partialRegex.exec(html)) !== null) {
      matches.push(partialMatch[0]);
    }
  }
  
  return matches.filter(f => !f.startsWith('http'));
}
```

## 3. Fix FCAS Data Collection

### Current Problem:
FCAS data is mocked, not fetched from AEMO

### Required Fix:
```typescript
async function fetchFCASData(env: Env) {
  const url = `${AEMO_BASE}/Reports/Current/Ancillary_Services_Reports/`;
  
  const response = await fetchWithRetry(url);
  const html = await response.text();
  const files = extractZipLinks(html);
  
  const fcasFile = files.find(f => f.includes('FCAS') && f.includes('.zip'));
  if (!fcasFile) return;
  
  const fileResponse = await fetch(`${url}${fcasFile}`);
  const arrayBuffer = await fileResponse.arrayBuffer();
  
  // Parse FCAS CSV from ZIP
  const fcasData = await parseFCASData(arrayBuffer);
  
  // Store in database
  // ... batch insert to fcas_prices table
}

async function parseFCASData(arrayBuffer: ArrayBuffer): Promise<any[]> {
  // Similar to dispatch parsing but for FCAS services
  // Extract RAISE6SEC, LOWER6SEC, etc. prices
}
```

## 4. Configuration Updates

### Current Problem:
Placeholder values in wrangler.toml files

### Required Actions:
```bash
# 1. Generate JWT secret
openssl rand -base64 32
# Add to workers/auth/.dev.vars:
# JWT_SECRET=<generated_secret>

# 2. Create D1 databases
wrangler d1 create sunney-auth
wrangler d1 create sunney-market

# 3. Create KV namespaces
wrangler kv:namespace create SESSIONS
wrangler kv:namespace create CACHE
wrangler kv:namespace create JWT_CACHE

# 4. Create R2 bucket
wrangler r2 bucket create sunney-archive

# 5. Update all wrangler.toml files with actual IDs
```

## 5. Environment Variables Setup

### Create `.env` file for local development:
```bash
# .env
API_BASE=http://localhost:8787
AUTH_API=http://localhost:8788
SCRAPER_API=http://localhost:8789
```

### Create production secrets:
```bash
# Set production secrets
wrangler secret put JWT_SECRET --env production
wrangler secret put ADMIN_EMAIL --env production
```

## 6. Testing Before Deployment

### Run locally to verify:
```bash
# Terminal 1 - Auth worker
cd workers/auth
wrangler dev --port 8788 --local

# Terminal 2 - API worker
cd workers/api
wrangler dev --port 8787 --local

# Terminal 3 - Scraper worker
cd workers/scraper
wrangler dev --port 8789 --local

# Terminal 4 - Frontend
cd pages
npx serve public -p 3000
```

### Test checklist:
- [ ] Scraper fetches real AEMO data
- [ ] ZIP files are properly parsed
- [ ] CSV data extracted correctly
- [ ] Prices stored in database
- [ ] API returns real prices (not mock)
- [ ] WebSocket broadcasts work
- [ ] All 6 apps display real data
- [ ] Authentication flow works
- [ ] FCAS data collected
- [ ] P5MIN data processed

## 7. Deployment Commands

Once everything is fixed and tested:

```bash
# Deploy workers
cd workers/auth && wrangler deploy
cd workers/api && wrangler deploy
cd workers/scraper && wrangler deploy

# Deploy frontend
cd pages && wrangler pages deploy public

# Verify deployment
curl https://api.sunney.io/health
curl https://auth.sunney.io/health
curl https://sunney.io
```

## Summary

**MUST FIX before deployment:**
1. ❌ ZIP/CSV parsing (currently returns fake data)
2. ❌ Truncated HTML handling
3. ❌ FCAS data collection
4. ❌ Configuration with real IDs
5. ❌ Environment variables

**Architecture is solid, but data pipeline is broken. Fix these 5 items and you're ready to deploy!**