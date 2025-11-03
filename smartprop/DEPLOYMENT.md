# SmartProp Production Deployment Guide

## 🚀 Quick Start

```bash
# 1. Configure environment
cp .env.production .env.local
# Edit .env.local with your production values

# 2. Deploy
./deploy.sh

# 3. Monitor
./deploy.sh status
```

## 📋 Prerequisites

### System Requirements
- **OS**: Linux (Ubuntu 20.04+ recommended) or macOS
- **Docker**: 20.10+ with Docker Compose v2
- **Memory**: Minimum 4GB RAM (8GB+ recommended)
- **Storage**: Minimum 20GB free space
- **Network**: Ports 80, 443, 3000, 3030 available

### External Services
- **Supabase**: Database and authentication
- **GROQ**: AI/LLM processing
- **WhatsApp Business API**: Message handling
- **Domain**: For SSL certificates (production)

## 🔧 Configuration

### 1. Environment Setup

Copy the production template:
```bash
cp .env.production .env.local
```

Configure required variables in `.env.local`:

#### Core Application
```env
# Application
NODE_ENV=production
PUBLIC_BASE_URL=https://your-domain.com
NEXT_PUBLIC_APP_URL=https://your-domain.com

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE=your-service-role-key

# AI/LLM
GROQ_API_KEY=your-groq-api-key
```

#### WhatsApp Integration
```env
# WAHA (WhatsApp HTTP API)
WAHA_URL=http://waha:3000
WAHA_API_KEY=your-waha-api-key
WAHA_SESSION_NAME=smartprop
```

#### Security & Performance
```env
# Security
NEXTAUTH_SECRET=your-nextauth-secret
JWT_SECRET=your-jwt-secret

# Rate Limiting
RATE_LIMIT_REQUESTS_PER_MINUTE=100
RATE_LIMIT_WINDOW_MS=60000

# Performance
DATABASE_POOL_SIZE=20
```

### 2. SSL Certificates (Production)

For production with custom domain:

```bash
# Using Let's Encrypt with Certbot
sudo certbot --nginx -d your-domain.com

# Or place certificates in:
# nginx/ssl/cert.pem
# nginx/ssl/key.pem
```

## 🐳 Deployment

### Automated Deployment

Use the deployment script for full automation:

```bash
# Full deployment with health checks
./deploy.sh

# Check status
./deploy.sh status

# View logs
./deploy.sh logs

# View specific service logs
./deploy.sh logs smartprop-app
```

### Manual Deployment

If you prefer manual control:

```bash
# 1. Build images
docker-compose -f docker-compose.prod.yml build

# 2. Start services
docker-compose -f docker-compose.prod.yml up -d

# 3. Check health
curl http://localhost:3000/api/health
```

## 🔍 Health Checks & Monitoring

### Application Health
```bash
# Health endpoint
curl http://localhost:3000/api/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "services": {
    "database": "healthy",
    "waha": "healthy"
  }
}
```

### Service Status
```bash
# Container status
docker-compose -f docker-compose.prod.yml ps

# Resource usage
docker stats

# Logs
docker-compose -f docker-compose.prod.yml logs -f
```

### Application URLs
- **Application**: http://localhost:3000
- **WAHA Dashboard**: http://localhost:3030

## 🛠 Maintenance

### Backup & Restore

```bash
# Create backup
./deploy.sh backup

# Backups are stored in ./backups/
# - backup_YYYYMMDD_HHMMSS_config.tar.gz (configuration)
# - backup_YYYYMMDD_HHMMSS_app-storage.tar.gz (app data)
# - backup_YYYYMMDD_HHMMSS_waha-sessions.tar.gz (WhatsApp sessions)
```

### Updates

```bash
# Pull latest images and restart
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

# Or use deployment script (includes health checks)
./deploy.sh
```

### Scaling

```bash
# Scale application instances
docker-compose -f docker-compose.prod.yml up -d --scale smartprop-app=3

# Update Nginx upstream in nginx/conf.d/smartprop.conf
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Application Won't Start
```bash
# Check logs
./deploy.sh logs smartprop-app

# Common causes:
# - Missing environment variables
# - Database connection issues
# - Port conflicts
```

#### 2. Database Connection Failed
```bash
# Verify Supabase credentials
curl -H "apikey: YOUR_ANON_KEY" \
     -H "Authorization: Bearer YOUR_SERVICE_ROLE" \
     "YOUR_SUPABASE_URL/rest/v1/listings?select=*&limit=1"

# Check network connectivity
docker exec smartprop-app ping your-supabase-host
```

#### 3. WhatsApp Integration Issues
```bash
# Check WAHA service
curl http://localhost:3030/api/sessions

# Restart WAHA
docker-compose -f docker-compose.prod.yml restart smartprop-waha
```

#### 4. High Memory Usage
```bash
# Check resource usage
docker stats

# Adjust memory limits in docker-compose.prod.yml
# Increase swap if needed
```

### Log Analysis

```bash
# Application errors
./deploy.sh logs smartprop-app | grep ERROR

# Database queries
./deploy.sh logs smartprop-app | grep "supabase"

# WhatsApp messages
./deploy.sh logs smartprop-waha | grep "message"

# Nginx access logs
./deploy.sh logs smartprop-nginx | grep "GET\|POST"
```

## 🔒 Security Checklist

- [ ] Environment variables secured (no secrets in code)
- [ ] SSL certificates configured
- [ ] Rate limiting enabled
- [ ] Security headers configured
- [ ] Database access restricted
- [ ] Regular backups scheduled
- [ ] Log retention policies set

## 📊 Performance Optimization

### Database
- Connection pooling configured (20 connections)
- Query optimization via Supabase dashboard
- Regular VACUUM and ANALYZE (handled by Supabase)

### Application
- Next.js production build optimizations
- Gzip compression enabled
- Static asset caching

### Infrastructure
- Nginx reverse proxy with caching
- Docker multi-stage builds for smaller images
- Resource limits to prevent memory leaks

## 🔄 CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to server
        run: |
          ssh user@server 'cd /app && git pull && ./deploy.sh'
```

### Automated Testing

```bash
# Run core readiness tests
bun run test-core-readiness.ts

# Run full production tests (includes build)
bun run test-production-readiness.ts
```

## 📞 Support

### Logs Location
- Application: `/var/log/smartprop/`
- Nginx: `/var/log/nginx/`
- Docker: `docker logs <container>`

### Key Metrics to Monitor
- Response time (< 500ms target)
- Error rate (< 1% target)
- Memory usage (< 80% of allocated)
- Database connections (< 80% of pool)
- WhatsApp message delivery rate

### Emergency Procedures

#### Rollback
```bash
# Automatic rollback on deployment failure
# Manual rollback to previous version
docker-compose -f docker-compose.prod.yml down
# Restore from backup
tar xzf backups/latest_config.tar.gz
docker-compose -f docker-compose.prod.yml up -d
```

#### Scale Down (High Load)
```bash
# Temporarily disable non-essential features
# Scale up application instances
docker-compose -f docker-compose.prod.yml up -d --scale smartprop-app=5
```

---

## 📝 Deployment Checklist

### Pre-Deployment
- [ ] Environment variables configured
- [ ] SSL certificates ready
- [ ] Database accessible
- [ ] External services configured
- [ ] Backup created

### Post-Deployment
- [ ] Health checks passing
- [ ] All services running
- [ ] Logs flowing correctly
- [ ] Performance metrics normal
- [ ] User acceptance testing

### Production Readiness
- [ ] Core systems: 100% ✅
- [ ] Security configured ✅
- [ ] Backups automated ✅
- [ ] Documentation complete ✅

**Status: PRODUCTION READY** 🚀