# Step-by-Step EC2 Deployment Guide

Run these commands one at a time. Wait for each to complete before running the next.

## Step 1: Install Git on EC2
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "sudo dnf install -y git"
```

## Step 2: Install Bun on EC2
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "curl -fsSL https://bun.sh/install | bash"
```

## Step 3: Install Node.js on EC2
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo dnf install -y nodejs"
```

## Step 4: Install PM2 on EC2
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "sudo npm install -g pm2"
```

## Step 5: Create app directory on EC2
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "sudo mkdir -p /opt/smartprop && sudo chown -R ec2-user:ec2-user /opt/smartprop && mkdir -p /opt/smartprop/storage /opt/smartprop/logs"
```

## Step 6: Copy environment file to EC2
```bash
scp -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no .env.local ${EC2_USER:-ec2-user}@${EC2_IP}:/tmp/.env.local
```

## Step 7: Clone repository on EC2
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "cd /opt/smartprop && git clone https://github.com/teazle/amataproperty.git app"
```

## Step 8: Copy environment file to app directory
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "cp /tmp/.env.local /opt/smartprop/app/smartprop/.env.local"
```

## Step 9: Install dependencies
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "cd /opt/smartprop/app/smartprop && export PATH=\$HOME/.bun/bin:\$PATH && bun install --frozen-lockfile"
```

## Step 10: Build the application
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "cd /opt/smartprop/app/smartprop && export PATH=\$HOME/.bun/bin:\$PATH && NODE_ENV=production bunx next build"
```

## Step 11: Start with PM2
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "cd /opt/smartprop/app/smartprop && export PATH=\$HOME/.bun/bin:\$PATH && PORT=3000 NODE_ENV=production pm2 start bun --name smartprop -- start"
```

## Step 12: Save PM2 configuration
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "pm2 save"
```

## Step 13: Check status
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "pm2 status"
```

## Step 14: Test the application
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "curl http://localhost:3000/api/health"
```

---

## Quick Commands for Later

**View logs:**
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "pm2 logs smartprop"
```

**Restart app:**
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "pm2 restart smartprop"
```

**Update code (pull latest):**
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ${EC2_USER:-ec2-user}@${EC2_IP} "cd /opt/smartprop/app && git pull && cd smartprop && export PATH=\$HOME/.bun/bin:\$PATH && bun install && bunx next build && pm2 restart smartprop"
```

