#!/bin/bash
# EC2 Setup Script for SmartProp Production Deployment
# Run this script on a fresh Ubuntu 22.04 EC2 instance (t3.medium)

set -e

# Ensure ownership and services run under the invoking sudo user (e.g., ubuntu)
APP_USER="${SUDO_USER:-$USER}"

echo "🚀 Starting SmartProp EC2 Setup..."

# Update system
sudo apt update && sudo apt upgrade -y

# Install essential packages
sudo apt install -y \
    curl \
    wget \
    git \
    unzip \
    htop \
    nginx \
    certbot \
    python3-certbot-nginx \
    fail2ban \
    ufw

# Install Docker
echo "📦 Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker "$APP_USER"

# Install Docker Compose
echo "📦 Installing Docker Compose..."
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Bun (for local scripts if needed)
echo "📦 Installing Bun..."
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Create application directory
sudo mkdir -p /opt/smartprop
sudo chown "$APP_USER":"$APP_USER" /opt/smartprop

# Setup firewall
echo "🔒 Configuring firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable

# Configure fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Create swap file (idempotent)
echo "💾 Ensuring swap file..."
if ! swapon --show | grep -q '/swapfile'; then
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
  fi
  sudo swapon /swapfile
else
  echo "Swap already active, skipping creation."
fi
if ! grep -q '^/swapfile ' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# Create directories for application
mkdir -p /opt/smartprop/{app,nginx,ssl,logs,backups}
sudo chown -R "$APP_USER":"$APP_USER" /opt/smartprop

# Set up log rotation
sudo tee /etc/logrotate.d/smartprop << EOF
/opt/smartprop/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 644 $APP_USER $APP_USER
}
EOF

# Install or update AWS CLI v2 (idempotent)
echo "☁️ Ensuring AWS CLI..."
if command -v aws >/dev/null 2>&1; then
  echo "AWS CLI already installed; skipping reinstall."
else
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
  unzip awscliv2.zip
  sudo ./aws/install || true
  rm -rf aws awscliv2.zip
fi

# Create systemd service for Docker Compose
sudo tee /etc/systemd/system/smartprop.service << EOF
[Unit]
Description=SmartProp Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/smartprop/app
ExecStart=/usr/local/bin/docker-compose -f docker-compose.prod.yml up -d
ExecStop=/usr/local/bin/docker-compose -f docker-compose.prod.yml down
TimeoutStartSec=0
User=$APP_USER
Group=$APP_USER

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable smartprop

echo "✅ EC2 setup completed!"
echo ""
echo "Next steps:"
echo "1. Clone your repository to /opt/smartprop/app"
echo "2. Configure environment variables"
echo "3. Run deployment script"
echo ""
echo "Reboot recommended to ensure all changes take effect:"
echo "sudo reboot"