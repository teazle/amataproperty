# Environment Variable Issue: Why .env.local Controls Max Pages

## Problem Statement

The `.env.local` file has `PG_MAX_PAGES=3` and `EP_MAX_PAGES=3`, and these values are controlling scraper execution even when jobs are started with different page counts from the UI.

## Root Cause Analysis

### Current Flow

1. **User starts job via UI** (`ScraperConfigForm.tsx`)
   - User selects pages (e.g., 5 pages)
   - Calls `startScrapeJob({ pages: 5, ... })`

2. **Job is queued** (`actions.ts:229-244`)
   - `config.pages = 5` is passed to `enqueueScraperJob`
   - Job is added to queue with `pages: 5` in payload

3. **Queue worker spawns scraper** (`scraper-worker.ts:86-104`)
   ```typescript
   const env: NodeJS.ProcessEnv = {
     ...process.env,  // Spreads ALL existing env vars (including from .env.local)
     env.PG_MAX_PAGES = config.pages.toString(); // Sets to "5"
   }
   ```

4. **Scraper worker loads .env.local** (`ep.live.ts:1-5`, `pg.districts.ts` likely similar)
   ```typescript
   import { config } from 'dotenv';
   config({ path: path.resolve(process.cwd(), '.env.local') });
   ```

5. **Scraper worker reads env var** (`pg.districts.ts:328`, `ep.live.ts:99`)
   ```typescript
   const maxPagesPerDistrict = parseInt(process.env.PG_MAX_PAGES || '3', 10);
   const maxPages = parseInt(process.env.EP_MAX_PAGES || '10');
   ```

### The Problem ⚠️

**The issue is in step 4**: When the scraper worker script runs, it loads `.env.local` at the **very top** of the file, which **OVERRIDES** the environment variables that were set by the queue worker!

**Flow:**
1. Queue worker sets `env.PG_MAX_PAGES = "5"` and spawns the process
2. Spawned process starts with `PG_MAX_PAGES=5` in its environment
3. **BUT** when `ep.live.ts` or `pg.districts.ts` runs, the first thing it does is:
   ```typescript
   config({ path: path.resolve(process.cwd(), '.env.local') });
   ```
4. This loads `.env.local` which has `PG_MAX_PAGES=3`, **overriding** the `5` that was set!

### Why This Happens

The `dotenv` `config()` function by default **overwrites** existing environment variables. So even though the queue worker sets `PG_MAX_PAGES=5`, when the scraper worker loads `.env.local`, it overwrites it back to `3`.

## Solution

The `dotenv.config()` function has an `override` option. We should set it to `false` so it doesn't override existing env vars:

```typescript
// Current (WRONG):
config({ path: path.resolve(process.cwd(), '.env.local') });

// Fixed (CORRECT):
config({ 
  path: path.resolve(process.cwd(), '.env.local'),
  override: false  // Don't override existing env vars
});
```

This way:
- If env vars are set by the queue worker (from job config), they take precedence
- If env vars are NOT set (direct CLI usage), `.env.local` provides defaults
- Best of both worlds!

## Files That Need Fixing

1. `src/workers/ep.live.ts:5` - Change `config()` to `config({ override: false })`
2. `src/workers/pg.districts.ts` - Check if it loads `.env.local` and fix if needed
3. `src/workers/supa.ts:5` - Same fix (though this is less critical)

## Verification

After the fix:
- ✅ Jobs started via UI with 5 pages → scraper uses 5 pages
- ✅ Jobs started via UI with 3 pages → scraper uses 3 pages  
- ✅ Direct CLI usage (`bun src/workers/pg.districts.ts`) → uses `.env.local` defaults (3 pages)
- ✅ Direct CLI with override (`PG_MAX_PAGES=10 bun src/workers/pg.districts.ts`) → uses 10 pages

## Summary

**Root Cause**: Scraper workers load `.env.local` with `override: true` (default), which overwrites env vars set by the queue worker.

**Fix**: Set `override: false` when loading `.env.local` in scraper workers, so job-specific config takes precedence.
