# Sunney.io - Professional Energy Trading Platform

## 🚨 For Deployment on New Machine

**Follow the deployment guide:** [`DEPLOYMENT.md`](DEPLOYMENT.md)

## 🚀 What is Sunney.io?

A professional-grade energy trading platform for the Australian National Electricity Market (NEM), featuring:
- Real-time market data dashboards
- BESS optimization tools
- Forward curve modeling
- Trading simulator for training
- Secure user authentication

## 📁 Repository Structure

```
sunney.io_Repo/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions deployment
├── workers/
│   ├── auth/                   # Authentication worker
│   ├── api/                    # API gateway worker
│   └── scraper/                # Data collection worker
├── pages/
│   ├── public/                 # Static assets
│   ├── dashboards/             # Market dashboards
│   └── apps/                   # Trading apps
├── shared/
│   ├── types/                  # TypeScript definitions
│   └── utils/                  # Shared utilities
├── scripts/
│   ├── setup.sh               # Initial setup
│   └── migrate.sh             # Data migration
└── docs/
    ├── ARCHITECTURE.md        # System design
    ├── DEPLOYMENT.md          # Deploy guide
    └── API.md                 # API documentation
```

## 🏗️ Architecture

**3 Cloudflare Workers:**
1. **sunney-auth** - Authentication & user management
2. **sunney-api** - API gateway for all data
3. **sunney-scraper** - AEMO data collection

**See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed design.**

## 🚦 Quick Start

### Prerequisites
- Node.js 18+
- Cloudflare account
- GitHub account
- Wrangler CLI installed

### Initial Setup

1. **Clone and setup:**
```bash
git clone https://github.com/eddie-greenwood/sunney.io.git
cd sunney.io
npm install
```

2. **Configure Cloudflare:**
```bash
# Login to Cloudflare
wrangler login

# Run setup script
./scripts/setup.sh
```

3. **Set GitHub Secrets:**
Go to GitHub repo → Settings → Secrets → Actions

Add these secrets:
- `CF_API_TOKEN` - Your Cloudflare API token
- `CF_ACCOUNT_ID` - Your account ID

4. **Deploy:**
```bash
# Deploy to production
git push origin main

# GitHub Actions will automatically deploy
```

## 🔑 Authentication

All users must authenticate to access the platform:

```javascript
// Login
POST /auth/login
{
  "email": "user@example.com",
  "password": "secure-password"
}

// Returns JWT token
{
  "token": "eyJ...",
  "user": { ... }
}
```

## 📊 Available Apps

### Dashboards
- **NEM Live** - Real-time market prices
- **NEM Refined** - Enhanced visualization
- **AEMO Full** - Comprehensive market view

### Applications
- **Trading Simulator** - Practice trading strategies
- **BESS Optimizer** - Battery optimization tool
- **Forward Lite** - Forward curve modeling

## 🔄 Data Pipeline

```
AEMO Website → Scraper (every 5 min) → D1 Database → API → Your Apps
```

## 🚀 Deployment

### Automatic (Recommended)

Push to GitHub, everything deploys automatically:

```bash
git add .
git commit -m "feat: your feature"
git push origin main
```

### Manual

```bash
# Deploy workers
npm run deploy:auth
npm run deploy:api
npm run deploy:scraper

# Deploy pages
npm run deploy:pages
```

## 📈 Monitoring

- **Logs**: `wrangler tail sunney-api`
- **Analytics**: Cloudflare Dashboard
- **Errors**: Check GitHub Actions

## 💰 Costs

Estimated monthly costs:
- Workers: $5/month (Bundled plan)
- Storage: ~$5/month
- **Total**: ~$10/month

## 🔐 Security

- JWT authentication required
- Rate limiting enabled
- CORS configured
- Input validation with Zod
- Prepared SQL statements

## 📝 Environment Variables

Create `.env` file:
```bash
# Cloudflare
CF_API_TOKEN=your-token
CF_ACCOUNT_ID=your-account-id

# Database IDs (from setup script)
D1_DATABASE_ID=xxx
KV_NAMESPACE_ID=xxx
R2_BUCKET_NAME=sunney-archive

# Auth
JWT_SECRET=generate-secure-secret
```

## 🤝 Contributing

1. Create feature branch
2. Make changes
3. Submit PR
4. Wait for review
5. Auto-deploy on merge

## 📚 Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - System design
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) - Deployment guide
- [API.md](docs/API.md) - API reference
- [MIGRATION.md](docs/MIGRATION.md) - Migration from old system

## 🆘 Troubleshooting

### Worker not responding
```bash
wrangler tail sunney-api --env production
```

### Database issues
```bash
wrangler d1 execute sunney-db --command "SELECT * FROM dispatch_prices LIMIT 1"
```

### Authentication failing
Check JWT_SECRET is set in worker environment variables

## 📞 Support

- GitHub Issues: [sunney.io/issues](https://github.com/eddie-greenwood/sunney.io/issues)
- Documentation: [docs/](docs/)

---

Built with ❤️ for the Australian energy market