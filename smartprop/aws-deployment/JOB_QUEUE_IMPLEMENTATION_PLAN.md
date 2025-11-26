# Job Queue Implementation Plan

## Research Summary

After researching job queue solutions for Node.js/TypeScript, two primary options stand out:

### Option 1: **pg-boss** (PostgreSQL-based) ⭐ **RECOMMENDED**
- **Library**: `/timgit/pg-boss`
- **Benchmark Score**: 87.8
- **Source Reputation**: High
- **Code Snippets**: 63

**Pros:**
- ✅ Uses PostgreSQL (you already have Supabase)
- ✅ No additional infrastructure needed
- ✅ Exactly-once job delivery guarantee
- ✅ Can create jobs within database transactions (atomic)
- ✅ Simple architecture (one less service to manage)
- ✅ Built-in retry with exponential backoff
- ✅ Priority queues, dead letter queues
- ✅ Singleton policy (perfect for preventing concurrent scrapers)
- ✅ Serverless-compatible
- ✅ Good TypeScript support

**Cons:**
- ⚠️ Slightly lower performance than BullMQ (but still excellent)
- ⚠️ Less feature-rich than BullMQ for complex workflows

### Option 2: **BullMQ** (Redis-based)
- **Library**: `/taskforcesh/bullmq`
- **Benchmark Score**: 94.4
- **Source Reputation**: High
- **Code Snippets**: 273

**Pros:**
- ✅ Highest performance (94.4 benchmark)
- ✅ More features (flows, parent-child jobs, etc.)
- ✅ Excellent for distributed systems
- ✅ Very mature and battle-tested
- ✅ Great TypeScript support

**Cons:**
- ❌ Requires Redis (additional infrastructure)
- ❌ More complex setup
- ❌ Additional service to monitor/maintain
- ❌ Extra cost for Redis hosting

## Recommendation: **pg-boss**

**Why pg-boss is better for your use case:**

1. **No Additional Infrastructure**: You're already using Supabase (PostgreSQL), so no need for Redis
2. **Simpler Architecture**: One less service to deploy, monitor, and maintain
3. **Perfect for Your Needs**: 
   - Singleton policy prevents concurrent scrapers (solves OOM issue)
   - Priority system for manual vs scheduled jobs
   - Built-in retry mechanism
   - Exactly-once delivery (critical for scraping)
4. **Cost-Effective**: No additional hosting costs
5. **EC2-Friendly**: Works well on single-instance deployments

## Implementation Plan

### Phase 1: Setup & Integration (Day 1)

#### 1.1 Install Dependencies
```bash
bun add pg-boss
```

**DB considerations (Supabase):**
- Use a dedicated DB role and schema for pg-boss tables to isolate permissions.
- Ensure pgBouncer is on; cap boss connections (`max`, `monitorStateInterval`) to stay under Supabase rate limits.
- Prefer SSL/TLS connection strings and keep credentials in env vars.

#### 1.2 Create Queue Manager Service
**File**: `src/lib/queue/scraper-queue.ts`

**Responsibilities:**
- Initialize pg-boss with Supabase connection
- Create scraper queues (one per platform or unified)
- Configure queue policies (singleton for preventing concurrent jobs)
- Set up retry mechanisms
- Expose start/stop/shutdown helpers so workers can drain gracefully on deploy restarts (SIGTERM/SIGINT).

**Deployment topology:**
- Run a single dedicated worker process (PM2/systemd) per environment to enforce singleton across instances. Next.js/API instances are producers only.

**Key Features:**
- Singleton policy: Only 1 job active at a time (prevents OOM)
- Priority system: Manual jobs (priority 1) > Scheduled jobs (priority 5)
- Retry: 3 attempts with exponential backoff
- Dead letter queue: Failed jobs after all retries
- Heartbeat/timeout: configure `expireInSeconds` + periodic job heartbeat to detect stuck scrapes and fail them cleanly.

#### 1.3 Update Scheduler
**File**: `src/lib/scheduler/scraper-scheduler.ts`

**Changes:**
- Instead of calling `startScrapeJob` directly, add jobs to queue (for PG, enqueue one job per district)
- Scheduler becomes a "job producer" (adds to queue)
- Queue processor handles actual execution
- Keep backoff/retry on producer side if enqueue fails due to rate limits.

#### 1.4 Create Queue Worker
**File**: `src/lib/queue/scraper-worker.ts`

**Responsibilities:**
- Process jobs from queue (one at a time)
- Call existing scraper workers (`pg.districts.ts`, `ep.live.ts`)
- Handle job completion/failure
- Update database job status
- Map pg-boss events to `scraper_jobs` table (queued → running → completed/failed) and push final failures to DLQ.
- Add per-job idempotency key to avoid duplicate side effects on retries.
- Graceful shutdown: stop taking new work, finish current job, release boss.

### Phase 2: Queue Architecture

```
┌─────────────────┐
│  Scheduler      │  ← Adds jobs to queue (doesn't execute)
│  (Cron Jobs)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Job Queue      │  ← PostgreSQL table (pg-boss)
│  (pg-boss)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Queue Worker   │  ← Processes ONE job at a time
│  (Singleton)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Scraper        │  ← Existing workers (pg.districts.ts, ep.live.ts)
│  Workers        │
└─────────────────┘
```

### Phase 3: Implementation Details

#### 3.1 Queue Configuration

**Queue Name**: `scraper-jobs` (unified queue for both platforms)

**Queue Policy**: `singleton` (only 1 active job at a time)

**Configuration:**
```typescript
await boss.createQueue('scraper-jobs', {
  policy: 'singleton', // Only 1 job active at a time
  retryLimit: 3,
  retryDelay: 60, // 1 minute
  retryBackoff: true, // Exponential backoff
  expireInSeconds: 3600, // 1 hour timeout
  deleteAfterSeconds: 86400, // Keep completed jobs for 1 day
  deadLetter: 'scraper-failed' // Dead letter queue for failed jobs
});
```

#### 3.2 Job Data Structure

```typescript
interface ScraperJobData {
  platform: 'propertyguru' | 'edgeprop';
  config: {
    district?: string; // For PG
    pages: number;
    maxListings?: number;
  };
  jobId: string; // Database job ID
  priority: number; // 1 = manual, 5 = scheduled
  source: 'manual' | 'scheduled' | 'retry';
}
```

#### 3.3 Priority System

- **Priority 1**: Manual job starts (user-initiated)
- **Priority 5**: Scheduled jobs
- **Priority 10**: Retry jobs
- Starvation guard: allow scheduled jobs to run when manual queue is empty; consider aging long-waiting jobs up one level.

#### 3.4 Worker Implementation

```typescript
// Process jobs one at a time (singleton policy ensures this)
await boss.work('scraper-jobs', async (job) => {
  const { platform, config, jobId } = job.data;
  
  // Update database: queued -> running
  await updateJobStatus(jobId, 'running');
  
  try {
    // Call existing scraper worker
    if (platform === 'propertyguru') {
      await runPropertyGuruScraper(config);
    } else {
      await runEdgePropScraper(config);
    }
    
    // Update database: running -> completed
    await updateJobStatus(jobId, 'completed');
  } catch (error) {
    // Update database: running -> failed
    await updateJobStatus(jobId, 'failed', error.message);
    throw error; // Let pg-boss handle retry
  }
});
```

### Phase 4: Migration Strategy

#### 4.1 Backward Compatibility
- Keep existing `startScrapeJob` function
- Modify it to add jobs to queue instead of spawning processes directly
- Existing code continues to work
- Status mapping: enqueue → `queued`; worker start → `running`; success → `completed`; retry attempts increment error_message/attempts; final fail → `failed` + DLQ entry.

#### 4.2 Gradual Rollout
1. Deploy queue system alongside existing system
2. Test with manual jobs first
3. Migrate scheduled jobs
4. Remove old direct spawning code

#### 4.3 Database Migration
- pg-boss creates its own tables automatically
- No changes needed to `scraper_jobs` table
- Queue status tracked separately by pg-boss

### Phase 5: Benefits

#### 5.1 Solves Current Issues
- ✅ **No Race Conditions**: Singleton policy ensures only 1 job runs
- ✅ **No OOM Issues**: One job at a time = predictable memory usage
- ✅ **Job Queuing**: Jobs queued instead of rejected
- ✅ **Priority System**: Manual jobs processed first
- ✅ **Retry Mechanism**: Failed jobs automatically retried

#### 5.2 Additional Benefits
- ✅ **Better Monitoring**: Queue statistics (queued, active, completed)
- ✅ **Dead Letter Queue**: Failed jobs preserved for analysis
- ✅ **Job History**: pg-boss tracks all job states
- ✅ **Scalability**: Can add more workers later if needed
- ✅ **Operational Safety**: Graceful shutdown prevents mid-scrape corruption

### Phase 6: Code Structure

```
src/
├── lib/
│   ├── queue/
│   │   ├── scraper-queue.ts      # Queue initialization & management
│   │   ├── scraper-worker.ts     # Job processor
│   │   └── queue-types.ts        # TypeScript types
│   └── scheduler/
│       └── scraper-scheduler.ts # Updated to use queue
└── app/
    └── admin/
        └── scraper/
            └── actions.ts        # Updated to add jobs to queue
```

### Phase 7: Testing Plan

1. **Unit Tests**: Queue operations, job creation
2. **Integration Tests**: Full job lifecycle
3. **Load Tests**: Multiple concurrent job requests
4. **Failure Tests**: Job failures, retries, dead letter queue
5. **Concurrency Tests**: Rapid-fire enqueue + verify singleton execution
6. **Graceful Shutdown**: Send SIGTERM during a job and ensure it drains cleanly
7. **Idempotency**: Retry same payload twice and ensure no duplicate DB side-effects

### Phase 8: Monitoring & Observability

- Queue statistics API endpoint (expose boss state + in-flight job)
- Dashboard for queue status and DLQ contents
- Alerts for failed jobs and DLQ growth
- Metrics: job completion rate, average processing time, retry count, time-to-start
- Logs: centralize worker stdout/stderr; ship to CloudWatch/Logtail; include jobId in all log lines for correlation

## Implementation Timeline

- **Day 1**: Setup pg-boss, create queue manager
- **Day 2**: Implement queue worker, update scheduler
- **Day 3**: Update `startScrapeJob` to use queue
- **Day 4**: Testing & bug fixes
- **Day 5**: Deploy to EC2, monitor

## Risk Mitigation

1. **Queue Failure**: Fallback to direct spawning if queue unavailable
2. **Database Load**: Monitor PostgreSQL connection pool
3. **Job Stuck**: Implement job timeout and cleanup
4. **Migration**: Keep old code for rollback capability

## Success Metrics

- ✅ Zero concurrent scraper jobs (singleton policy)
- ✅ Zero OOM kills from scrapers
- ✅ 100% job queuing (no rejections)
- ✅ Automatic retry for transient failures
- ✅ Priority system working (manual jobs first)

## Next Steps

1. Review this plan
2. Approve pg-boss as solution
3. Begin Phase 1 implementation
4. Test locally before EC2 deployment
