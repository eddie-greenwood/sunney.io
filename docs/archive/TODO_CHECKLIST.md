# Sunney.io Implementation TODO Checklist
## Work through each item in order - DO NOT skip ahead!

---

# ✅ PHASE 1: Foundation (Day 1)
**STOP HERE until all items checked ✅**

## Local Setup
- [ ] Clone repo to new machine
- [ ] Run `npm install -g wrangler`
- [ ] Create `.env` file with template values
- [ ] Create `.gitignore` file
- [ ] Run `wrangler --version` (should show version)

## Cloudflare Account
- [ ] Login to Cloudflare Dashboard
- [ ] Copy Account ID to `.env`
- [ ] Create API Token with correct permissions
- [ ] Save API Token to `.env`
- [ ] Run `wrangler whoami` (should show your email)

## GitHub Setup
- [ ] Create new GitHub repository "sunney-io"
- [ ] Add remote: `git remote add origin [url]`
- [ ] Push code: `git push -u origin main`
- [ ] Add CLOUDFLARE_API_TOKEN to GitHub Secrets
- [ ] Add CLOUDFLARE_ACCOUNT_ID to GitHub Secrets
- [ ] Verify push triggers GitHub Action

### 🛑 STOP - Validate Phase 1
- [ ] Can run `wrangler whoami` successfully
- [ ] Code visible on GitHub
- [ ] `.env` has Account ID and API Token
- [ ] **ALL PHASE 1 ITEMS CHECKED**

---

# ✅ PHASE 2: Database Setup (Day 2)
**STOP HERE until all items checked ✅**

## Create D1 Databases
- [ ] Run: `wrangler d1 create sunney-auth`
- [ ] Copy the returned database_id to notepad
- [ ] Run: `wrangler d1 create sunney-market`  
- [ ] Copy the returned database_id to notepad
- [ ] Update `workers/auth/wrangler.toml` with auth database_id
- [ ] Update `workers/api/wrangler.toml` with market database_id
- [ ] Update `workers/scraper/wrangler.toml` with market database_id

## Initialize Schemas
- [ ] Run: `wrangler d1 execute sunney-auth --file=scripts/schema-auth.sql`
- [ ] Run: `wrangler d1 execute sunney-market --file=scripts/schema-market.sql`
- [ ] Verify tables: `wrangler d1 execute sunney-auth --command="SELECT name FROM sqlite_master WHERE type='table'"`
- [ ] Should see: users, sessions, api_keys tables

## Create KV Namespaces
- [ ] Run: `wrangler kv:namespace create SESSIONS`
- [ ] Copy the id to notepad
- [ ] Run: `wrangler kv:namespace create CACHE`
- [ ] Copy the id to notepad  
- [ ] Run: `wrangler kv:namespace create JWT_CACHE`
- [ ] Copy the id to notepad
- [ ] Update ALL wrangler.toml files with KV namespace IDs

## Create R2 Bucket
- [ ] Run: `wrangler r2 bucket create sunney-archive`
- [ ] Verify: `wrangler r2 bucket list` (should show sunney-archive)

### 🛑 STOP - Validate Phase 2
- [ ] Run: `wrangler d1 list` (shows 2 databases)
- [ ] Run: `wrangler kv:namespace list` (shows 3 namespaces)
- [ ] Run: `wrangler r2 bucket list` (shows 1 bucket)
- [ ] ALL wrangler.toml files have real IDs (not placeholders)
- [ ] **ALL PHASE 2 ITEMS CHECKED**

---

# ✅ PHASE 3: AEMO Scraper (Day 3-4)
**STOP HERE until all items checked ✅**

## Understanding AEMO
- [ ] Visit: https://nemweb.com.au/Reports/Current/DispatchIS_Reports/
- [ ] Download one ZIP file manually
- [ ] Extract and open CSV in Excel/text editor
- [ ] Identify the PRICE records (D,DISPATCH,PRICE,...)
- [ ] Note the 5 regions: NSW1, VIC1, QLD1, SA1, TAS1

## Install Dependencies
- [ ] `cd workers/scraper`
- [ ] Run: `npm init -y`
- [ ] Run: `npm install csv-parse`
- [ ] Create test file: `test-parse.js`
- [ ] Test CSV parser loads: `node -e "require('csv-parse')"`

## Deploy Scraper
- [ ] `cd workers/scraper`
- [ ] Run: `wrangler deploy`
- [ ] Note your worker URL: https://sunney-scraper.[subdomain].workers.dev
- [ ] Test health: `curl [your-worker-url]/health`

## Test Data Collection
- [ ] Trigger manually: `curl -X POST [your-worker-url]/trigger`
- [ ] Check logs: `wrangler tail sunney-scraper`
- [ ] Look for "Fetching dispatch file:" in logs
- [ ] Check database: `wrangler d1 execute sunney-market --command="SELECT * FROM dispatch_prices LIMIT 5"`
- [ ] **VERIFY: Prices are realistic ($20-200), not random!**

### 🛑 STOP - Validate Phase 3
- [ ] Scraper deployed successfully
- [ ] Manual trigger returns 200 OK
- [ ] Database has real price data (not 50 + random)
- [ ] Prices match current AEMO website (roughly)
- [ ] **ALL PHASE 3 ITEMS CHECKED**

---

# ✅ PHASE 4: Authentication (Day 5)
**STOP HERE until all items checked ✅**

## Generate JWT Secret
- [ ] Run: `openssl rand -base64 32`
- [ ] Copy the generated secret
- [ ] Create: `workers/auth/.dev.vars`
- [ ] Add: `JWT_SECRET=your_generated_secret`
- [ ] Set production: `wrangler secret put JWT_SECRET --name sunney-auth`

## Deploy Auth Worker
- [ ] `cd workers/auth`
- [ ] Run: `wrangler deploy`
- [ ] Note your worker URL: https://sunney-auth.[subdomain].workers.dev
- [ ] Test health: `curl [auth-worker-url]/health`

## Test Registration & Login
- [ ] Register test user:
```bash
curl -X POST [auth-worker-url]/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test1234!","name":"Test"}'
```
- [ ] Copy the returned token
- [ ] Test login with same credentials
- [ ] Verify token returned

### 🛑 STOP - Validate Phase 4
- [ ] Auth worker deployed
- [ ] Can register new user
- [ ] Can login with user
- [ ] JWT token returned (long string starting with "ey")
- [ ] **ALL PHASE 4 ITEMS CHECKED**

---

# ✅ PHASE 5: API Gateway (Day 6)
**STOP HERE until all items checked ✅**

## Deploy API Worker
- [ ] `cd workers/api`
- [ ] Run: `wrangler deploy`
- [ ] Note your worker URL: https://sunney-api.[subdomain].workers.dev
- [ ] Test health: `curl [api-worker-url]/health`

## Test Data Endpoints
- [ ] Get token from auth (login first)
- [ ] Test prices: 
```bash
curl [api-worker-url]/api/prices/latest \
  -H "Authorization: Bearer [your-token]"
```
- [ ] Should return JSON with regions and prices
- [ ] Prices should match scraper data

## Test WebSocket
- [ ] Open browser console
- [ ] Run: `new WebSocket('wss://sunney-api.[subdomain].workers.dev/api/ws')`
- [ ] Should connect without error

### 🛑 STOP - Validate Phase 5
- [ ] API worker deployed
- [ ] Authenticated requests work
- [ ] Returns real price data
- [ ] WebSocket connects
- [ ] **ALL PHASE 5 ITEMS CHECKED**

---

# ✅ PHASE 6: Frontend (Day 7)
**STOP HERE until all items checked ✅**

## Deploy Frontend
- [ ] `cd pages`
- [ ] Run: `wrangler pages deploy public --project-name sunney-io`
- [ ] Note your URL: https://sunney-io.pages.dev
- [ ] Visit URL in browser

## Configure Custom Domain (Optional)
- [ ] Cloudflare Dashboard → Pages → sunney-io
- [ ] Custom domains → Add domain
- [ ] Add: sunney.io (if you own it)
- [ ] Wait for DNS propagation

## Test Each App
- [ ] Homepage loads: `/index.html`
- [ ] NEM Live Dashboard: `/dashboards/nem-live/`
- [ ] BESS Optimizer: `/apps/bess-optimizer/`
- [ ] Forward Lite: `/apps/forward-lite/`
- [ ] Trading Sim: `/apps/trading/`

### 🛑 STOP - Validate Phase 6
- [ ] Frontend deployed to Pages
- [ ] Homepage loads
- [ ] At least one dashboard shows real prices
- [ ] No console errors
- [ ] **ALL PHASE 6 ITEMS CHECKED**

---

# ✅ PHASE 7: Validation (Day 8)
**STOP HERE until all items checked ✅**

## Data Quality Check
- [ ] Compare your prices with https://aemo.com.au/
- [ ] Check for data gaps: 
```sql
wrangler d1 execute sunney-market --command="
  SELECT COUNT(*) as count, 
         MIN(settlement_date) as oldest,
         MAX(settlement_date) as newest 
  FROM dispatch_prices"
```
- [ ] Should have 288 intervals per day (5-min intervals)

## Monitor Logs
- [ ] Run: `wrangler tail sunney-scraper`
- [ ] Wait 5 minutes for scheduled run
- [ ] Should see "Fetching dispatch file" every 5 min
- [ ] No errors in logs

## Performance Check
- [ ] Load dashboard
- [ ] Check network tab for API response time
- [ ] Should be < 200ms for cached data
- [ ] Check for X-Cache header (hit/miss)

### 🛑 STOP - Validate Phase 7
- [ ] Prices match AEMO (within 5 min delay)
- [ ] Scraper runs every 5 minutes
- [ ] No critical errors in logs
- [ ] API response times acceptable
- [ ] **ALL PHASE 7 ITEMS CHECKED**

---

# ✅ PHASE 8: Production Ready (Day 9)
**STOP HERE until all items checked ✅**

## Security Audit
- [ ] No secrets in code (check all files)
- [ ] .env not in git repository
- [ ] All endpoints use HTTPS
- [ ] API requires authentication
- [ ] Passwords are hashed (never stored plain)

## Cost Check
- [ ] Cloudflare Dashboard → Billing
- [ ] Check current usage
- [ ] Should be in free tier or < $10
- [ ] Set up billing alert at $15

## Documentation
- [ ] Update README with your worker URLs
- [ ] Document any custom configuration
- [ ] Create admin guide (how to check logs, etc.)
- [ ] List known issues

### 🛑 FINAL VALIDATION
- [ ] Real AEMO data flowing (not mock)
- [ ] Can register and login users
- [ ] All 6 apps loading
- [ ] WebSocket working
- [ ] Data persists
- [ ] Costs acceptable
- [ ] **ALL ITEMS CHECKED**

---

# 🎉 COMPLETE!

## Your platform is now:
- ✅ Collecting real AEMO data every 5 minutes
- ✅ Storing in D1 database
- ✅ Serving via authenticated API
- ✅ Displaying in 6 working apps
- ✅ Broadcasting updates via WebSocket
- ✅ Deployed to Cloudflare edge network

## What's Next?
1. Monitor for 24 hours
2. Check data completeness
3. Fine-tune caching
4. Add more features

## Need Help?
- Check logs: `wrangler tail [worker-name]`
- Check data: `wrangler d1 execute sunney-market --command="SELECT ..."`
- Check the IMPLEMENTATION_GUIDE.md for detailed troubleshooting

---

**Remember: DO NOT move to next phase until current phase is 100% complete!**