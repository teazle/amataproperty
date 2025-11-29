#!/bin/bash
# Diagnostic script to check scraper worker status on EC2

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🔍 Diagnosing Scraper Worker Status...${NC}"
echo ""

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 is not installed${NC}"
    exit 1
fi

echo -e "${BLUE}1. Checking PM2 process status...${NC}"
pm2 status
echo ""

echo -e "${BLUE}2. Checking scraper-worker process specifically...${NC}"
if pm2 list | grep -q scraper-worker; then
    echo -e "${GREEN}✅ scraper-worker process found in PM2${NC}"
    pm2 info scraper-worker
else
    echo -e "${RED}❌ scraper-worker process NOT found in PM2${NC}"
    echo -e "${YELLOW}⚠️  The worker process is not running!${NC}"
fi
echo ""

echo -e "${BLUE}3. Checking recent scraper-worker logs (last 50 lines)...${NC}"
if [ -f "/home/ec2-user/.pm2/logs/scraper-worker-error.log" ]; then
    echo -e "${YELLOW}Error logs:${NC}"
    tail -50 /home/ec2-user/.pm2/logs/scraper-worker-error.log
else
    echo -e "${YELLOW}No error log file found${NC}"
fi
echo ""

if [ -f "/home/ec2-user/.pm2/logs/scraper-worker-out.log" ]; then
    echo -e "${YELLOW}Output logs:${NC}"
    tail -50 /home/ec2-user/.pm2/logs/scraper-worker-out.log
else
    echo -e "${YELLOW}No output log file found${NC}"
fi
echo ""

echo -e "${BLUE}4. Checking if worker process is actually running (ps)...${NC}"
if ps aux | grep -E 'scraper-worker\.ts|scraper-worker' | grep -v grep; then
    echo -e "${GREEN}✅ Worker process is running${NC}"
else
    echo -e "${RED}❌ Worker process is NOT running${NC}"
fi
echo ""

echo -e "${BLUE}5. Checking database connection (pg-boss)...${NC}"
cd /opt/smartprop/app/smartprop || cd /home/ec2-user/smartprop || echo "Could not find app directory"
if [ -f ".env.local" ]; then
    echo -e "${GREEN}✅ .env.local file exists${NC}"
    # Check for required env vars
    if grep -q "NEXT_PUBLIC_SUPABASE_URL" .env.local && grep -q "SUPABASE_DB_PASSWORD\|DATABASE_URL\|PG_BOSS_DATABASE_URL" .env.local; then
        echo -e "${GREEN}✅ Database connection variables found${NC}"
    else
        echo -e "${RED}❌ Missing database connection variables${NC}"
        echo "Required: NEXT_PUBLIC_SUPABASE_URL and (SUPABASE_DB_PASSWORD or DATABASE_URL or PG_BOSS_DATABASE_URL)"
    fi
else
    echo -e "${RED}❌ .env.local file not found${NC}"
fi
echo ""

echo -e "${BLUE}6. Checking pg-boss queue status (if possible)...${NC}"
echo "Note: This requires database access. Checking if we can query pg-boss tables..."
echo ""

echo -e "${BLUE}7. Checking for queued jobs in database...${NC}"
echo "You can check this manually with:"
echo "  SELECT id, platform, status, started_at FROM scraper_jobs WHERE status = 'queued' ORDER BY started_at DESC LIMIT 10;"
echo ""

echo -e "${BLUE}8. Recommendations:${NC}"
if ! pm2 list | grep -q scraper-worker; then
    echo -e "${YELLOW}⚠️  Worker is not running. To start it:${NC}"
    echo "   pm2 start ecosystem.config.js"
    echo "   OR"
    echo "   pm2 start scraper-worker --interpreter none -- bun src/lib/queue/scraper-worker.ts"
    echo ""
fi

if pm2 list | grep scraper-worker | grep -q "errored\|stopped"; then
    echo -e "${YELLOW}⚠️  Worker has errors. To restart:${NC}"
    echo "   pm2 restart scraper-worker"
    echo "   pm2 logs scraper-worker --lines 100"
    echo ""
fi

echo -e "${GREEN}✅ Diagnosis complete!${NC}"

