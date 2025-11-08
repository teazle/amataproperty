#!/bin/bash
# Deploy and test Flaresolverr optimization on EC2

set -e

EC2_IP="18.142.253.142"
EC2_USER="ec2-user"
PEM_KEY="/Users/vincent/propertydemo/smartprop-new-key.pem"
APP_DIR="/opt/smartprop/app/smartprop"

echo "🚀 Deploying Flaresolverr optimization to EC2..."
echo ""

# Step 1: Pull latest code on EC2
echo "📥 Pulling latest code from GitHub..."
ssh -i ${PEM_KEY} \
    -o StrictHostKeyChecking=no \
    ${EC2_USER}@${EC2_IP} << 'ENDSSH'
cd /opt/smartprop/app
git pull origin main
cd smartprop
echo "✅ Code updated"
ENDSSH

if [ $? -ne 0 ]; then
    echo "❌ Failed to pull code. Check EC2 connection."
    exit 1
fi

echo ""
echo "✅ Code deployed successfully!"
echo ""
echo "🧪 To test with console logs visible, run:"
echo ""
echo "ssh -i ${PEM_KEY} ${EC2_USER}@${EC2_IP}"
echo "cd ${APP_DIR}"
echo "export PG_DISTRICTS='09'"
echo "export PG_MAX_PAGES='1'"
echo "export HEADLESS='false'"
echo "bun run scrape:pg:districts"
echo ""
echo "Watch for these log messages:"
echo "  💾 Saved fresh Cloudflare cookies (search page)"
echo "  🛡️  Cloudflare detected - calling Flaresolverr (only if blocked)"
echo "  ✅ Saved: [Agent] - [Phone] (successful scraping)"

