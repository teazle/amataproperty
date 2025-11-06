#!/bin/bash

# SmartProp Docker Hub Build and Deploy Script
# This script builds the image locally and deploys to EC2 using Docker Hub

set -e

# Configuration
if [ -z "$1" ]; then
    echo "Usage: $0 <docker-hub-username>"
    echo "Example: $0 vincentlim"
    exit 1
fi

DOCKER_HUB_USERNAME="$1"
IMAGE_NAME="smartprop"
TAG="latest"
EC2_IP="18.142.125.78"
KEY_FILE="smartprop-ec2-key.pem"

echo "🔧 Using Docker Hub username: ${DOCKER_HUB_USERNAME}"

echo "🚀 Starting SmartProp Docker Hub deployment..."

# Step 1: Build image locally
echo "📦 Building Docker image locally..."
docker build -t ${IMAGE_NAME}:${TAG} ..

# Step 2: Tag for Docker Hub
echo "🏷️  Tagging image for Docker Hub..."
docker tag ${IMAGE_NAME}:${TAG} ${DOCKER_HUB_USERNAME}/${IMAGE_NAME}:${TAG}

# Step 3: Push to Docker Hub (requires login)
echo "⬆️  Pushing to Docker Hub..."
echo "Note: Make sure you're logged in with 'docker login'"
docker push ${DOCKER_HUB_USERNAME}/${IMAGE_NAME}:${TAG}

# Step 4: Update docker-compose on EC2
echo "📋 Updating docker-compose configuration on EC2..."
# Replace placeholder with actual username
sed "s/DOCKER_HUB_USERNAME/${DOCKER_HUB_USERNAME}/g" docker-compose.ec2.yml > docker-compose.temp.yml
scp -i ${KEY_FILE} -o StrictHostKeyChecking=no docker-compose.temp.yml ubuntu@${EC2_IP}:/opt/smartprop/app/docker-compose.prod.yml
rm docker-compose.temp.yml

# Step 5: Deploy on EC2
echo "🚀 Deploying on EC2..."
ssh -i ${KEY_FILE} -o StrictHostKeyChecking=no ubuntu@${EC2_IP} << 'EOF'
cd /opt/smartprop/app
echo "Pulling latest image..."
docker-compose -f docker-compose.prod.yml pull smartprop-app
echo "Starting services..."
docker-compose -f docker-compose.prod.yml up -d
echo "Checking status..."
docker-compose -f docker-compose.prod.yml ps
EOF

echo "✅ Deployment complete!"
echo "🌐 Your application should be available at: http://${EC2_IP}"
echo "📊 Check logs with: ssh -i ${KEY_FILE} ubuntu@${EC2_IP} 'cd /opt/smartprop/app && docker-compose -f docker-compose.prod.yml logs -f'"