#!/bin/bash
set -e

# Configuration
EC2_IP="18.142.253.142"
EC2_USER="ec2-user"
PEM_KEY="/Users/vincent/propertydemo/smartprop-new-key.pem"
# Git repository URL
REPO_URL="https://github.com/teazle/amataproperty.git"
APP_DIR="/opt/smartprop"
BRANCH="main"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Deploying SmartProp to EC2 (${EC2_IP})...${NC}"

# Step 1: Setup EC2 environment (first time only)
echo -e "${BLUE}📦 Setting up EC2 environment...${NC}"
ssh -i ${PEM_KEY} \
    -o StrictHostKeyChecking=no \
    ${EC2_USER}@${EC2_IP} << 'ENDSSH'
set -e

# Install Git if not already installed
if ! command -v git &> /dev/null; then
    echo "Installing Git..."
    sudo dnf install -y git
fi

# Install Bun if not already installed
if ! command -v bun &> /dev/null; then
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Install Node.js (for Next.js standalone output)
# Amazon Linux 2023 uses dnf, not apt-get
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    # Use NodeSource for Amazon Linux
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo dnf install -y nodejs
fi

# Install PM2 for process management
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    sudo npm install -g pm2
fi

# Install Nginx if not already installed
if ! command -v nginx &> /dev/null; then
    echo "Installing Nginx..."
    sudo dnf install -y nginx
    sudo systemctl enable nginx
fi

# Create app directory
sudo mkdir -p /opt/smartprop
sudo chown -R $USER:$USER /opt/smartprop

# Create necessary directories
mkdir -p /opt/smartprop/{storage,logs}

# Setup Nginx configuration (ensure http block exists)
if [ -f /opt/smartprop/app/smartprop/scripts/setup-nginx-ec2.sh ]; then
    echo "Setting up Nginx configuration..."
    bash /opt/smartprop/app/smartprop/scripts/setup-nginx-ec2.sh
elif [ -f app/smartprop/scripts/setup-nginx-ec2.sh ]; then
    echo "Setting up Nginx configuration..."
    bash app/smartprop/scripts/setup-nginx-ec2.sh
else
    echo "⚠️  Nginx setup script not found, ensuring http block exists..."
    # Quick fix: ensure http block exists in nginx.conf
    if ! grep -q "^http {" /etc/nginx/nginx.conf 2>/dev/null; then
        sudo tee -a /etc/nginx/nginx.conf > /dev/null << 'NGINX_HTTP_BLOCK'

http {
    log_format main '\$remote_addr - \$remote_user [\$time_local] "\$request" '
                    '\$status \$body_bytes_sent "\$http_referer" '
                    '"\$http_user_agent" "\$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    include /etc/nginx/conf.d/*.conf;
}
NGINX_HTTP_BLOCK
        sudo nginx -t && sudo systemctl restart nginx || true
    fi
fi

echo "✅ Environment setup complete"
ENDSSH

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Environment setup failed${NC}"
    exit 1
fi

# Step 2: Copy environment file and nginx config to EC2
if [ -f .env.local ]; then
    echo -e "${BLUE}📋 Copying environment file to EC2...${NC}"
    scp -i ${PEM_KEY} \
        -o StrictHostKeyChecking=no \
        .env.local \
        ${EC2_USER}@${EC2_IP}:/tmp/.env.local
    echo -e "${GREEN}✅ Environment file copied${NC}"
fi

# Copy nginx server config if it exists
if [ -f nginx-smartprop.conf ]; then
    echo -e "${BLUE}📋 Copying nginx config to EC2...${NC}"
    scp -i ${PEM_KEY} \
        -o StrictHostKeyChecking=no \
        nginx-smartprop.conf \
        ${EC2_USER}@${EC2_IP}:/tmp/smartprop.conf
    echo -e "${GREEN}✅ Nginx config copied${NC}"
fi

# Step 3: Deploy application
echo -e "${BLUE}📤 Deploying application...${NC}"
ssh -i ${PEM_KEY} \
    -o StrictHostKeyChecking=no \
    ${EC2_USER}@${EC2_IP} << ENDSSH
set -e

export PATH="\$HOME/.bun/bin:\$PATH"
cd ${APP_DIR}

# Clone or pull repository
if [ ! -d "app" ]; then
    echo "Cloning repository..."
    git clone ${REPO_URL} app
else
    echo "Updating repository..."
    cd app
    git fetch origin
    git reset --hard origin/${BRANCH}
    git pull origin ${BRANCH}
fi

# Navigate to smartprop directory (it's a subdirectory in the repo)
cd app/smartprop

# Copy environment file if it was uploaded
if [ -f /tmp/.env.local ]; then
    echo "Copying environment file..."
    cp /tmp/.env.local .env.local
    rm /tmp/.env.local
fi

# Copy nginx server config if it was uploaded
if [ -f /tmp/smartprop.conf ]; then
    echo "Copying nginx server config..."
    sudo cp /tmp/smartprop.conf /etc/nginx/conf.d/smartprop.conf
    sudo chmod 644 /etc/nginx/conf.d/smartprop.conf
    rm /tmp/smartprop.conf
    echo "✅ Nginx server config installed"
fi

# Install dependencies
echo "Installing dependencies with Bun..."
bun install --frozen-lockfile

# Build the application (without turbopack for production)
echo "Building application..."
NODE_ENV=production bunx next build

# Stop existing PM2 process if running
pm2 stop smartprop || true
pm2 delete smartprop || true

# Start application with PM2
echo "Starting application with PM2..."
PORT=3000 NODE_ENV=production pm2 start bun --name smartprop -- start
pm2 save
pm2 startup || true

echo "✅ Deployment complete!"
echo ""
echo "Application status:"
pm2 status

echo ""
echo "To view logs: pm2 logs smartprop"
echo "To restart: pm2 restart smartprop"
ENDSSH

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${BLUE}📝 Next steps:${NC}"
echo -e "  - View logs: ssh -i ${PEM_KEY} ${EC2_USER}@${EC2_IP} 'pm2 logs smartprop'"
echo -e "  - Check status: ssh -i ${PEM_KEY} ${EC2_USER}@${EC2_IP} 'pm2 status'"
echo -e "  - Restart app: ssh -i ${PEM_KEY} ${EC2_USER}@${EC2_IP} 'pm2 restart smartprop'"
echo -e "  - Access app: http://${EC2_IP}:3000"

