# Docker Registry Deployment Guide

You're absolutely right that building on the server is inefficient! Here are three better approaches:

## Option 1: Docker Hub (Recommended)

### Setup (One-time)
```bash
# 1. Create Docker Hub account at hub.docker.com
# 2. Login locally
docker login

# 3. Update docker-compose.ec2.yml with your username
# Replace "vincentlim" with your Docker Hub username
```

### Deploy Workflow
```bash
# Build locally (much faster)
docker build -t smartprop:latest .

# Tag and push
docker tag smartprop:latest YOUR_USERNAME/smartprop:latest
docker push YOUR_USERNAME/smartprop:latest

# Deploy to EC2 (pulls pre-built image)
./build-and-deploy.sh
```

## Option 2: GitHub Container Registry (No extra signup)

### Setup
```bash
# 1. Create GitHub Personal Access Token with packages:write permission
# 2. Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

### Update docker-compose.ec2.yml
```yaml
smartprop-app:
  image: ghcr.io/YOUR_GITHUB_USERNAME/smartprop:latest
```

## Option 3: AWS ECR (Most integrated with AWS)

### Setup
```bash
# 1. Create ECR repository
aws ecr create-repository --repository-name smartprop --region ap-southeast-1

# 2. Get login token
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com
```

## Benefits of Registry Approach

✅ **10x Faster Deployments**: Download vs build
✅ **Resource Efficient**: No build load on production servers  
✅ **Consistent**: Same image across environments
✅ **Scalable**: Deploy to multiple servers instantly
✅ **Reliable**: Build once, deploy many times
✅ **CI/CD Ready**: Perfect for automation

## Current Status

- ✅ Docker image building locally (much faster than EC2)
- ✅ Updated docker-compose.ec2.yml to use registry image
- ⏳ Waiting for local build to complete
- 📋 Ready to push and deploy

Choose your preferred registry and I'll help you complete the setup!