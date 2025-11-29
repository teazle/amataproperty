#!/bin/bash
set -e

# Configuration
EC2_IP="52.76.114.103"
EC2_USER="ec2-user"
PEM_KEY="/Users/vincent/propertydemo/smartprop-new-key.pem"
APP_DIR="/opt/smartprop/app/smartprop"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Quick Deploy: Pull, Build, and Restart...${NC}"

ssh -i ${PEM_KEY} \
    -o StrictHostKeyChecking=no \
    ${EC2_USER}@${EC2_IP} << 'ENDSSH'
set -e

export PATH="$HOME/.bun/bin:$PATH"
cd /opt/smartprop/app/smartprop

echo "📥 Pulling latest changes from git..."
git fetch origin
git pull origin main

echo "📦 Installing dependencies (if needed)..."
bun install

echo "🔨 Building application..."
bun run build

echo "🔄 Restarting PM2 processes..."
pm2 restart ecosystem.config.js || pm2 reload ecosystem.config.js

echo "✅ Deployment complete!"
echo ""
echo "Application status:"
pm2 status

echo ""
echo "Recent logs:"
pm2 logs --lines 10 --nostream
ENDSSH

if [ $? -eq 0 ]; then
    echo -e "${GREEN}🎉 Quick deployment completed successfully!${NC}"
else
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi

