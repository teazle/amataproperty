# Scraper Worker Issue - Investigation Summary

## Problem
All scraping jobs are queued but not executing one by one on EC2.

## Root Cause Analysis

The scraping system uses a **job queue architecture** with `pg-boss`:

1. **Job Creation**: When you start a scraper, it:
   - Creates a record in `scraper_jobs` table with status `'queued'`
   - Enqueues the job in `pg-boss` queue (PostgreSQL-based job queue)

2. **Job Processing**: A separate **worker process** (`scraper-worker.ts`) must be running to:
   - Connect to PostgreSQL via `pg-boss`
   - Listen for jobs in the queue
   - Process jobs one at a time
   - Update job status as it processes

3. **The Problem**: If the worker process is **not running**, jobs get queued but never processed.

## Most Likely Cause

The **scraper-worker process is not running** on EC2. This can happen if:
- PM2 didn't start the worker
- Worker crashed and PM2 didn't restart it
- Worker failed to start due to configuration/database connection issues

## Quick Diagnosis

Run this command to check the worker status:

```bash
cd smartprop
./scripts/check-worker-ec2.sh
```

Or manually SSH and check:

```bash
ssh -i smartprop-new-key.pem ${EC2_USER:-ec2-user}@${EC2_IP}
pm2 status
pm2 logs scraper-worker --lines 50
```

## Quick Fix

If the worker is not running, start it:

```bash
# SSH into EC2
ssh -i smartprop-new-key.pem ${EC2_USER:-ec2-user}@${EC2_IP}

# Navigate to app directory
cd /opt/smartprop/app/smartprop

# Start worker via PM2
pm2 start ecosystem.config.js
pm2 save

# Verify it's running
pm2 status
pm2 logs scraper-worker --lines 20
```

## Expected Behavior After Fix

1. Worker process shows as `online` in PM2
2. Worker logs show: `[ScraperWorker] Started scraper worker`
3. Queued jobs start processing (status changes from `queued` → `running` → `completed`)
4. Jobs process one at a time (singleton mode)

## Files to Check

- **Worker Process**: `src/lib/queue/scraper-worker.ts`
- **Queue Setup**: `src/lib/queue/scraper-queue.ts`
- **PM2 Config**: `ecosystem.config.js`
- **Job Creation**: `src/app/admin/scraper/actions.ts`

## Detailed Troubleshooting

See `docs/WORKER_TROUBLESHOOTING.md` for comprehensive troubleshooting guide.

