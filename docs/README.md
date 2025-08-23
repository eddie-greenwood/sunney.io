# Documentation Guide

## Essential Files (Start Here)

### For Deployment
- **[`../DEPLOYMENT.md`](../DEPLOYMENT.md)** - Step-by-step deployment instructions
- **[`../CURRENT_STATUS.md`](../CURRENT_STATUS.md)** - What's working, what needs fixing

### For Understanding
- **[`../ARCHITECTURE.md`](../ARCHITECTURE.md)** - How the system works
- **[`../README.md`](../README.md)** - Project overview

## Additional Documentation

### `/archive/` - Historical Development
These files document the development process but aren't needed for deployment:
- `COMPLETE_IMPLEMENTATION_GUIDE.md` - What was built (redundant with README)
- `IMPLEMENTATION_GUIDE.md` - Detailed build phases (very long)
- `TODO_CHECKLIST.md` - Development checklist
- `APPS_MIGRATION_COMPLETE.md` - Migration status

### `/future/` - Enhancements
Future features and optimizations:
- `IMPROVEMENTS_ROADMAP.md` - Planned features
- `SCALABILITY_IMPROVEMENTS.md` - Performance optimizations

### `/reference/` - Detailed References
Older deployment guides with additional detail:
- `DEPLOYMENT_GUIDE.md` - Original deployment guide
- `DEPLOYMENT_CHECKLIST.md` - Issues and fixes
- `READY_FOR_DEPLOYMENT.md` - Deployment summary

## Quick Decision Tree

```
Need to deploy? → Read DEPLOYMENT.md
Want to understand the system? → Read ARCHITECTURE.md
Checking what's broken? → Read CURRENT_STATUS.md
Planning new features? → Check /future/ folder
```

## Important Notes

1. **DEPLOYMENT.md** is the single source of truth for deployment
2. Some older docs have conflicting information - trust DEPLOYMENT.md
3. The AEMO parser status needs verification (see CURRENT_STATUS.md)
4. All placeholder values in wrangler.toml files need real IDs

---

*If you're deploying to a new machine, just follow DEPLOYMENT.md step by step.*