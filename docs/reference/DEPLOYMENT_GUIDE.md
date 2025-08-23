# Sunney.io Deployment Guide
## Complete Setup Instructions from Zero to Production

## 📋 Prerequisites Checklist

- [ ] GitHub account
- [ ] Cloudflare account (free tier is fine)
- [ ] Node.js 18+ installed
- [ ] Git installed
- [ ] Terminal/Command line access

## 🚀 Step 1: GitHub Setup

### 1.1 Fork/Clone the Repository

```bash
# You've already created: https://github.com/eddie-greenwood/sunney.io
# Clone it locally
git clone https://github.com/eddie-greenwood/sunney.io.git
cd sunney.io

# Copy this sunney.io_Repo content to your repo
cp -r /Users/eddiemacpro/LeTool/sunney.io_Repo/* .
git add .
git commit -m "Initial sunney.io platform setup"
git push origin main
```

### 1.2 Setup GitHub Secrets

1. Go to: https://github.com/eddie-greenwood/sunney.io/settings/secrets/actions
2. Add these secrets:

```
CF_API_TOKEN = (we'll get this in Step 2)
CF_ACCOUNT_ID = (we'll get this in Step 2)
```

## 🔧 Step 2: Cloudflare Setup

### 2.1 Get Your Cloudflare Credentials

```bash
# Install Wrangler globally
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Get your account ID
wrangler whoami
# Save the "Account ID" - this is your CF_ACCOUNT_ID
```

### 2.2 Create API Token

1. Go to: https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use template: "Edit Cloudflare Workers"
4. Permissions needed:
   - Account: Cloudflare Workers Scripts:Edit
   - Account: Account Settings:Read
   - Zone: Page Rules:Edit
   - Zone: Workers Routes:Edit

5. Copy the token - this is your CF_API_TOKEN

### 2.3 Add to GitHub Secrets

Go back to GitHub secrets and add:
- `CF_API_TOKEN`: Your token from above
- `CF_ACCOUNT_ID`: Your account ID from wrangler whoami

## 📦 Step 3: Create Cloudflare Resources

### 3.1 Run Setup Script

```bash
# From sunney.io directory
cd scripts
chmod +x setup.sh
./setup.sh
```

This creates:
- 3 D1 databases (auth, market, trading)
- 3 KV namespaces (cache, sessions, state)
- 1 R2 bucket (sunney-archive)

### 3.2 Save the IDs

The script outputs IDs like:
```
✅ Created D1 database "sunney-auth"
   ID: abcd-1234-5678-efgh

✅ Created KV namespace "sunney-cache"
   ID: xyz123abc456
```

Save these IDs - you'll need them next.

## 🔨 Step 4: Configure Workers

### 4.1 Update Worker Configurations

Edit each worker's `wrangler.toml` with your IDs:

**workers/auth/wrangler.toml:**
```toml
name = "sunney-auth"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "sunney-auth"
database_id = "YOUR_AUTH_DB_ID"  # <-- Add your ID here

[[kv_namespaces]]
binding = "SESSIONS"
id = "YOUR_SESSIONS_KV_ID"  # <-- Add your ID here

[vars]
JWT_SECRET = "generate-a-secure-random-string-here"
```

**workers/api/wrangler.toml:**
```toml
name = "sunney-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "sunney-market"
database_id = "YOUR_MARKET_DB_ID"  # <-- Add your ID here

[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_CACHE_KV_ID"  # <-- Add your ID here

[[r2_buckets]]
binding = "ARCHIVE"
bucket_name = "sunney-archive"
```

**workers/scraper/wrangler.toml:**
```toml
name = "sunney-scraper"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "sunney-market"
database_id = "YOUR_MARKET_DB_ID"  # <-- Same as API worker

[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_CACHE_KV_ID"  # <-- Same as API worker

[[r2_buckets]]
binding = "ARCHIVE"
bucket_name = "sunney-archive"

[triggers]
crons = ["*/5 * * * *"]  # Every 5 minutes
```

## 🗄️ Step 5: Initialize Databases

### 5.1 Create Database Schemas

```bash
# Auth database
wrangler d1 execute sunney-auth --file=scripts/schema-auth.sql

# Market database
wrangler d1 execute sunney-market --file=scripts/schema-market.sql
```

## 🌐 Step 6: Setup Custom Domain

### 6.1 Add Domain to Cloudflare

1. Go to Cloudflare Dashboard
2. Add site: sunney.io
3. Update nameservers at your registrar

### 6.2 Configure DNS

Add these DNS records:

```
Type    Name    Content
----    ----    -------
CNAME   @       sunney-pages.pages.dev
CNAME   api     sunney-api.workers.dev
CNAME   auth    sunney-auth.workers.dev
```

### 6.3 Configure Pages

In `pages/wrangler.toml`:
```toml
name = "sunney-pages"
compatibility_date = "2024-01-01"

[site]
bucket = "./public"

[[routes]]
pattern = "sunney.io/*"
custom_domain = true
```

## 🚀 Step 7: Deploy Everything

### 7.1 Deploy via GitHub Actions

```bash
# Commit and push
git add .
git commit -m "Configure Cloudflare IDs"
git push origin main

# GitHub Actions will automatically deploy
```

### 7.2 Or Deploy Manually

```bash
# Deploy auth worker
cd workers/auth
wrangler deploy

# Deploy API worker
cd ../api
wrangler deploy

# Deploy scraper worker
cd ../scraper
wrangler deploy

# Deploy pages
cd ../../pages
wrangler pages deploy public --project-name sunney-pages
```

## ✅ Step 8: Verify Deployment

### 8.1 Check Workers

```bash
# Test auth worker
curl https://sunney-auth.workers.dev/health

# Test API worker
curl https://sunney-api.workers.dev/health

# Check scraper logs
wrangler tail sunney-scraper
```

### 8.2 Check Pages

Visit: https://sunney.io

You should see the login page.

## 🔄 Step 9: GitHub Actions Setup

### 9.1 Create Deployment Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      - name: Deploy Auth Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          workingDirectory: workers/auth
          command: deploy
      
      - name: Deploy API Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          workingDirectory: workers/api
          command: deploy
      
      - name: Deploy Scraper Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          workingDirectory: workers/scraper
          command: deploy
      
      - name: Deploy Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          projectName: sunney-pages
          directory: pages/public
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

## 🔐 Step 10: Create First User

### 10.1 Create Admin User

```bash
# Use wrangler to create admin user
wrangler d1 execute sunney-auth --command "
  INSERT INTO users (email, password_hash, role, created_at) 
  VALUES ('admin@sunney.io', 'hashed-password', 'admin', datetime('now'))
"
```

### 10.2 Test Login

1. Visit https://sunney.io
2. Login with admin credentials
3. You should see the dashboard

## 📊 Step 11: Migrate Data

### 11.1 Export from Old System

```bash
# Export data from old workers
wrangler d1 execute old-database --command "
  SELECT * FROM dispatch_prices 
  WHERE created_at > datetime('now', '-7 days')
" > export.sql
```

### 11.2 Import to New System

```bash
# Import to new database
wrangler d1 execute sunney-market --file=export.sql
```

## 🎯 GitHub vs Direct Deployment

### Recommended: GitHub → Cloudflare

**Benefits:**
✅ Version control
✅ Automatic deployment on push
✅ Rollback capability
✅ PR reviews
✅ Audit trail
✅ Team collaboration

**How it works:**
1. You push code to GitHub
2. GitHub Actions triggers
3. Wrangler deploys to Cloudflare
4. Everything is automated

### Not Recommended: Direct to Cloudflare

**Problems:**
❌ No version history
❌ No rollback
❌ No code review
❌ Manual process
❌ Easy to make mistakes

## 🚨 Troubleshooting

### Worker not deploying
```bash
# Check wrangler is logged in
wrangler whoami

# Check worker status
wrangler tail sunney-api
```

### Database connection issues
```bash
# Test database connection
wrangler d1 execute sunney-market --command "SELECT 1"
```

### GitHub Actions failing
- Check secrets are set correctly
- Check wrangler.toml has correct IDs
- Check GitHub Actions logs for errors

## 📈 Monitoring

### Real-time Logs
```bash
wrangler tail sunney-api --format=pretty
wrangler tail sunney-scraper --format=pretty
```

### Analytics Dashboard
1. Go to Cloudflare Dashboard
2. Select Workers & Pages
3. View analytics for each worker

## 🎉 Success Checklist

- [ ] GitHub repo created
- [ ] Cloudflare resources created
- [ ] Workers deployed
- [ ] Pages deployed
- [ ] Custom domain working
- [ ] Authentication working
- [ ] Data scraping running
- [ ] API responding
- [ ] Dashboards loading

## 📝 Next Steps

1. **Add monitoring**: Setup alerts for failures
2. **Add users**: Create user accounts
3. **Import data**: Migrate historical data
4. **Test thoroughly**: Run through all features
5. **Document**: Update API documentation

---

**Congratulations!** Your Sunney.io platform is now live and automated. Every push to GitHub will automatically deploy to production.