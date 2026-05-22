#!/bin/bash
# Script to install Playwright browsers on EC2

EC2_IP="${EC2_IP:?Set EC2_IP to the current VPS IP or hostname}"
EC2_USER="ec2-user"
PEM_KEY="/Users/vincent/propertydemo/smartprop-new-key.pem"

echo "🔧 Installing Playwright browsers on EC2..."
echo ""

ssh -i ${PEM_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_IP} << 'ENDSSH'
cd /opt/smartprop/app/smartprop

export PATH="/home/ec2-user/.bun/bin:$PATH"

echo "📦 Installing Playwright browsers..."
echo "   This may take a few minutes..."
echo ""

# Install all playwright browsers (playwright-ghost may need them)
npx playwright install 2>&1

echo ""
echo "✅ Playwright installation complete!"
ENDSSH

echo ""
echo "🎉 Done!"
