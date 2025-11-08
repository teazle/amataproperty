# EC2 Frontend Scraper Issues - Root Cause Analysis

## Problem
Scrapers work when tested directly via scripts, but fail when started from the frontend.

## Root Causes Identified

### 1. **Missing dotenv Loading in API Route** ✅ FIXED
- **Issue**: Next.js API routes don't automatically load `.env.local` in all contexts
- **Workers**: Explicitly load dotenv (`auth.ep.ts`, `ep.live.ts`)
- **API Route**: Was missing dotenv loading
- **Fix**: Added explicit `dotenv.config()` at the top of `/api/articles/scrape/route.ts`

### 2. **Missing FLARESOLVERR_URL Environment Variable** ✅ FIXED
- **Issue**: `FLARESOLVERR_URL` not set in `.env.local` on EC2
- **Default**: Falls back to `http://localhost:8191/v1` (should work)
- **Fix**: Added `FLARESOLVERR_URL=http://localhost:8191/v1` to `.env.local`

### 3. **Next.js Environment Variable Loading**
- **Issue**: Next.js loads env vars at build/start time, not dynamically
- **Solution**: Explicit dotenv loading ensures vars are available at runtime

## Differences Between Test Scripts and Frontend

### Test Scripts (Working)
```typescript
// scripts/test-ep-article-scraper.ts
import { scrapeEdgePropMCP } from '../src/lib/scraper/edgeprop-mcp-scraper';
// Runs directly with Bun, has access to all env vars
```

### Frontend API Route (Was Failing)
```typescript
// src/app/api/articles/scrape/route.ts
// Next.js API route - needs explicit dotenv loading
// Now fixed with dotenv.config()
```

## Environment Variables Required

### For EdgeProp Scraper:
- `FLARESOLVERR_URL` - Flaresolverr API endpoint (defaults to `http://localhost:8191/v1`)
- `EP_EMAIL` - EdgeProp login email
- `EP_PASSWORD` - EdgeProp login password
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase URL
- `SUPABASE_SERVICE_ROLE` - Supabase service role key

### For PropertyGuru Scraper:
- `PG_EMAIL` - PropertyGuru login email
- `PG_PASSWORD` - PropertyGuru login password
- `PG_MAX_PAGES` - Max pages to scrape
- `FLARESOLVERR_URL` - Flaresolverr API endpoint

## Verification Steps

1. **Check environment variables are loaded:**
   ```bash
   # In Next.js API route, log:
   console.log('FLARESOLVERR_URL:', process.env.FLARESOLVERR_URL);
   ```

2. **Verify Flaresolverr is accessible:**
   ```bash
   curl http://localhost:8191/v1 -X POST -H 'Content-Type: application/json' -d '{"cmd":"sessions.list"}'
   ```

3. **Check Next.js logs:**
   ```bash
   # Look for errors about missing env vars or Flaresolverr connection failures
   pm2 logs smartprop
   ```

## Fixes Applied

1. ✅ Added `dotenv.config()` to `/api/articles/scrape/route.ts`
2. ✅ Added `FLARESOLVERR_URL` to `.env.local` on EC2
3. ✅ Ensured all scraper functions have access to environment variables

## Next Steps

After deploying fixes:
1. Restart Next.js server to pick up changes
2. Test scraper from frontend
3. Monitor logs for any remaining issues

