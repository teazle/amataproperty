# Job Scheduler Flow Documentation

## Overview

The scraper job scheduler uses a **two-tier architecture**:
1. **Scheduler Service** (`scraper-scheduler.ts`) - Manages cron-based scheduling
2. **Worker Process** (`scraper-worker.ts`) - Processes jobs from the queue

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    SCHEDULER SERVICE                             │
│  (runs in Next.js server process via instrumentation.ts)        │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ 1. Loads enabled schedules from DB
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              scheduled_jobs TABLE (PostgreSQL)                   │
│  - Stores cron expressions, config, enabled status                │
│  - Tracks last_run_at, next_run_at, last_run_status             │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ 2. Cron triggers at scheduled time
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              node-cron (in-process scheduler)                    │
│  - Executes cron jobs based on cron_expression                   │
│  - Prevents overlapping executions (noOverlap: true)             │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ 3. Calls startScrapeJob()
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              startScrapeJob() (actions.ts)                      │
│  - Creates job record in scraper_jobs table                      │
│  - Enqueues job to pg-boss queue                                 │
│  - Sets priority: scheduled=3, manual=1                           │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ 4. Job added to queue
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              pg-boss QUEUE (PostgreSQL)                         │
│  - Stores job payload with priority                             │
│  - Queue name: 'scraper-jobs'                                   │
│  - DLQ name: 'scraper-jobs-dlq'                                 │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ 5. Worker polls queue
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              SCRAPER WORKER (standalone process)                │
│  - Runs as PM2 process on EC2                                    │
│  - Polls pg-boss queue every 5 seconds                          │
│  - Processes jobs one at a time                                 │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ 6. Spawns scraper process
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              SCRAPER PROCESS (ep.live.ts / pg.live.ts)          │
│  - Runs in xvfb-run (headless browser)                          │
│  - Scrapes listings and saves to database                      │
│  - Updates job status via worker                                │
└─────────────────────────────────────────────────────────────────┘
```

## Current Configuration

### Scheduled Jobs (from database)

1. **EP Scraper Daily**
   - Platform: `edgeprop`
   - Cron: `0 10 * * *` (Daily at 10:00 AM SGT)
   - Config: `{ pages: 10 }`
   - Status: ✅ Enabled
   - Last run: 2025-11-29 02:00:00 (success)
   - Next run: 2025-11-30 02:00:00

2. **PG Districts 9-11 Daily**
   - Platform: `propertyguru`
   - Cron: `0 10 * * *` (Daily at 10:00 AM SGT)
   - Config: `{ pages: 5, districts: ["09", "10", "11"] }`
   - Status: ✅ Enabled
   - Last run: 2025-11-29 02:00:00 (success)
   - Next run: 2025-11-30 02:00:00

## How It Works

### 1. Initialization (Server Startup)

When the Next.js server starts:
- `instrumentation.ts` runs (Next.js instrumentation hook)
- After 10-second delay, calls `initializeScheduler()`
- Scheduler loads all `enabled=true` jobs from `scheduled_jobs` table
- Creates `node-cron` tasks for each schedule
- Tasks start running and wait for cron triggers

### 2. Scheduled Execution

When cron time arrives:
- `node-cron` triggers the scheduled task
- Scheduler calls `executeJob()` for that schedule
- For PropertyGuru: Creates one job per district
- For EdgeProp: Creates one job
- Each job calls `startScrapeJob()` which:
  1. Creates record in `scraper_jobs` table (status: `queued`)
  2. Enqueues job to `pg-boss` queue with priority 3
  3. Returns success/failure

### 3. Job Processing

The worker process (running separately on EC2):
- Continuously polls `pg-boss` queue every 5 seconds
- When job found, updates `scraper_jobs.status` to `running`
- Spawns scraper process (`ep.live.ts` or `pg.live.ts`)
- Monitors process completion
- Updates `scraper_jobs.status` to `completed` or `failed`

### 4. Job Priority

Jobs have different priorities:
- **Manual jobs**: Priority 1 (highest)
- **Scheduled jobs**: Priority 3 (medium)
- **Other sources**: Priority 5 (lowest)

Lower numbers = higher priority (processed first)

## Key Components

### Scheduler Service (`scraper-scheduler.ts`)

- **Singleton pattern**: One instance per server
- **Cron management**: Uses `node-cron` v4 API
- **Overlap prevention**: `noOverlap: true` prevents concurrent runs
- **Rate limit handling**: Gracefully handles Supabase rate limits
- **Reload capability**: Can reload schedules via `/api/scheduler/reload`

### Worker Process (`scraper-worker.ts`)

- **Standalone process**: Runs independently via PM2
- **Queue polling**: Uses `pg-boss` to poll for jobs
- **Process spawning**: Spawns scraper scripts as child processes
- **Status tracking**: Updates job status in database
- **Heartbeat**: Sends periodic heartbeats for long-running jobs

### Queue System (`scraper-queue.ts`)

- **pg-boss**: PostgreSQL-based job queue
- **Connection pooling**: Uses Supavisor session mode (port 5432)
- **Queue names**: 
  - Main: `scraper-jobs`
  - DLQ: `scraper-jobs-dlq` (dead letter queue)
- **Connection settings**: Timeout, keepalive configured

## Current Deployment

### On EC2

- **Scheduler**: Runs in Next.js server process (via PM2)
- **Worker**: Runs as separate PM2 process (`scraper-worker`)
- **Both processes**: Share same database connection pool

### Process Management

```bash
# PM2 processes
pm2 list
# Shows:
# - smartprop (Next.js app with scheduler)
# - scraper-worker (worker process)
```

## Monitoring

### Check Scheduler Status

```bash
# API endpoint
GET /api/scheduler/status

# Returns:
{
  initialized: true,
  activeJobs: 2,
  jobDetails: [...]
}
```

### Check Worker Status

```bash
# On EC2
pm2 logs scraper-worker --lines 50

# Check for:
# - "[ScraperWorker] ✅ Started scraper worker successfully"
# - "[ScraperWorker] Processing job..."
```

### Check Scheduled Jobs

```sql
SELECT 
  name,
  platform,
  enabled,
  cron_expression,
  next_run_at,
  last_run_at,
  last_run_status
FROM scheduled_jobs
WHERE enabled = true;
```

## Manual Job Creation

Jobs can also be created manually:

1. **Via Admin UI**: `/admin/scraper` → "Start Scraping"
2. **Via API**: `POST /api/scraper/start`
3. **Via Code**: `startScrapeJob(config, 'manual')`

Manual jobs get priority 1 (highest) and are processed first.

## Troubleshooting

### Scheduler Not Running

1. Check if initialized:
   ```bash
   curl http://localhost:3000/api/scheduler/status
   ```

2. Check server logs for scheduler initialization

3. Reload manually:
   ```bash
   curl -X POST http://localhost:3000/api/scheduler/reload
   ```

### Worker Not Processing Jobs

1. Check PM2 status:
   ```bash
   pm2 status scraper-worker
   ```

2. Check worker logs:
   ```bash
   pm2 logs scraper-worker --lines 100
   ```

3. Check queue:
   ```sql
   SELECT * FROM jobqueue.job 
   WHERE name = 'scraper-jobs' 
   AND state = 'created';
   ```

### Jobs Stuck in Queue

1. Check for stuck jobs:
   ```sql
   SELECT * FROM scraper_jobs 
   WHERE status IN ('queued', 'running') 
   AND started_at < NOW() - INTERVAL '1 hour';
   ```

2. Clean up if needed (see cleanup scripts)

