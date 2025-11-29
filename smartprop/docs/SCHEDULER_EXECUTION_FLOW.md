# What Happens at 10:00 AM - Execution Flow

## Timeline at 10:00 AM SGT

### Step 1: Both Cron Jobs Trigger Simultaneously (within milliseconds)

At exactly 10:00 AM, two separate `node-cron` tasks trigger:
- **EP Scraper Daily** cron task
- **PG Districts 9-11 Daily** cron task

These are **independent cron tasks**, so they execute **simultaneously** (or within milliseconds of each other).

### Step 2: Jobs Get Queued (Sequential for PG Districts)

#### EP Schedule:
```
10:00:00.000 - EP cron triggers
10:00:00.001 - Calls startScrapeJob() for EdgeProp
10:00:00.050 - EP job enqueued to pg-boss queue (Priority 3)
```

#### PG Schedule:
```
10:00:00.000 - PG cron triggers
10:00:00.001 - Loops through districts [09, 10, 11]
10:00:00.002 - Calls startScrapeJob() for D09 → Job queued
10:00:00.050 - Calls startScrapeJob() for D10 → Job queued  
10:00:00.100 - Calls startScrapeJob() for D11 → Job queued
```

**Note**: The PG districts are queued **sequentially** (one after another) because the scheduler uses `await` in a `for` loop. However, this happens very quickly (within ~100ms).

### Step 3: Queue State After Enqueueing

After ~100ms, the queue contains **4 jobs** (all Priority 3):
1. EP Scraper job
2. PG D09 job
3. PG D10 job
4. PG D11 job

Order in queue: **FIFO** (First In, First Out) since all have same priority.

### Step 4: Worker Processes Jobs ONE BY ONE

The worker process:
- **Polls queue every 5 seconds**
- **Processes ONE job at a time** (no concurrency configured)
- **Waits for each job to complete** before picking up the next

#### Execution Order:

```
10:00:05 - Worker picks up Job #1 (EP Scraper)
10:00:05 - EP scraper starts running
10:15:00 - EP scraper completes (estimated 15 minutes)
10:15:00 - Worker picks up Job #2 (PG D09)
10:15:00 - PG D09 scraper starts running
10:30:00 - PG D09 scraper completes (estimated 15 minutes)
10:30:00 - Worker picks up Job #3 (PG D10)
10:30:00 - PG D10 scraper starts running
10:45:00 - PG D10 scraper completes (estimated 15 minutes)
10:45:00 - Worker picks up Job #4 (PG D11)
10:45:00 - PG D11 scraper starts running
11:00:00 - PG D11 scraper completes (estimated 15 minutes)
```

**Total time**: ~60 minutes for all 4 jobs to complete

## Key Points

### ✅ What Runs Simultaneously:
- **Cron triggers**: Both schedules trigger at the same time
- **Job enqueueing**: All 4 jobs get queued within ~100ms

### ❌ What Does NOT Run Simultaneously:
- **Job processing**: Worker processes jobs **ONE AT A TIME**
- **Scraper execution**: Only one scraper runs at a time

### Why Sequential Processing?

1. **Single Worker Process**: Only one worker process is running
2. **No Concurrency**: `boss.work()` is called without `teamSize` parameter
3. **Resource Constraints**: Each scraper uses significant resources:
   - Browser instance (Chromium)
   - Memory (~500MB-1GB per scraper)
   - CPU for browser automation
   - Network bandwidth

### Current Configuration

```typescript
// scraper-worker.ts
const workId = await boss.work<ScraperJobPayload>(
  SCRAPER_QUEUE_NAME,
  handleScraperJob  // Single handler = one job at a time
);
```

No `teamSize` or concurrency options are set, so pg-boss defaults to **sequential processing**.

## If You Want Parallel Processing

To run multiple scrapers simultaneously, you would need to:

1. **Add concurrency to worker**:
```typescript
const workId = await boss.work<ScraperJobPayload>(
  SCRAPER_QUEUE_NAME,
  handleScraperJob,
  {
    teamSize: 2,  // Process 2 jobs concurrently
    teamConcurrency: 2
  }
);
```

2. **Consider resource limits**:
   - Each scraper uses ~500MB-1GB RAM
   - EC2 instance needs enough resources
   - Database connection pool limits

3. **Monitor for conflicts**:
   - Lock files prevent concurrent scraping of same platform
   - Multiple EdgeProp scrapers might conflict

## Summary

**At 10:00 AM tomorrow:**
- ✅ EP and PG schedules trigger simultaneously
- ✅ All 4 jobs (1 EP + 3 PG districts) get queued within ~100ms
- ❌ Jobs process **ONE BY ONE** sequentially
- ⏱️ Total time: ~60 minutes for all jobs to complete

**Order of execution:**
1. EP Scraper (~15 min)
2. PG D09 (~15 min)
3. PG D10 (~15 min)
4. PG D11 (~15 min)

