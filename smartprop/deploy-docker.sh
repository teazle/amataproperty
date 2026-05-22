#!/bin/bash
set -e

# Configuration
EC2_IP="${EC2_IP:?Set EC2_IP to the current VPS IP or hostname}"
EC2_USER="ec2-user"
PEM_KEY="/Users/vincent/propertydemo/smartprop-new-key.pem"
IMAGE_NAME="smartprop"
CONTAINER_NAME="smartprop-app"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🐳 Building Docker image for SmartProp...${NC}"

# Build the Docker image
docker build -t ${IMAGE_NAME}:latest .

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker image built successfully${NC}"

# Save the image to a tar file
echo -e "${BLUE}📦 Saving Docker image to tar file...${NC}"
docker save ${IMAGE_NAME}:latest | gzip > ${IMAGE_NAME}.tar.gz

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to save Docker image${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker image saved to ${IMAGE_NAME}.tar.gz${NC}"

# Copy the image to EC2
echo -e "${BLUE}📤 Copying Docker image to EC2 (${EC2_IP})...${NC}"
scp -i ${PEM_KEY} \
    -o StrictHostKeyChecking=no \
    ${IMAGE_NAME}.tar.gz \
    ${EC2_USER}@${EC2_IP}:/tmp/

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to copy image to EC2${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker image copied to EC2${NC}"

# Load the image on EC2 and deploy
echo -e "${BLUE}🚀 Loading image and deploying on EC2...${NC}"
ssh -i ${PEM_KEY} \
    -o StrictHostKeyChecking=no \
    ${EC2_USER}@${EC2_IP} << 'ENDSSH'
set -e

IMAGE_NAME="smartprop"
CONTAINER_NAME="smartprop-app"

# Load the Docker image
echo "Loading Docker image..."
docker load < /tmp/${IMAGE_NAME}.tar.gz

# Stop and remove existing container if it exists
if [ "$(docker ps -aq -f name=${CONTAINER_NAME})" ]; then
    echo "Stopping existing container..."
    docker stop ${CONTAINER_NAME} || true
    docker rm ${CONTAINER_NAME} || true
fi

# Create necessary directories
sudo mkdir -p /opt/smartprop/{storage,logs,waha-sessions,waha-files}
sudo chown -R $USER:$USER /opt/smartprop

# Run the new container
echo "Starting new container..."
docker run -d \
    --name ${CONTAINER_NAME} \
    --restart unless-stopped \
    -p 3000:3000 \
    -v /opt/smartprop/storage:/app/storage \
    -v /opt/smartprop/logs:/app/logs \
    --env-file /opt/smartprop/.env \
    ${IMAGE_NAME}:latest

# Clean up
rm -f /tmp/${IMAGE_NAME}.tar.gz

echo "✅ Deployment complete!"
echo "Container status:"
docker ps -f name=${CONTAINER_NAME}

echo ""
echo "To view logs: docker logs -f ${CONTAINER_NAME}"
echo "To check health: curl http://localhost:3000/api/health"
ENDSSH

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi

# Clean up local tar file
rm -f ${IMAGE_NAME}.tar.gz

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${BLUE}📝 Next steps:${NC}"
echo -e "  - Check logs: ssh -i ${PEM_KEY} ${EC2_USER}@${EC2_IP} 'docker logs -f ${CONTAINER_NAME}'"
echo -e "  - Check health: ssh -i ${PEM_KEY} ${EC2_USER}@${EC2_IP} 'curl http://localhost:3000/api/health'"
echo -e "  - Access app: http://<NEW_VPS_HOST>:3000"

