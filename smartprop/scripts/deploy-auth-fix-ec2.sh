#!/bin/bash
# Script to deploy auth fixes to EC2

EC2_IP="${EC2_IP:?Set EC2_IP to the current VPS IP or hostname}"
EC2_USER="ec2-user"
PEM_KEY="/Users/vincent/propertydemo/smartprop-new-key.pem"
APP_DIR="/opt/smartprop/app/smartprop"

echo "🚀 Deploying auth fixes to EC2..."
echo ""

# Copy the fixed auth.pg.ts file
echo "📦 Copying fixed auth.pg.ts..."
scp -i ${PEM_KEY} -o StrictHostKeyChecking=no \
  smartprop/src/workers/auth.pg.ts \
  ${EC2_USER}@${EC2_IP}:${APP_DIR}/src/workers/auth.pg.ts

echo ""
echo "✅ Fix deployed!"
echo ""
