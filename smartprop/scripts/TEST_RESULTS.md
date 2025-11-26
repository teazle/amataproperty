# Scraper Test Results on EC2

## Test Date
November 26, 2025

## EC2 Instance Information
- **Instance ID**: i-0b41277535712c09b
- **Public IP**: 52.76.114.103
- **State**: Running
- **SSH User**: ec2-user
- **Application Directory**: /opt/smartprop/app

## Test Results

### ✅ Connection & Setup
- ✅ EC2 instance found and running
- ✅ SSH connection successful
- ✅ Application directory found
- ✅ Bun runtime available at `/home/ec2-user/.bun/bin/bun`
- ✅ EdgeProp worker file found: `./smartprop/src/workers/ep.live.ts`
- ✅ PropertyGuru worker file found: `./smartprop/src/workers/pg.districts.ts`

### ⚠️ Environment Variables Issue
Both scrapers failed to run due to missing environment variables:
- `.env.local` file exists but contains 0 variables
- Supabase URL is required but not set
- Error: `supabaseUrl is required`

### 🔍 Findings

1. **Worker Files Location**: The worker files are located at:
   - EdgeProp: `./smartprop/src/workers/ep.live.ts`
   - PropertyGuru: `./smartprop/src/workers/pg.districts.ts`

2. **Docker Containers Running**:
   - `smartprop-waha` (WAHA service) - Running and healthy
   - `flaresolverr` (Cloudflare bypass) - Running but unhealthy

3. **Environment Variables**: The environment variables are likely configured in:
   - `docker-compose.prod.yml` (for containerized services)
   - But not available for direct script execution

## Recommendations

### Option 1: Test Scrapers Inside Docker Container
If there's a worker container, test the scrapers inside it where environment variables are available:

```bash
docker exec -it <worker-container> bun run src/workers/ep.live.ts
docker exec -it <worker-container> bun run src/workers/pg.districts.ts
```

### Option 2: Load Environment from Docker Compose
Extract environment variables from docker-compose.prod.yml and export them before running tests.

### Option 3: Create .env.local File
Manually create or copy the `.env.local` file with required variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `PG_EMAIL` and `PG_PASSWORD` (for PropertyGuru)
- `EP_EMAIL` and `EP_PASSWORD` (for EdgeProp)
- Other required variables

## Next Steps

1. **Check for worker container**: Verify if there's a dedicated worker container in docker-compose
2. **Set up environment variables**: Either create `.env.local` or extract from docker-compose
3. **Re-run tests**: Once environment is configured, re-run the test script

## Test Script Location
The test script is available at: `smartprop/scripts/test-scrapers-ec2.sh`

To run the test again:
```bash
cd smartprop
bash scripts/test-scrapers-ec2.sh
```

