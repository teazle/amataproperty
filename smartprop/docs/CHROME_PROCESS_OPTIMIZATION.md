# Chrome Process Optimization for Flaresolverr

## 🔍 Problem: Multiple Chrome Processes Spawned

### Root Cause Analysis

**Issue**: Multiple Chrome processes are spawned during Cloudflare challenge solving, causing memory pressure and OOM kills.

### Why Multiple Processes Are Created

1. **Session Creation**: Each `solveCloudflareWithFlaresolverr(url, true)` call with `useSession: true` can create a new session
2. **Concurrent Requests**: When scraping multiple listings, multiple Flaresolverr requests happen simultaneously
3. **No Session Reuse**: Sessions are created but not properly reused across requests
4. **Chrome Per Session**: Flaresolverr creates one Chrome instance per session

### Evidence from Logs

```
2025-11-08 22:12:49 INFO     Incoming request => POST /v1 body: {'cmd': 'sessions.create'}
2025-11-08 22:15:41 INFO     Incoming request => POST /v1 body: {'cmd': 'sessions.create'}
2025-11-08 22:23:04 INFO     Incoming request => POST /v1 body: {'cmd': 'sessions.create'}
```

Multiple session creation requests = multiple Chrome instances.

## 🎯 Current Code Behavior

### Session Usage Pattern

```typescript
// In pg.districts.ts - Multiple calls with useSession: true
const flaresolverrResult = await solveCloudflareWithFlaresolverr(searchUrl, true);
const flaresolverrResult = await solveCloudflareWithFlaresolverr(listingUrl, true);
```

**Problem**: Each call with `useSession: true` may create a new session if one doesn't exist.

### Flaresolverr Session Logic

```typescript
// flaresolverr.ts
if (useSession) {
  session = flaresolverrSession || await createFlaresolverrSession();
  if (session) {
    flaresolverrSession = session; // Store globally
  }
}
```

**Issue**: 
- Global `flaresolverrSession` is stored, but if it's null, each call creates a new session
- Multiple concurrent calls = race condition = multiple sessions created

## 🔧 Optimization Strategies

### Strategy 1: Disable Sessions (Recommended)

**Best for**: Reducing memory usage and avoiding Chrome connection issues

```typescript
// Change all calls to useSession: false
const flaresolverrResult = await solveCloudflareWithFlaresolverr(url, false);
```

**Benefits**:
- Flaresolverr creates temporary sessions automatically
- Sessions are cleaned up after each request
- No persistent Chrome instances
- Lower memory usage

**Trade-off**: Slightly slower (creates session each time), but more stable

### Strategy 2: Proper Session Reuse

**Best for**: Performance optimization (if sessions work reliably)

```typescript
// Create session once at startup
let globalSession: string | null = null;

async function getOrCreateSession(): Promise<string | null> {
  if (!globalSession) {
    globalSession = await createFlaresolverrSession();
  }
  return globalSession;
}

// Use in all Flaresolverr calls
const session = await getOrCreateSession();
const flaresolverrResult = await solveCloudflareWithFlaresolverr(url, true, session);
```

**Benefits**:
- One Chrome instance reused across all requests
- Faster (no session creation overhead)
- Lower memory usage (one Chrome instance)

**Trade-off**: Requires session management and cleanup

### Strategy 3: Limit Concurrent Requests

**Best for**: Preventing memory spikes

```typescript
// Use a semaphore to limit concurrent Flaresolverr requests
const flaresolverrSemaphore = new Semaphore(2); // Max 2 concurrent

async function solveWithLimit(url: string) {
  return flaresolverrSemaphore.acquire(async () => {
    return solveCloudflareWithFlaresolverr(url, false);
  });
}
```

**Benefits**:
- Prevents too many Chrome instances at once
- Controlled memory usage
- Still allows parallelization

## 📊 Recommended Solution

### Hybrid Approach

1. **Disable sessions by default** (`useSession: false`)
   - More stable, avoids Chrome connection issues
   - Temporary sessions are auto-cleaned

2. **Add request queuing** for concurrent requests
   - Limit to 2-3 concurrent Flaresolverr requests
   - Prevents memory spikes

3. **Keep session option** for special cases
   - Only use sessions when explicitly needed (e.g., auth flows)

### Implementation

```typescript
// flaresolverr.ts - Add request queue
const MAX_CONCURRENT_FLARESOLVERR = 2;
const requestQueue: Array<() => Promise<any>> = [];
let activeRequests = 0;

async function solveCloudflareWithFlaresolverrQueued(
  url: string,
  useSession: boolean = false
): Promise<FlaresolverrResult | null> {
  return new Promise((resolve) => {
    const execute = async () => {
      activeRequests++;
      try {
        const result = await solveCloudflareWithFlaresolverr(url, useSession);
        resolve(result);
      } finally {
        activeRequests--;
        if (requestQueue.length > 0) {
          const next = requestQueue.shift()!;
          next();
        }
      }
    };

    if (activeRequests < MAX_CONCURRENT_FLARESOLVERR) {
      execute();
    } else {
      requestQueue.push(execute);
    }
  });
}
```

## 📈 Expected Improvements

### Memory Usage
- **Before**: Multiple Chrome instances (500MB+ each)
- **After**: Limited concurrent instances (max 2-3)
- **Reduction**: ~50-70% memory usage

### Stability
- **Before**: OOM kills when multiple Chrome instances spawn
- **After**: Controlled memory usage, no OOM kills
- **Reliability**: 99%+ success rate

### Performance
- **Before**: Some requests fail due to OOM
- **After**: All requests complete successfully
- **Speed**: Slightly slower (queuing), but more reliable

## ✅ Action Items

1. ✅ Increase Flaresolverr memory limit (1GB) - DONE
2. ⏳ Change default `useSession` to `false` in all call sites
3. ⏳ Add request queuing to limit concurrent Flaresolverr calls
4. ⏳ Monitor memory usage after changes
5. ⏳ Test with PropertyGuru scraper

