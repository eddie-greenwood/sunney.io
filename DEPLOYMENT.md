# Sunney.io Deployment Guide
## Everything you need to deploy on a new machine

---

# 🚀 Quick Start

This guide will help you deploy Sunney.io from scratch on a new machine. 
**Follow these steps in order. Do not skip ahead.**

---

# Prerequisites

- Node.js 18+ installed
- Git installed
- Cloudflare account (free tier is fine)
- GitHub account

---

# Step 1: Setup Local Environment

```bash
# Clone the repository
git clone [your-repo] sunney.io
cd sunney.io

# Install Cloudflare CLI
npm install -g wrangler

# Create environment file
cat > .env << 'EOF'
CLOUDFLARE_ACCOUNT_ID=    # Get from Cloudflare dashboard
CLOUDFLARE_API_TOKEN=      # Create in Cloudflare dashboard
EOF
```

---

# Step 2: Create Cloudflare Resources

## Get Cloudflare Credentials

1. **Account ID**: 
   - Login to [Cloudflare Dashboard](https://dash.cloudflare.com)
   - Copy Account ID from right sidebar
   - Add to `.env`

2. **API Token**:
   - Go to My Profile → API Tokens → Create Token
   - Use template: "Edit Cloudflare Workers"
   - Add permissions: D1, KV, R2, Pages
   - Copy token to `.env`

3. **Verify Setup**:
```bash
wrangler whoami
# Should show your email
```

## Create Resources

```bash
# Create databases
wrangler d1 create sunney-auth
# Copy the returned database_id

wrangler d1 create sunney-market  
# Copy the returned database_id

# Create KV namespaces
wrangler kv:namespace create SESSIONS
# Copy the id

wrangler kv:namespace create CACHE
# Copy the id

wrangler kv:namespace create JWT_CACHE
# Copy the id

# Create R2 bucket
wrangler r2 bucket create sunney-archive
```

## Update Configuration Files

Update these files with the IDs you just copied:

1. `workers/auth/wrangler.toml`
```toml
[[d1_databases]]
binding = "DB"
database_name = "sunney-auth"
database_id = "YOUR_AUTH_DB_ID"  # <-- Replace this

[[kv_namespaces]]
binding = "SESSIONS"
id = "YOUR_SESSIONS_KV_ID"  # <-- Replace this
```

2. `workers/api/wrangler.toml`
```toml
[[d1_databases]]
binding = "DB"
database_name = "sunney-market"
database_id = "YOUR_MARKET_DB_ID"  # <-- Replace this

[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_CACHE_KV_ID"  # <-- Replace this
```

3. `workers/scraper/wrangler.toml`
```toml
[[d1_databases]]
binding = "DB"
database_name = "sunney-market"
database_id = "YOUR_MARKET_DB_ID"  # <-- Same as API worker
```

---

# Step 3: Initialize Databases

```bash
# Create tables in auth database
wrangler d1 execute sunney-auth --file=scripts/schema-auth.sql

# Create tables in market database  
wrangler d1 execute sunney-market --file=scripts/schema-market.sql

# Verify tables were created
wrangler d1 execute sunney-auth --command="SELECT name FROM sqlite_master WHERE type='table'"
# Should show: users, sessions, api_keys

wrangler d1 execute sunney-market --command="SELECT name FROM sqlite_master WHERE type='table'"
# Should show: dispatch_prices, forward_prices, fcas_prices, etc.
```

---

# Step 4: Fix AEMO Data Parser

## ⚠️ CRITICAL: Current Status
The scraper currently has a **partial implementation** of AEMO data parsing. You need to:

1. **Install dependencies**:
```bash
cd workers/scraper
npm install csv-parse
```

2. **Verify parser implementation**:
Check that `workers/scraper/src/aemo-parser.ts` exists and has real parsing logic.

3. **Test manually**:
```bash
# Deploy scraper first
wrangler deploy

# Trigger manual fetch
curl -X POST https://sunney-scraper.[your-subdomain].workers.dev/trigger

# Check logs
wrangler tail sunney-scraper

# Verify real data in database
wrangler d1 execute sunney-market --command="SELECT * FROM dispatch_prices ORDER BY created_at DESC LIMIT 5"
```

**Success Criteria**: Prices should be realistic ($20-200/MWh), not random numbers.

---

# Step 5: Set Secrets

```bash
# Generate JWT secret
openssl rand -base64 32
# Copy this value!

# Set for auth worker
cd workers/auth
echo "JWT_SECRET=your_generated_secret" > .dev.vars
wrangler secret put JWT_SECRET

# Set for API worker (if needed)
cd ../api
wrangler secret put JWT_SECRET
```

---

# Step 6: Deploy Workers

```bash
# Deploy auth worker
cd workers/auth
wrangler deploy
# Note the URL: https://sunney-auth.[subdomain].workers.dev

# Deploy API worker
cd ../api
wrangler deploy
# Note the URL: https://sunney-api.[subdomain].workers.dev

# Deploy scraper worker
cd ../scraper
wrangler deploy
# Note the URL: https://sunney-scraper.[subdomain].workers.dev
```

---

# Step 7: Deploy Frontend

```bash
cd pages
wrangler pages deploy public --project-name sunney-io

# Your site will be available at:
# https://sunney-io.pages.dev
```

## Configure Custom Domain (Optional)

1. Go to Cloudflare Dashboard → Pages → sunney-io
2. Custom domains → Set up a custom domain
3. Add your domain (e.g., sunney.io)

---

# Step 8: Verify Everything Works

## Test Auth
```bash
# Register a user
curl -X POST https://sunney-auth.[subdomain].workers.dev/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test1234!","name":"Test User"}'

# Should return a JWT token
```

## Test API
```bash
# Use the token from registration
TOKEN="your_jwt_token"

curl https://sunney-api.[subdomain].workers.dev/api/prices/latest \
  -H "Authorization: Bearer $TOKEN"

# Should return current NEM prices
```

## Test Frontend
1. Open https://sunney-io.pages.dev
2. Try to login with your test user
3. Navigate to dashboards
4. Verify prices are displayed

## Test Scraper
```bash
# Check if scraper is running
wrangler tail sunney-scraper

# Wait 5 minutes for scheduled run
# Or trigger manually:
curl -X POST https://sunney-scraper.[subdomain].workers.dev/trigger
```

---

# Troubleshooting

## No Price Data?
```bash
# Check scraper logs
wrangler tail sunney-scraper

# Check database
wrangler d1 execute sunney-market --command="SELECT COUNT(*) FROM dispatch_prices"

# Manually trigger scraper
curl -X POST https://sunney-scraper.[subdomain].workers.dev/trigger
```

## Authentication Failing?
```bash
# Check JWT secret is set
wrangler secret list --name sunney-auth

# Check user exists
wrangler d1 execute sunney-auth --command="SELECT * FROM users"
```

## Frontend Not Loading?
- Check browser console for errors
- Verify API URLs in frontend code match your worker URLs
- Check CORS settings in workers

---

# Architecture Overview

```
┌─────────────────┐
│      AEMO       │ Every 5 minutes
│    (NEMWEB)     │────────────┐
└─────────────────┘            │
                               ▼
                    ┌──────────────────┐
                    │ SCRAPER WORKER   │
                    │ Fetches & Parses │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │   D1 DATABASE    │
                    │  Market Prices   │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │   API WORKER     │
                    │  Serves Data     │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ CLOUDFLARE PAGES │
                    │  Frontend Apps   │
                    └──────────────────┘
```

---

# URLs After Deployment

- **Frontend**: https://sunney-io.pages.dev
- **API**: https://sunney-api.[subdomain].workers.dev
- **Auth**: https://sunney-auth.[subdomain].workers.dev
- **Scraper**: https://sunney-scraper.[subdomain].workers.dev

---

# Cost Estimate

With normal usage (< 1000 users):
- Workers: ~$5/month (after free tier)
- D1: Free (under 5GB)
- KV: Free (under limits)
- R2: Free (under 10GB)
- Pages: Free (unlimited)

**Total: ~$5-10/month**

---

# Next Steps

1. **Monitor for 24 hours** - Check data collection works
2. **Set up monitoring** - Use `wrangler tail` to watch logs
3. **Configure alerts** - Set up error notifications
4. **Custom domain** - Point sunney.io to Cloudflare Pages

---

# Support

- **Logs**: `wrangler tail [worker-name]`
- **Database**: `wrangler d1 execute [db-name] --command="SELECT ..."`
- **Cloudflare Docs**: https://developers.cloudflare.com
- **AEMO Data**: https://aemo.com.au/energy-systems/electricity/