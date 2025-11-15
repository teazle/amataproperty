# SmartProp EC2 Deployment Guide

## Quick Deployment (Fastest Method)

Building directly on EC2 is **faster** than Docker because:
- ✅ Only source code is transferred (small, fast)
- ✅ No large Docker image transfer (500MB-1GB+)
- ✅ EC2 builds in parallel
- ✅ Simpler workflow

## Prerequisites

1. **Git Repository**: Make sure your code is in a Git repository (GitHub, GitLab, etc.)
2. **EC2 Access**: You have SSH access with the PEM key
3. **Environment Variables**: Prepare your `.env.local` file

## Deployment Steps

### Option 1: Using the Deployment Script (Recommended)

```bash
# Set your Git repository URL
export GIT_REPO_URL="https://github.com/your-username/your-repo.git"

# Run the deployment script
./deploy-ec2.sh
```

The script will:
1. ✅ Setup Bun, Node.js, and PM2 on EC2 (first time only)
2. ✅ Clone/pull your repository
3. ✅ Install dependencies with Bun
4. ✅ Build the application
5. ✅ Start with PM2 (auto-restart on reboot)

### Option 2: Manual Deployment

```bash
# 1. SSH into EC2
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ec2-user@52.76.114.103

# 2. Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# 3. Install Node.js (for Next.js standalone)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Install PM2
sudo npm install -g pm2

# 5. Clone repository
cd /opt
sudo mkdir -p smartprop
sudo chown -R $USER:$USER smartprop
cd smartprop
git clone https://github.com/your-username/your-repo.git app
cd app/smartprop  # or just app if repo root is smartprop

# 6. Install dependencies
bun install --frozen-lockfile

# 7. Copy environment file
# Upload your .env.local file or create it manually
nano .env.local

# 8. Build
NODE_ENV=production bunx next build

# 9. Start with PM2
PORT=3000 NODE_ENV=production pm2 start bun --name smartprop -- start
pm2 save
pm2 startup  # Follow instructions to enable auto-start
```

## Managing the Application

```bash
# View logs
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ec2-user@52.76.114.103 'pm2 logs smartprop'

# Check status
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ec2-user@52.76.114.103 'pm2 status'

# Restart
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ec2-user@52.76.114.103 'pm2 restart smartprop'

# Stop
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ec2-user@52.76.114.103 'pm2 stop smartprop'
```

## Environment Variables

Make sure to set these on EC2 (in `.env.local` or via PM2 environment):

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE=your_service_role
GROQ_API_KEY=your_groq_key
PUBLIC_BASE_URL=http://52.76.114.103:3000
# ... other variables
```

## Updating the Application

```bash
# Just run the deployment script again
./deploy-ec2.sh

# Or manually:
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ec2-user@52.76.114.103
cd /opt/smartprop/app
git pull
cd smartprop  # if needed
bun install
bunx next build
pm2 restart smartprop
```

## Accessing the Application

- **Application**: http://52.76.114.103:3000
- **Admin Dashboard**: http://52.76.114.103:3000/admin
- **Health Check**: http://52.76.114.103:3000/api/health

## Troubleshooting

### Build fails
- Check Node.js version: `node --version` (should be 20+)
- Check Bun version: `bun --version`
- Check disk space: `df -h`

### Application won't start
- Check logs: `pm2 logs smartprop`
- Check environment variables
- Check port 3000 is not in use: `lsof -i :3000`

### PM2 not persisting
- Run `pm2 startup` and follow instructions
- Check: `pm2 save`

## Comparison: Direct Build vs Docker

| Method | Speed | Complexity | Best For |
|--------|-------|------------|----------|
| **Direct Build** | ⚡ Faster | ✅ Simpler | Quick deployments, frequent updates |
| **Docker** | 🐢 Slower | ❌ More complex | Production consistency, CI/CD |

For your use case, **direct build is recommended** for speed! 🚀

