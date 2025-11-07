#!/bin/bash
# Script to restart Flaresolverr with proper configuration

echo "🔄 Restarting Flaresolverr..."

# Stop existing container
docker stop flaresolverr 2>/dev/null || echo "Container not running"
docker rm flaresolverr 2>/dev/null || echo "Container not found"

# Pull latest image
docker pull ghcr.io/flaresolverr/flaresolverr:latest

# Start with proper configuration
docker run -d \
  --name=flaresolverr \
  --restart=unless-stopped \
  -p 8191:8191 \
  -e LOG_LEVEL=info \
  -e LOG_HTML=false \
  -e CAPTCHA_SOLVER=none \
  -e TZ=Asia/Singapore \
  --memory=500m \
  --cpus=0.5 \
  ghcr.io/flaresolverr/flaresolverr:latest

echo "✅ Flaresolverr restarted!"
echo ""
echo "Checking status..."
sleep 3
docker ps | grep flaresolverr

echo ""
echo "Testing API..."
curl -X POST http://localhost:8191/v1 \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"request.get","url":"https://www.google.com","maxTimeout":60000}' \
  2>&1 | head -20

