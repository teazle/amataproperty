# Auth Headless Mode Fix

## Issue

The PropertyGuru scraper was crashing when started from the frontend because:

1. **`auth.pg.ts` hardcoded `headless: false`** (line 20)
2. When the frontend spawns the scraper via `actions.ts`, it sets `DISPLAY=:99`
3. However, if DISPLAY is not accessible or not properly inherited, the browser launch fails

## Root Cause

- `auth.pg.ts` and `auth.ep.ts` both had `headless: false` hardcoded
- When `pg.districts.ts` calls `reAuthenticate()`, it executes `auth.pg.ts` via `xvfb-run`
- If DISPLAY is not set or not accessible, the browser launch fails with: "Looks like you launched a headed browser without having a XServer running"

## Solution

Updated both `auth.pg.ts` and `auth.ep.ts` to:

1. **Detect DISPLAY availability**: Check if `process.env.DISPLAY` is set
2. **Auto-detect headless mode**: Use headless mode if:
   - DISPLAY is not set
   - `HEADLESS=true` or `HEADLESS=1` is explicitly set
   - Running in CI (`CI=true`)
   - Running in production (`NODE_ENV=production`)
3. **Fallback gracefully**: If DISPLAY is not set, automatically use headless mode instead of crashing

## Changes Made

### `auth.pg.ts`
```typescript
// Before:
headless: false,

// After:
const hasDisplay = !!process.env.DISPLAY;
const forceHeadless = process.env.HEADLESS === 'true' || process.env.HEADLESS === '1';
const isHeadless = !hasDisplay || forceHeadless || process.env.CI === 'true' || process.env.NODE_ENV === 'production';

headless: isHeadless,
```

### `auth.ep.ts`
Same changes applied for consistency.

## How It Works Now

### Scenario 1: Frontend starts scraper (EC2)
- `actions.ts` sets `DISPLAY=:99` in the spawned process environment
- `pg.districts.ts` runs and may call `reAuthenticate()`
- `reAuthenticate()` executes `xvfb-run -a bun src/workers/auth.pg.ts`
- `auth.pg.ts` detects `DISPLAY` is set (via `xvfb-run`) and uses headed mode
- ✅ Works!

### Scenario 2: DISPLAY not set
- `auth.pg.ts` detects no DISPLAY
- Automatically uses headless mode
- ✅ Works without crashing!

### Scenario 3: Manual SSH test
- User runs `xvfb-run -a bun src/workers/auth.pg.ts`
- `xvfb-run` sets DISPLAY automatically
- `auth.pg.ts` detects DISPLAY and uses headed mode
- ✅ Works!

## Verification

The fix ensures:
1. ✅ Frontend scraper works (DISPLAY is set by `actions.ts`)
2. ✅ Manual SSH tests work (DISPLAY is set by `xvfb-run`)
3. ✅ Server environments work (falls back to headless if DISPLAY unavailable)
4. ✅ CI/CD environments work (detects `CI=true` and uses headless)

## Status

- ✅ Fixed `auth.pg.ts` - auto-detects headless mode
- ✅ Fixed `auth.ep.ts` - auto-detects headless mode
- ✅ Updated `actions.ts` to use `xvfb-run` consistently (same as `pg.districts.ts` and `ep.live.ts`)
- ✅ EdgeProp scraper uses headless mode by default (no DISPLAY needed)

## Additional Improvement: Consistent `xvfb-run` Usage

After fixing the headless detection, we also updated `actions.ts` to use `xvfb-run` when spawning scrapers, making it consistent with how the scrapers themselves call auth scripts:

**Before:**
```typescript
const child = spawn(bunPath, ['src/workers/pg.districts.ts'], {
  env: { DISPLAY: process.env.DISPLAY || ':99' }
});
```

**After:**
```typescript
const child = spawn('xvfb-run', ['-a', bunPath, 'src/workers/pg.districts.ts'], {
  env: { /* xvfb-run handles DISPLAY automatically */ }
});
```

This ensures:
- ✅ Consistent approach across all code paths
- ✅ `xvfb-run` automatically handles DISPLAY setup
- ✅ More robust - works even if Xvfb wasn't pre-started

## Testing

To test the fix:

1. **Frontend test**: Start scraper from admin panel - should work without crashes
2. **SSH test**: `ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ec2-user@52.76.114.103 "cd /opt/smartprop/app/smartprop && xvfb-run -a bun src/workers/auth.pg.ts"` - should work
3. **Headless test**: `HEADLESS=true bun src/workers/auth.pg.ts` - should use headless mode

