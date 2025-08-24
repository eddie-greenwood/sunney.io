#!/bin/bash

# Sunney.io AEMO Scraper Deployment Script
# This script deploys the scraper, validation worker, and sets up monitoring

set -e  # Exit on error

echo "🚀 Starting Sunney.io AEMO Scraper Deployment"
echo "============================================"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Please install it first:"
    echo "   npm install -g wrangler"
    exit 1
fi

# 1. Deploy main scraper worker
echo ""
echo "📦 Step 1: Deploying Main Scraper Worker..."
echo "-------------------------------------------"
wrangler deploy --name sunney-scraper

# 2. Deploy validation worker
echo ""
echo "📦 Step 2: Deploying Validation Worker..."
echo "-----------------------------------------"
wrangler deploy src/validation-worker.ts --name sunney-validation

# 3. Set up Google Chat webhook
echo ""
echo "🔔 Step 3: Setting up Google Chat Alerts..."
echo "-------------------------------------------"
echo "Please follow these steps:"
echo "1. Open your Google Chat space"
echo "2. Click on the space name → 'Manage webhooks'"
echo "3. Create webhook named 'AEMO Validator'"
echo "4. Copy the webhook URL"
echo ""
read -p "Paste your Google Chat webhook URL here: " WEBHOOK_URL

if [ ! -z "$WEBHOOK_URL" ]; then
    echo "$WEBHOOK_URL" | wrangler secret put GOOGLE_CHAT_WEBHOOK --name sunney-validation
    echo "✅ Google Chat webhook configured"
    
    # Test the webhook
    echo ""
    echo "📧 Testing Google Chat webhook..."
    curl -X POST "$WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d '{"text": "✅ AEMO Validator successfully connected to Google Chat!"}' \
        --silent --output /dev/null
    echo "✅ Test message sent to Google Chat"
else
    echo "⚠️  Skipping Google Chat setup (no URL provided)"
fi

# 4. Set up cron schedules
echo ""
echo "⏰ Step 4: Configuring Cron Schedules..."
echo "----------------------------------------"
echo "Adding the following schedules:"
echo "  - Scraper: */5 * * * * (every 5 minutes)"
echo "  - Validation: */15 * * * * (every 15 minutes)"

# Update wrangler.toml for both workers
cat > wrangler-scraper.toml << EOF
name = "sunney-scraper"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "sunney-market"
database_id = "8ed478aa-18e4-4ba2-aabb-2225c05f6d0f"

[[kv_namespaces]]
binding = "CACHE"
id = "5ef4a4c71d364a7ebaf731a280233031"

[[r2_buckets]]
binding = "ARCHIVE"
bucket_name = "sunney-archive"

[[durable_objects.bindings]]
name = "TRADING_ROOM"
class_name = "TradingRoom"
script_name = "sunney-api"

[triggers]
crons = ["*/5 * * * *"]
EOF

cat > wrangler-validation.toml << EOF
name = "sunney-validation"
main = "src/validation-worker.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "sunney-market"
database_id = "8ed478aa-18e4-4ba2-aabb-2225c05f6d0f"

[[kv_namespaces]]
binding = "CACHE"
id = "5ef4a4c71d364a7ebaf731a280233031"

[triggers]
crons = ["*/15 * * * *"]
EOF

echo "✅ Cron schedules configured"

# 5. Run initial validation
echo ""
echo "🔍 Step 5: Running Initial Validation..."
echo "----------------------------------------"
VALIDATION_URL=$(wrangler subdomain | grep -o 'https://[^"]*' | head -1)
VALIDATION_RESULT=$(curl -s "${VALIDATION_URL}/validate")

echo "Validation Result:"
echo "$VALIDATION_RESULT" | jq '.'

# 6. Create monitoring dashboard
echo ""
echo "📊 Step 6: Setting up Monitoring..."
echo "-----------------------------------"
echo "To monitor your workers:"
echo "  1. Scraper logs: wrangler tail --name sunney-scraper"
echo "  2. Validation logs: wrangler tail --name sunney-validation"
echo "  3. Dashboard: https://dash.cloudflare.com"
echo ""
echo "Useful commands:"
echo "  - Manual scraper trigger: curl -X POST https://sunney-scraper.workers.dev/trigger"
echo "  - Manual validation: curl https://sunney-validation.workers.dev/validate"
echo "  - Check data freshness:"
echo "    wrangler d1 execute sunney-market --command \"SELECT MAX(settlement_date) FROM dispatch_prices\""

# 7. Final status check
echo ""
echo "✅ Deployment Complete!"
echo "======================"
echo ""
echo "Next steps:"
echo "1. Monitor Google Chat for any validation alerts"
echo "2. Check data is being collected: wrangler tail --name sunney-scraper"
echo "3. Verify validation passes: curl https://sunney-validation.workers.dev/validate"
echo "4. Implement PREDISPATCH and ST PASA fetchers (see VALIDATION.md)"
echo ""
echo "📚 Documentation:"
echo "  - README.md: Overall architecture and data access"
echo "  - VALIDATION.md: Validation system and troubleshooting"
echo "  - AEMO_DATA_GUIDE.md: Data field mappings"