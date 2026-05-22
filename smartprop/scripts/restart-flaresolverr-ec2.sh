#!/bin/bash
# Script to restart Flaresolverr on EC2

EC2_IP="${EC2_IP:?Set EC2_IP to the current VPS IP or hostname}"
EC2_USER="ec2-user"
PEM_KEY="/Users/vincent/propertydemo/smartprop-new-key.pem"

echo "🔄 Restarting Flaresolverr on EC2..."
echo ""

# Stop and remove existing container
echo "1. Stopping existing Flaresolverr container..."
ssh -i ${PEM_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_IP} "docker stop flaresolverr 2>/dev/null || echo 'Container not running'; docker rm flaresolverr 2>/dev/null || echo 'Container not found'"
echo ""

# Pull latest image
echo "2. Pulling latest Flaresolverr image..."
ssh -i ${PEM_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_IP} "docker pull ghcr.io/flaresolverr/flaresolverr:latest"
echo ""

# Start with proper configuration (more memory for Chrome)
echo "3. Starting Flaresolverr with proper configuration..."
ssh -i ${PEM_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_IP} "docker run -d \
  --name=flaresolverr \
  --platform=linux/arm64/v8 \
  --restart=unless-stopped \
  --shm-size=2g \
  -p 8191:8191 \
  -e LOG_LEVEL=info \
  -e LOG_HTML=false \
  -e CAPTCHA_SOLVER=none \
  -e TZ=Asia/Singapore \
  -e MAX_TIMEOUT=300000 \
  -e BROWSER_TIMEOUT=300000 \
  --memory=2g \
  --cpus=1.5 \
  ghcr.io/flaresolverr/flaresolverr:latest"
echo ""

# Wait for container to start
echo "4. Waiting for Flaresolverr to start..."
sleep 10

# Check status
echo "5. Checking container status..."
ssh -i ${PEM_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_IP} "docker ps | grep flaresolverr"
echo ""

# Test API endpoint
echo "6. Testing Flaresolverr API..."
ssh -i ${PEM_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_IP} "curl -X POST http://localhost:8191/v1 \
  -H 'Content-Type: application/json' \
  -d '{\"cmd\":\"request.get\",\"url\":\"https://www.google.com\",\"maxTimeout\":60000}' \
  -s -w '\nHTTP Status: %{http_code}\n' | head -30"
echo ""

echo "✅ Flaresolverr restart complete!"
echo ""
echo "To check logs:"
echo "  ssh -i ${PEM_KEY} ${EC2_USER}@${EC2_IP} 'docker logs -f flaresolverr'"
