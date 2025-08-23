#!/bin/bash

# Sunney.io Platform Setup Script
# This script creates all necessary Cloudflare resources

set -e

echo "🚀 Sunney.io Platform Setup"
echo "==========================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Wrangler CLI not found${NC}"
    echo "Installing wrangler..."
    npm install -g wrangler
fi

if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git not found. Please install git first.${NC}"
    exit 1
fi

# Check Cloudflare login
echo -e "${YELLOW}Checking Cloudflare authentication...${NC}"
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}Please login to Cloudflare:${NC}"
    wrangler login
fi

ACCOUNT_ID=$(wrangler whoami 2>/dev/null | grep "Account ID" | awk '{print $NF}')
echo -e "${GREEN}✅ Logged in to Cloudflare${NC}"
echo -e "Account ID: ${BLUE}$ACCOUNT_ID${NC}"
echo ""

# Create D1 Databases
echo -e "${YELLOW}Creating D1 Databases...${NC}"

echo "Creating sunney-auth database..."
AUTH_DB_OUTPUT=$(wrangler d1 create sunney-auth 2>&1 || true)
AUTH_DB_ID=$(echo "$AUTH_DB_OUTPUT" | grep -oE '[a-f0-9-]{36}' | head -1)
echo -e "${GREEN}✅ Auth Database ID: ${BLUE}$AUTH_DB_ID${NC}"

echo "Creating sunney-market database..."
MARKET_DB_OUTPUT=$(wrangler d1 create sunney-market 2>&1 || true)
MARKET_DB_ID=$(echo "$MARKET_DB_OUTPUT" | grep -oE '[a-f0-9-]{36}' | head -1)
echo -e "${GREEN}✅ Market Database ID: ${BLUE}$MARKET_DB_ID${NC}"

echo ""

# Create KV Namespaces
echo -e "${YELLOW}Creating KV Namespaces...${NC}"

echo "Creating sunney-cache namespace..."
CACHE_KV_OUTPUT=$(wrangler kv:namespace create "sunney-cache" 2>&1 || true)
CACHE_KV_ID=$(echo "$CACHE_KV_OUTPUT" | grep -oE '[a-f0-9]{32}' | head -1)
echo -e "${GREEN}✅ Cache KV ID: ${BLUE}$CACHE_KV_ID${NC}"

echo "Creating sunney-sessions namespace..."
SESSIONS_KV_OUTPUT=$(wrangler kv:namespace create "sunney-sessions" 2>&1 || true)
SESSIONS_KV_ID=$(echo "$SESSIONS_KV_OUTPUT" | grep -oE '[a-f0-9]{32}' | head -1)
echo -e "${GREEN}✅ Sessions KV ID: ${BLUE}$SESSIONS_KV_ID${NC}"

echo ""

# Create R2 Bucket
echo -e "${YELLOW}Creating R2 Bucket...${NC}"

echo "Creating sunney-archive bucket..."
wrangler r2 bucket create sunney-archive 2>&1 || true
echo -e "${GREEN}✅ R2 Bucket created: sunney-archive${NC}"

echo ""

# Generate JWT Secret
echo -e "${YELLOW}Generating JWT Secret...${NC}"
JWT_SECRET=$(openssl rand -base64 32)
echo -e "${GREEN}✅ JWT Secret generated${NC}"

echo ""

# Create configuration file
echo -e "${YELLOW}Creating configuration file...${NC}"

cat > .env.production << EOF
# Cloudflare Configuration
CF_ACCOUNT_ID=$ACCOUNT_ID

# Database IDs
AUTH_DB_ID=$AUTH_DB_ID
MARKET_DB_ID=$MARKET_DB_ID

# KV Namespace IDs
CACHE_KV_ID=$CACHE_KV_ID
SESSIONS_KV_ID=$SESSIONS_KV_ID

# R2 Bucket
R2_BUCKET_NAME=sunney-archive

# Auth
JWT_SECRET=$JWT_SECRET
EOF

echo -e "${GREEN}✅ Configuration saved to .env.production${NC}"

echo ""

# Update wrangler.toml files
echo -e "${YELLOW}Updating wrangler.toml files...${NC}"

# Update auth worker
if [ -f "workers/auth/wrangler.toml" ]; then
    sed -i.bak "s/YOUR_AUTH_DB_ID/$AUTH_DB_ID/g" workers/auth/wrangler.toml
    sed -i.bak "s/YOUR_SESSIONS_KV_ID/$SESSIONS_KV_ID/g" workers/auth/wrangler.toml
    sed -i.bak "s/GENERATE_A_SECURE_RANDOM_STRING_HERE/$JWT_SECRET/g" workers/auth/wrangler.toml
    echo -e "${GREEN}✅ Updated workers/auth/wrangler.toml${NC}"
fi

# Update API worker
if [ -f "workers/api/wrangler.toml" ]; then
    sed -i.bak "s/YOUR_MARKET_DB_ID/$MARKET_DB_ID/g" workers/api/wrangler.toml
    sed -i.bak "s/YOUR_CACHE_KV_ID/$CACHE_KV_ID/g" workers/api/wrangler.toml
    echo -e "${GREEN}✅ Updated workers/api/wrangler.toml${NC}"
fi

# Update scraper worker
if [ -f "workers/scraper/wrangler.toml" ]; then
    sed -i.bak "s/YOUR_MARKET_DB_ID/$MARKET_DB_ID/g" workers/scraper/wrangler.toml
    sed -i.bak "s/YOUR_CACHE_KV_ID/$CACHE_KV_ID/g" workers/scraper/wrangler.toml
    echo -e "${GREEN}✅ Updated workers/scraper/wrangler.toml${NC}"
fi

echo ""

# Initialize databases
echo -e "${YELLOW}Initializing databases...${NC}"

# Create auth database schema
if [ -f "scripts/schema-auth.sql" ]; then
    echo "Creating auth database schema..."
    wrangler d1 execute sunney-auth --file=scripts/schema-auth.sql
    echo -e "${GREEN}✅ Auth database initialized${NC}"
fi

# Create market database schema
if [ -f "scripts/schema-market.sql" ]; then
    echo "Creating market database schema..."
    wrangler d1 execute sunney-market --file=scripts/schema-market.sql
    echo -e "${GREEN}✅ Market database initialized${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Setup Complete!${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Add these secrets to GitHub:"
echo "   - Go to: https://github.com/eddie-greenwood/sunney.io/settings/secrets/actions"
echo "   - Add:"
echo -e "     ${BLUE}CF_API_TOKEN${NC}: Create at https://dash.cloudflare.com/profile/api-tokens"
echo -e "     ${BLUE}CF_ACCOUNT_ID${NC}: $ACCOUNT_ID"
echo -e "     ${BLUE}JWT_SECRET${NC}: $JWT_SECRET"
echo ""
echo "2. Deploy the platform:"
echo "   git add ."
echo "   git commit -m 'Configure Cloudflare resources'"
echo "   git push origin main"
echo ""
echo "3. Your platform will be available at:"
echo "   https://sunney.io (after DNS setup)"
echo ""
echo -e "${GREEN}Happy coding! 🚀${NC}"