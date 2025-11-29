#!/bin/bash
# Script to update PM2 ecosystem config with FLARESOLVERR_URL and test connectivity

EC2_IP="52.76.114.103"
EC2_USER="ec2-user"
PEM_KEY="/Users/vincent/propertydemo/smartprop-new-key.pem"

echo "🔧 Updating PM2 ecosystem config with FLARESOLVERR_URL..."
echo ""

ssh -i ${PEM_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_IP} << 'ENDSSH'
set -e

cd /opt/smartprop/app/smartprop

# Check if ecosystem.config.js exists
if [ ! -f "ecosystem.config.js" ]; then
    echo "❌ ecosystem.config.js not found!"
    exit 1
fi

# Backup the file
cp ecosystem.config.js ecosystem.config.js.backup

# Check if FLARESOLVERR_URL is already in .env.local
if grep -q "FLARESOLVERR_URL" .env.local 2>/dev/null; then
    echo "✅ FLARESOLVERR_URL already in .env.local"
    FLARESOLVERR_URL=$(grep "FLARESOLVERR_URL" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d "'")
    echo "   Current value: $FLARESOLVERR_URL"
else
    echo "⚠️  FLARESOLVERR_URL not in .env.local, adding it..."
    echo "FLARESOLVERR_URL=http://localhost:8191/v1" >> .env.local
    echo "✅ Added FLARESOLVERR_URL=http://localhost:8191/v1 to .env.local"
fi

# The ecosystem.config.js should already load from .env.local
# But let's verify it's being loaded correctly
echo ""
echo "📋 Current PM2 processes:"
pm2 list

echo ""
echo "🧪 Testing FlareSolverr connectivity from host..."
if curl -s -f -X POST http://localhost:8191/v1 \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"request.get","url":"https://www.google.com","maxTimeout":60000}' \
  > /dev/null 2>&1; then
    echo "✅ FlareSolverr is reachable from host (localhost:8191)"
else
    echo "❌ FlareSolverr is NOT reachable from host"
    exit 1
fi

echo ""
echo "🔄 Reloading PM2 processes to pick up new environment variables..."
pm2 reload ecosystem.config.js

echo ""
echo "✅ Update complete!"
echo ""
echo "📊 PM2 status:"
pm2 status

echo ""
echo "To verify FLARESOLVERR_URL is loaded, check logs:"
echo "  pm2 logs smartprop --lines 50 | grep -i flaresolverr"
echo "  pm2 logs scraper-worker --lines 50 | grep -i flaresolverr"
ENDSSH

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Successfully updated PM2 config!"
    echo ""
    echo "🧪 Testing connectivity from containers (if any)..."
    ssh -i ${PEM_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_IP} << 'ENDSSH'
    # Test from WAHA container if it exists
    if docker ps | grep -q smartprop-waha; then
        echo "Testing from WAHA container..."
        docker exec smartprop-waha curl -s -f http://host.docker.internal:8191/v1 > /dev/null 2>&1 && \
            echo "✅ WAHA container can reach FlareSolverr" || \
            echo "⚠️  WAHA container cannot reach FlareSolverr (may need network config)"
    fi
ENDSSH
else
    echo "❌ Failed to update PM2 config"
    exit 1
fi

