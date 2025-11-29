# Scraper Worker Troubleshooting Guide

## Problem: Jobs are Queued but Not Executing

When scraping jobs are queued in the database but not being processed, it usually means the **scraper worker process is not running** or has encountered an error.

## Architecture Overview

The scraping system uses a job queue architecture:

1. **Job Queue**: `pg-boss` (PostgreSQL-based job queue)
2. **Worker Process**: `src/lib/queue/scraper-worker.ts` - picks up and processes jobs one at a time
3. **Process Manager**: PM2 manages the worker process on EC2

## How It Works

1. When you start a scraper job, it:
   - Creates a record in `scraper_jobs` table with status `'queued'`
   - Enqueues the job in `pg-boss` queue via `enqueueScraperJob()`

2. The worker process (`scraper-worker.ts`):
   - Connects to PostgreSQL via `pg-boss`
   - Listens for jobs in the `scraper-jobs` queue
   - Processes jobs one at a time (singleton mode)
   - Updates job status in database as it processes

3. If the worker is not running:
   - Jobs get queued but never processed
   - Jobs remain in `'queued'` status indefinitely

## Diagnosis Steps

### 1. Check if Worker is Running on EC2

```bash
# SSH into EC2
ssh -i smartprop-new-key.pem ec2-user@52.76.114.103

# Check PM2 status
pm2 status

# Check specifically for scraper-worker
pm2 list | grep scraper-worker
```

**Expected Output:**
- `scraper-worker` should appear in the PM2 list
- Status should be `online` (not `stopped`, `errored`, or `restarting`)

### 2. Check Worker Logs

```bash
# View recent logs
pm2 logs scraper-worker --lines 50

# View error logs specifically
tail -50 /home/ec2-user/.pm2/logs/scraper-worker-error.log

# View output logs
tail -50 /home/ec2-user/.pm2/logs/scraper-worker-out.log
```

**Look for:**
- Connection errors (database connection issues)
- `[pg-boss]` errors
- `[ScraperWorker]` messages
- Any stack traces or exceptions

### 3. Check Database Connection

The worker needs to connect to PostgreSQL via `pg-boss`. Check environment variables:

```bash
cd /opt/smartprop/app/smartprop
cat .env.local | grep -E "SUPABASE|DATABASE|PG_BOSS"
```

**Required Variables:**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `SUPABASE_DB_PASSWORD` OR `DATABASE_URL` OR `PG_BOSS_DATABASE_URL` - Database connection

### 4. Check Queued Jobs

Query the database to see how many jobs are queued:

```sql
SELECT 
  id, 
  platform, 
  status, 
  started_at,
  error_message
FROM scraper_jobs 
WHERE status = 'queued' 
ORDER BY started_at DESC 
LIMIT 10;
```

## Common Issues and Solutions

### Issue 1: Worker Process Not Running

**Symptoms:**
- `pm2 list` shows no `scraper-worker`
- Jobs remain in `queued` status

**Solution:**
```bash
cd /opt/smartprop/app/smartprop
pm2 start ecosystem.config.js
pm2 save
```

### Issue 2: Worker Process Crashed/Errored

**Symptoms:**
- `pm2 list` shows `scraper-worker` with status `errored` or `stopped`
- Logs show connection errors or exceptions

**Solution:**
1. Check logs for the specific error:
   ```bash
   pm2 logs scraper-worker --lines 100
   ```

2. Common fixes:
   - **Database connection error**: Verify `SUPABASE_DB_PASSWORD` or `DATABASE_URL` is correct
   - **Missing dependencies**: Run `bun install` in the app directory
   - **Port conflicts**: Check if port is already in use

3. Restart the worker:
   ```bash
   pm2 restart scraper-worker
   ```

### Issue 3: Database Connection Issues

**Symptoms:**
- Worker logs show `[pg-boss]` connection errors
- Worker can't connect to PostgreSQL

**Solution:**
1. Verify database credentials in `.env.local`
2. Check if using correct connection string format:
   - For Supabase: `postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require`
3. Test connection manually:
   ```bash
   cd /opt/smartprop/app/smartprop
   bun -e "import('./src/lib/queue/scraper-queue.ts').then(m => m.getBoss()).then(b => console.log('Connected!')).catch(e => console.error('Error:', e))"
   ```

### Issue 4: Worker Running but Jobs Not Processing

**Symptoms:**
- Worker is `online` in PM2
- Jobs remain `queued`
- No errors in logs

**Possible Causes:**
1. **pg-boss schema not initialized**: The `jobqueue` schema might not exist
2. **Queue configuration issue**: Queue might not be created properly
3. **Worker not subscribed to queue**: Worker might not be listening to the right queue

**Solution:**
1. Check if pg-boss schema exists:
   ```sql
   SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'jobqueue';
   ```

2. Restart worker to reinitialize:
   ```bash
   pm2 restart scraper-worker
   pm2 logs scraper-worker --lines 50
   ```

3. Look for `[ScraperWorker] Started scraper worker` in logs

## Quick Fix Script

Use the provided diagnostic script:

```bash
# From your local machine
cd smartprop
./scripts/check-worker-ec2.sh
```

Or run directly on EC2:

```bash
# SSH into EC2 first
ssh -i smartprop-new-key.pem ec2-user@52.76.114.103

# Then run
cd /opt/smartprop/app/smartprop
./scripts/diagnose-worker.sh
```

## Manual Worker Start

If PM2 is not working, you can start the worker manually for testing:

```bash
cd /opt/smartprop/app/smartprop
export PATH="$HOME/.bun/bin:$PATH"
bun src/lib/queue/scraper-worker.ts
```

**Note:** This runs in foreground. Use Ctrl+C to stop. For production, always use PM2.

## Verification

After fixing the issue, verify:

1. **Worker is running:**
   ```bash
   pm2 status | grep scraper-worker
   ```

2. **Worker is processing jobs:**
   - Check logs: `pm2 logs scraper-worker`
   - Look for: `[ScraperWorker] Started scraper worker`
   - Look for: Job processing messages

3. **Jobs are being processed:**
   ```sql
   SELECT status, COUNT(*) 
   FROM scraper_jobs 
   GROUP BY status;
   ```
   - `queued` count should decrease
   - `running` or `completed` count should increase

## Prevention

1. **Monitor worker status**: Set up monitoring/alerts for PM2 process status
2. **Check logs regularly**: Review worker logs for early warning signs
3. **Health checks**: Consider adding a health check endpoint that verifies worker connectivity
4. **Auto-restart**: Ensure PM2 `autorestart: true` is set in `ecosystem.config.js`

## Related Files

- `src/lib/queue/scraper-worker.ts` - Worker process
- `src/lib/queue/scraper-queue.ts` - Queue setup and connection
- `ecosystem.config.js` - PM2 configuration
- `src/app/admin/scraper/actions.ts` - Job creation and management

