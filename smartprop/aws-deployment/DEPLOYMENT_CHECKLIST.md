# 🚀 SmartProp AWS EC2 Deployment Checklist

Use this checklist to ensure a smooth deployment of your SmartProp application to AWS EC2.

## ✅ Pre-Deployment Checklist

### 1. Prerequisites Verification
- [ ] **AWS Account** with appropriate permissions
- [ ] **AWS CLI** installed and configured with `new-profile`
- [ ] **Docker** and **Docker Compose** installed locally
- [ ] **Domain name** registered and ready for DNS configuration
- [ ] **Supabase project** set up and accessible
- [ ] **Groq API key** obtained for AI features

### 2. Configuration Setup
- [ ] **Environment Variables**: Copy `.env.production.template` to `.env.production`
- [ ] **Fill in all required values** in `.env.production`:
  - [ ] `NEXT_PUBLIC_SUPABASE_URL`
  - [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - [ ] `SUPABASE_SERVICE_ROLE`
  - [ ] `PUBLIC_BASE_URL` (your domain)
  - [ ] `WAHA_DASHBOARD_PASSWORD`
  - [ ] `GROQ_API_KEY`
  - [ ] Property scraper credentials (PG_EMAIL, PG_PASSWORD, etc.)

### 3. Deployment Script Configuration
- [ ] **Update repository URL** in `aws-deployment/deploy-to-ec2.js`
- [ ] **Set domain name**: `export DOMAIN=your-domain.com`
- [ ] **Verify AWS region** is set to `ap-southeast-1` (or your preferred region)

### 4. Run Pre-Deployment Tests
```bash
node aws-deployment/test-deployment.js
```
- [ ] **All tests pass** (9/9)
- [ ] **No critical errors** reported
- [ ] **Address any warnings** if necessary

## 🚀 Deployment Process

### Step 1: Automated Deployment
```bash
# Set your domain (replace with your actual domain)
export DOMAIN=your-domain.com

# Run the deployment script
node aws-deployment/deploy-to-ec2.js
```

**Expected outcomes:**
- [ ] EC2 key pair created (`smartprop-key.pem`)
- [ ] Security group configured
 - [ ] t3.small instance launched
- [ ] Docker and dependencies installed
- [ ] Application deployed and running

Note: The deployment script is idempotent. If an instance tagged `Name=smartprop-server` already exists, it reuses that instance instead of launching a new one. To clean up duplicates automatically, set `CLEANUP_DUPLICATES=true` before running the script.

### Step 2: DNS Configuration
- [ ] **Point your domain** to the EC2 public IP address
- [ ] **Create A record**: `your-domain.com → [EC2_PUBLIC_IP]`
- [ ] **Wait for DNS propagation** (5-30 minutes)

### Step 3: SSL Certificate Setup
```bash
# SSH into your server
ssh -i smartprop-key.pem ubuntu@[EC2_PUBLIC_IP]

# Install SSL certificate
sudo certbot --nginx -d your-domain.com
```
- [ ] **SSL certificate installed** successfully
- [ ] **HTTPS redirect** working
- [ ] **Certificate auto-renewal** configured

### Step 4: Application Verification
- [ ] **Main application** accessible at `https://your-domain.com`
- [ ] **WAHA dashboard** accessible at `https://your-domain.com/waha/`
- [ ] **Health check** returns 200 at `https://your-domain.com/health`
- [ ] **WhatsApp integration** working (scan QR code in WAHA dashboard)

## 📊 Post-Deployment Verification

### 1. Service Status Check
```bash
# SSH into server
ssh -i smartprop-key.pem ubuntu@[EC2_PUBLIC_IP]

# Check all containers are running
docker-compose -f /opt/smartprop/app/docker-compose.prod.yml ps

# View monitoring dashboard
/opt/monitoring/scripts/dashboard.sh
```

### 2. Application Health
- [ ] **SmartProp app** container running and healthy
- [ ] **WAHA** container running and healthy
- [ ] **Background worker** container running
- [ ] **Nginx** container running and serving traffic

### 3. Monitoring Setup
- [ ] **System monitoring** active (check `/opt/monitoring/logs/`)
- [ ] **Application monitoring** active
- [ ] **Log rotation** configured
- [ ] **Basic alerting** set up

### 4. Security Verification
- [ ] **Firewall (UFW)** active with correct rules
- [ ] **Fail2ban** installed and configured
- [ ] **SSL/TLS** certificate valid and auto-renewing
- [ ] **Security headers** configured in Nginx
- [ ] **Rate limiting** active for API endpoints

## 🔧 Troubleshooting Common Issues

### Issue: Container won't start
```bash
# Check container logs
docker-compose -f docker-compose.prod.yml logs [service-name]

# Check system resources
free -h
df -h
```

### Issue: SSL certificate fails
```bash
# Check Nginx configuration
sudo nginx -t

# Verify domain points to server
nslookup your-domain.com

# Check port 80 is accessible
curl -I http://your-domain.com
```

### Issue: WAHA connection problems
- [ ] Check WhatsApp session status in dashboard
- [ ] Verify webhook URL configuration
- [ ] Check container logs for WAHA service

### Issue: High resource usage
```bash
# Monitor resources
htop
docker stats

# Check for memory leaks
docker-compose -f docker-compose.prod.yml logs | grep -i "memory\|oom"
```

## 📈 Performance Optimization

### After Initial Deployment
- [ ] **Monitor resource usage** for first 24-48 hours
- [ ] **Adjust container limits** if needed
- [ ] **Set up CloudWatch** for detailed monitoring (optional)
- [ ] **Configure log aggregation** (optional)
- [ ] **Set up automated backups** for important data

### Scaling Considerations
- [ ] **Vertical scaling**: Upgrade to t3.large if needed
- [ ] **Horizontal scaling**: Consider load balancer for multiple instances
- [ ] **Database optimization**: Monitor Supabase performance
- [ ] **CDN setup**: Add CloudFront for static assets (optional)

## 🔄 Maintenance Tasks

### Daily
- [ ] Check application health via monitoring dashboard
- [ ] Review error logs for any issues

### Weekly
- [ ] Review system resource usage
- [ ] Check SSL certificate status
- [ ] Update application if needed

### Monthly
- [ ] Review and rotate logs
- [ ] Update system packages
- [ ] Review AWS costs and usage
- [ ] Backup important configuration files

## 📞 Emergency Contacts & Resources

### Important Files Locations
- **Application**: `/opt/smartprop/app/`
- **Logs**: `/opt/smartprop/logs/` and `/opt/monitoring/logs/`
- **Configuration**: `/opt/smartprop/app/.env`
- **SSL Certificates**: `/etc/letsencrypt/`

### Useful Commands
```bash
# Restart all services
docker-compose -f docker-compose.prod.yml restart

# View real-time logs
docker-compose -f docker-compose.prod.yml logs -f

# Check system status
systemctl status docker
systemctl status nginx

# Emergency stop
docker-compose -f docker-compose.prod.yml down
```

### Support Resources
- **AWS Documentation**: https://docs.aws.amazon.com/
- **Docker Documentation**: https://docs.docker.com/
- **Supabase Documentation**: https://supabase.com/docs
- **Let's Encrypt**: https://letsencrypt.org/docs/

---

## ✅ Deployment Complete!

Once all items in this checklist are completed, your SmartProp application should be:
- ✅ Running securely on AWS EC2
- ✅ Accessible via HTTPS with valid SSL
- ✅ Monitored and logging properly
- ✅ Ready for production use

**Estimated total deployment time**: 30-60 minutes (depending on DNS propagation)