# SSH Debug Guide for PropertyGuru Scraper

## Quick SSH Commands

### 1. SSH into Your Server

If you have the EC2 key and IP:
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP}
```

Or if using a different key:
```bash
ssh -i /path/to/your-key.pem -o StrictHostKeyChecking=no ec2-user@[YOUR_SERVER_IP]
```

### 2. Navigate to App Directory

If running in Docker:
```bash
cd /opt/smartprop/app
# or
cd /app
```

If running directly:
```bash
cd /opt/smartprop/app
# or wherever your app is located
```

### 3. Run the Diagnostic Script

```bash
# Copy the script to your server first, then:
bash scripts/check-pg-scraper-logs.sh
```

## Manual Checks

### Check Lock File (Progress Tracking)
```bash
# Find the storage directory
find . -name "pg-scraper.lock" 2>/dev/null
# or check common locations:
cat storage/pg-scraper.lock | jq '.'
# or without jq:
cat storage/pg-scraper.lock
```

### Check Log Files
```bash
# List all PropertyGuru log files
ls -lth /tmp/pg-scraper-*.log

# View latest log file
LATEST_LOG=$(ls -t /tmp/pg-scraper-*.log | head -1)
tail -100 "$LATEST_LOG"

# Follow logs in real-time
tail -f "$LATEST_LOG"
```

### Check if Process is Running
```bash
# Check for scraper processes
ps aux | grep -E "pg.districts|propertyguru" | grep -v grep

# Check process by PID (from lock file)
PID=$(cat storage/pg-scraper.lock | grep -o '"pid":[0-9]*' | grep -o '[0-9]*')
ps -p "$PID" -o pid,cmd,etime
```

### Check Docker Containers (if using Docker)
```bash
# List running containers
docker-compose ps
# or
docker ps

# View container logs
docker-compose logs -f --tail=100 [service-name]
# Common service names: smartprop-app, worker, etc.

# Check if scraper is running inside container
docker exec -it [container-name] ps aux | grep pg.districts
```

### Check Database Job Status

Via Supabase Dashboard:
1. Go to https://supabase.com/dashboard
2. Navigate to Table Editor → `scraper_jobs`
3. Filter by `status = 'running'` or `status = 'queued'`
4. Check the `last_updated_at` column

Or via SQL:
```sql
SELECT
  id,
  platform,
  status,
  current_district,
  current_page,
  total_pages,
  listings_processed,
  stats,
  started_at,
  last_updated_at,
  error_message
FROM scraper_jobs
WHERE status IN ('running', 'queued')
ORDER BY started_at DESC
LIMIT 5;
```

### Check API Status Endpoint
```bash
# From your local machine or server
curl http://localhost:3000/api/scraper/status
# or if on server with domain:
curl https://your-domain.com/api/scraper/status
```

## Common Issues & Solutions

### Issue: No Progress Showing on Frontend

**Check 1: Is the scraper actually running?**
```bash
ps aux | grep pg.districts
```

**Check 2: Is the lock file being updated?**
```bash
watch -n 2 'cat storage/pg-scraper.lock | jq ".progress"'
```

**Check 3: Are logs being written?**
```bash
tail -f /tmp/pg-scraper-*.log | tail -1
```

**Check 4: Is the database job updating?**
- Check `last_updated_at` in `scraper_jobs` table
- Should update every few seconds when scraping

**Check 5: Is SSE connection working?**
- Open browser DevTools → Network tab
- Look for `/api/scraper/status` request
- Should show "EventStream" type
- Check for errors in console

### Issue: Scraper Started But No Updates

**Possible causes:**
1. **Lock file not updating** - Check if scraper is writing to lock file
2. **Database not updating** - Check if `PG_JOB_ID` env var is set
3. **SSE connection broken** - Check browser console for errors
4. **Scraper stuck** - Check logs for errors or Cloudflare blocks

**Fix:**
```bash
# Check environment variable
echo $PG_JOB_ID

# If missing, the scraper won't update database
# Check how the scraper was started - it should have PG_JOB_ID set
```

### Issue: Stale Lock File

If lock file exists but process is dead:
```bash
# Remove stale lock (careful - only if process is definitely dead!)
rm storage/pg-scraper.lock

# Or use the force reset from frontend
```

## Quick Diagnostic Commands

Run these in sequence:

```bash
# 1. Check if scraper is running
echo "=== Process Check ==="
ps aux | grep -E "pg.districts|propertyguru" | grep -v grep || echo "No scraper process found"

# 2. Check lock file
echo -e "\n=== Lock File ==="
[ -f storage/pg-scraper.lock ] && cat storage/pg-scraper.lock | jq '.' || echo "No lock file"

# 3. Check latest log
echo -e "\n=== Latest Log (last 20 lines) ==="
LATEST=$(ls -t /tmp/pg-scraper-*.log 2>/dev/null | head -1)
[ -n "$LATEST" ] && tail -20 "$LATEST" || echo "No log files found"

# 4. Check environment
echo -e "\n=== Environment ==="
echo "PG_JOB_ID: ${PG_JOB_ID:-NOT SET}"
echo "PG_DISTRICTS: ${PG_DISTRICTS:-NOT SET}"
echo "PG_MAX_PAGES: ${PG_MAX_PAGES:-NOT SET}"

# 5. Check Docker (if applicable)
echo -e "\n=== Docker Status ==="
docker-compose ps 2>/dev/null || echo "Not using Docker Compose"
```

## Next Steps After Diagnosis

1. **If scraper is running but not updating:**
   - Check logs for errors
   - Verify `PG_JOB_ID` is set
   - Check database connection

2. **If scraper is not running:**
   - Check if it crashed (look for error in logs)
   - Check if it completed (look for completion message)
   - Restart the scraper from frontend

3. **If SSE is not working:**
   - Check browser console
   - Verify API endpoint is accessible
   - Check server logs for API errors

