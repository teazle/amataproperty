#!/bin/bash
set -e

# Configuration
EC2_IP="${EC2_IP:?Set EC2_IP to the current VPS IP or hostname}"
EC2_USER="ec2-user"
PEM_KEY="/Users/vincent/propertydemo/smartprop-new-key.pem"
APP_DIR="/opt/smartprop"
BRANCH="main"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 Updating SmartProp on EC2 (${EC2_IP})...${NC}"

# SSH into EC2 and pull + rebuild
ssh -i ${PEM_KEY} \
    -o StrictHostKeyChecking=no \
    ${EC2_USER}@${EC2_IP} << 'ENDSSH'
set -e

export PATH="$HOME/.bun/bin:$PATH"
cd /opt/smartprop/app/smartprop

echo "📥 Pulling latest changes..."
git fetch origin
git reset --hard origin/main
git pull origin main

echo "📦 Installing dependencies..."
bun install --frozen-lockfile

echo "🔨 Building application..."
NODE_ENV=production bunx next build

echo "🔄 Restarting application..."
pm2 startOrReload ecosystem.config.js || pm2 start ecosystem.config.js
pm2 save

echo "✅ Update complete!"
echo ""
echo "Application status:"
pm2 status
echo ""
echo "Recent logs:"
pm2 logs smartprop --lines 20 --nostream
pm2 logs scraper-worker --lines 20 --nostream
ENDSSH

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Update failed${NC}"
    exit 1
fi

echo -e "${GREEN}🎉 Update completed successfully!${NC}"
echo -e "${BLUE}📝 Access your app at: http://${EC2_IP}${NC}"
