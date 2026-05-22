# Testing the Scraper Worker

## Quick Test Methods

### Method 1: Via Admin UI (Recommended)

1. **Open the admin scraper page:**
   ```
   http://<NEW_VPS_HOST>/admin/scraper
   ```

2. **Create a small test job:**
   - Platform: **EdgeProp** (simpler, no districts needed)
   - Pages: **1**
   - Max Listings: **5** (optional, for quick test)
   - Click "Start Scraping"

3. **Monitor the job:**
   - Watch the job status change: `queued` → `running` → `completed`
   - Check the progress panel for real-time updates
   - View logs if available

### Method 2: Via Test Script

Run the test script locally (it will create a job and monitor it):

```bash
cd smartprop
bun scripts/test-worker-job.ts
```

This will:
- Create a test job in the database
- Enqueue it in pg-boss
- Monitor the job status for up to 60 seconds
- Show you if the job was processed successfully

### Method 3: Check Worker Logs on EC2

SSH into EC2 and monitor the worker logs:

```bash
ssh -i smartprop-new-key.pem ${EC2_USER:-ec2-user}@${EC2_IP}
cd /opt/smartprop/app/smartprop
pm2 logs scraper-worker --lines 50
```

Look for:
- `[ScraperWorker] Processing job ...` - Job picked up
- `[ScraperWorker] Updated job ... to running status` - Status updated
- `[ScraperWorker] Starting scraper process...` - Process starting
- `[ScraperWorker] Scraper process completed` - Success
- Any error messages

## What to Look For

### ✅ Success Indicators

1. **Job Status Changes:**
   - `queued` → `running` → `completed`
   - Status updates happen within seconds

2. **Worker Logs Show:**
   ```
   [ScraperWorker] Processing job <job-id> for <platform>
   [ScraperWorker] Updated job <job-id> to running status
   [ScraperWorker] Starting scraper process...
   [ScraperWorker] Scraper process completed
   [ScraperWorker] Updated job <job-id> to completed status
   ```

3. **Database Shows:**
   - Job status = `completed`
   - `listings_processed` > 0
   - `completed_at` timestamp set

### ❌ Failure Indicators

1. **Job Stuck in `queued`:**
   - Worker not picking up jobs
   - Check worker is running: `pm2 status scraper-worker`
   - Check worker logs for errors

2. **Job in `running` but not progressing:**
   - Scraper process might be stuck
   - Check `/tmp/ep-scraper-<job-id>.log` or `/tmp/pg-scraper-<job-id>.log`
   - Check worker logs for errors

3. **Job Status = `failed`:**
   - Check `error_message` field in database
   - Check worker logs for detailed error
   - Check scraper process logs in `/tmp/`

## Troubleshooting

### Worker Not Processing Jobs

1. **Check worker is running:**
   ```bash
   pm2 status scraper-worker
   ```

2. **Check worker logs:**
   ```bash
   pm2 logs scraper-worker --lines 100
   ```

3. **Restart worker:**
   ```bash
   pm2 restart scraper-worker
   ```

### Jobs Failing

1. **Check error message in database:**
   ```sql
   SELECT id, status, error_message
   FROM scraper_jobs
   WHERE status = 'failed'
   ORDER BY started_at DESC
   LIMIT 5;
   ```

2. **Check scraper process logs:**
   ```bash
   # On EC2
   ls -la /tmp/*scraper*.log
   tail -50 /tmp/ep-scraper-<job-id>.log
   ```

3. **Check if scraper scripts exist:**
   ```bash
   # On EC2
   ls -la src/workers/ep.live.ts
   ls -la src/workers/pg.districts.ts
   ```

## Expected Behavior

When everything is working:

1. **Job Creation** (instant)
   - Job appears in database with status `queued`
   - Job appears in pg-boss queue

2. **Job Processing** (within 5-10 seconds)
   - Worker picks up job
   - Status changes to `running`
   - Scraper process starts

3. **Job Completion** (depends on pages/listings)
   - For 1 page, 5 listings: ~1-2 minutes
   - Status changes to `completed`
   - Results saved to database

## Monitoring Commands

```bash
# On EC2 - Watch worker logs in real-time
pm2 logs scraper-worker

# Check worker status
pm2 status scraper-worker

# Check recent jobs
# (via Supabase MCP or SQL)
SELECT id, platform, status, started_at, completed_at
FROM scraper_jobs
ORDER BY started_at DESC
LIMIT 10;
```

