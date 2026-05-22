# SmartProp AWS EC2 Deployment Guide

This guide will help you deploy SmartProp to AWS EC2 using Docker containers on a t3.medium instance.

## 🏗️ Architecture Overview

```
Internet → Route 53 → EC2 (t3.medium)
                      ├── Nginx (Reverse Proxy + SSL)
                      ├── SmartProp App (Next.js)
                      ├── WAHA (WhatsApp API)
                      ├── Background Worker
                      └── Supabase (External Database)
```

## 📋 Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** configured with your credentials
3. **Domain name** (for SSL certificates)
4. **Supabase project** already set up
5. **Groq API key** for AI features

## 🚀 Quick Deployment

### Step 1: Configure Environment

1. Copy the environment template:
   ```bash
   cp aws-deployment/.env.production.template .env.production
   ```

2. Edit `.env.production` with your actual values:
   - Supabase URL and keys
   - Domain name
   - API keys
   - Scraper credentials

### Step 2: Update Deployment Configuration

Edit `aws-deployment/deploy-to-ec2.js` and update:
- `CONFIG.domain` - Your domain name
- `CONFIG.repoUrl` - Your GitHub repository URL
- `CONFIG.region` - Your preferred AWS region

### Step 3: Run Deployment

```bash
cd smartprop
node aws-deployment/deploy-to-ec2.js
```

The script will:
- ✅ Create EC2 key pair
- ✅ Set up security group
- ✅ Launch t3.medium instance
- ✅ Install Docker and dependencies
- ✅ Deploy your application
- ✅ Configure Nginx reverse proxy

### Step 4: Configure DNS

Point your domain to the EC2 public IP address:
```
A Record: your-domain.com → [EC2_PUBLIC_IP]
```

### Step 5: Setup SSL Certificate

SSH into your server and run:
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP}
sudo certbot --nginx -d your-domain.com
```

## 🔧 Manual Deployment (Alternative)

If you prefer manual deployment:

### 1. Launch EC2 Instance

- **Instance Type**: t3.medium (4GB RAM, 2 vCPUs)
- **AMI**: Ubuntu 22.04 LTS
- **Security Group**: Allow ports 22, 80, 443
- **Storage**: 20GB GP3 (minimum)

### 2. Setup Server

```bash
# Copy and run setup script
scp -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no aws-deployment/ec2-setup.sh ec2-user@[EC2_IP]:~/
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ec2-user@[EC2_IP]
chmod +x setup.sh && sudo ./setup.sh
```

### 3. Deploy Application

```bash
# Clone repository
cd /opt/smartprop
git clone https://github.com/your-username/smartprop.git app
cd app

# Copy production files
cp ../docker-compose.ec2.yml docker-compose.prod.yml
cp ../.env.production .env

# Create directories
sudo mkdir -p /opt/smartprop/{storage,logs,waha-sessions,waha-files}
sudo chown -R $USER:$USER /opt/smartprop

# Deploy
docker-compose -f docker-compose.prod.yml up -d
```

## 📊 Resource Allocation (t3.medium)

| Service | Memory | CPU | Purpose |
|---------|--------|-----|---------|
| SmartProp App | 1.5GB | 1.2 vCPU | Main Next.js application |
| WAHA | 800MB | 0.6 vCPU | WhatsApp API service |
| Background Worker | 1GB | 0.8 vCPU | Scraping jobs |
| Nginx | 128MB | 0.2 vCPU | Reverse proxy |
| **System Reserve** | 572MB | 0.2 vCPU | OS and monitoring |

## 🔍 Monitoring & Maintenance

### Check Application Status
```bash
# Container status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f smartprop-app
docker-compose -f docker-compose.prod.yml logs -f waha

# System resources
htop
df -h
```

### Update Application
```bash
cd /opt/smartprop/app
git pull
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

### Backup Important Data
```bash
# Backup WAHA sessions
tar -czf waha-backup-$(date +%Y%m%d).tar.gz /opt/smartprop/waha-sessions

# Backup application storage
tar -czf storage-backup-$(date +%Y%m%d).tar.gz /opt/smartprop/storage
```

## 🔐 Security Features

- **Firewall**: UFW configured with minimal ports
- **Fail2ban**: Protection against brute force attacks
- **SSL/TLS**: Let's Encrypt certificates
- **Rate Limiting**: Nginx rate limiting for API endpoints
- **Security Headers**: HSTS, XSS protection, etc.
- **Non-root Containers**: All containers run as non-root users

## 🌐 Accessing Services

After deployment:

- **Main Application**: `https://your-domain.com`
- **WAHA Dashboard**: `https://your-domain.com/waha/`
- **Health Check**: `https://your-domain.com/health`

## 💰 Cost Estimation

**Monthly AWS costs (ap-southeast-1):**
- t3.medium instance: ~$30-35/month
- 20GB GP3 storage: ~$2/month
- Data transfer: ~$5-10/month (varies by usage)
- **Total**: ~$37-47/month

## 🚨 Troubleshooting

### Common Issues

1. **Container won't start**
   ```bash
   docker-compose -f docker-compose.prod.yml logs [service-name]
   ```

2. **Out of memory**
   ```bash
   free -h
   # Consider upgrading to t3.large if needed
   ```

3. **SSL certificate issues**
   ```bash
   sudo certbot renew --dry-run
   sudo nginx -t
   ```

4. **WAHA connection issues**
   - Check if WhatsApp session is active
   - Verify webhook URL in WAHA dashboard
   - Check firewall rules

### Log Locations

- **Application logs**: `/opt/smartprop/logs/`
- **Nginx logs**: `/var/log/nginx/`
- **Docker logs**: `docker-compose logs`
- **System logs**: `/var/log/syslog`

## 📞 Support

For deployment issues:
1. Check the logs first
2. Verify environment variables
3. Ensure all services are running
4. Check network connectivity

## 🔄 Scaling Options

When you need more resources:

1. **Vertical Scaling**: Upgrade to t3.large or t3.xlarge
2. **Horizontal Scaling**: Use Application Load Balancer + Auto Scaling
3. **Database**: Consider RDS for PostgreSQL instead of Supabase
4. **CDN**: Add CloudFront for static assets
5. **Monitoring**: Add CloudWatch for detailed metrics