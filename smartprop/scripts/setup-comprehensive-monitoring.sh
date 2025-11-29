#!/bin/bash
# Comprehensive monitoring and auto-recovery setup for all systems

EC2_IP="52.76.114.103"
EC2_USER="ec2-user"
PEM_KEY="/Users/vincent/propertydemo/smartprop-new-key.pem"

echo "🔧 Setting up comprehensive monitoring and auto-recovery..."
echo ""

ssh -i ${PEM_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_IP} << 'ENDSSH'
set -e

cd /opt/smartprop/app/smartprop

# 1. Ensure PM2 startup is configured
echo "1. 📦 Configuring PM2 startup on boot..."
if ! systemctl list-unit-files | grep -q "pm2-ec2-user.service"; then
    echo "   Setting up PM2 startup..."
    pm2 startup systemd -u ec2-user --hp /home/ec2-user | grep "sudo" | bash || true
    pm2 save
    echo "   ✅ PM2 startup configured"
else
    echo "   ✅ PM2 startup already configured"
    # Ensure it's enabled
    sudo systemctl enable pm2-ec2-user.service 2>/dev/null || true
fi
echo ""

# 2. Create comprehensive health check script
echo "2. 📝 Creating comprehensive health check script..."
sudo tee /usr/local/bin/check-all-systems.sh > /dev/null << 'HEALTHCHECK'
#!/bin/bash
# Comprehensive health check for all systems

LOG_FILE="/opt/smartprop/logs/system-health.log"
MAX_LOG_SIZE=10485760  # 10MB

# Rotate log if too large
if [ -f "$LOG_FILE" ] && [ $(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) -gt $MAX_LOG_SIZE ]; then
    mv "$LOG_FILE" "${LOG_FILE}.old"
fi

log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Check PM2 processes
check_pm2() {
    if ! command -v pm2 &> /dev/null; then
        log "ERROR" "PM2 not found"
        return 1
    fi
    
    local smartprop_status=$(pm2 jlist 2>/dev/null | grep -o '"name":"smartprop"[^}]*"pm2_env":{"status":"[^"]*"' | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    local worker_status=$(pm2 jlist 2>/dev/null | grep -o '"name":"scraper-worker"[^}]*"pm2_env":{"status":"[^"]*"' | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    
    if [ "$smartprop_status" != "online" ]; then
        log "ERROR" "PM2 smartprop is not online (status: $smartprop_status)"
        pm2 restart smartprop
        return 1
    fi
    
    if [ "$worker_status" != "online" ]; then
        log "ERROR" "PM2 scraper-worker is not online (status: $worker_status)"
        pm2 restart scraper-worker
        return 1
    fi
    
    log "INFO" "PM2 processes healthy (smartprop: $smartprop_status, worker: $worker_status)"
    return 0
}

# Check Docker containers
check_docker() {
    if ! command -v docker &> /dev/null; then
        log "ERROR" "Docker not found"
        return 1
    fi
    
    # Check FlareSolverr
    if ! docker ps --format '{{.Names}}' | grep -q "^flaresolverr$"; then
        log "ERROR" "FlareSolverr container is not running"
        docker start flaresolverr 2>/dev/null || log "ERROR" "Failed to start FlareSolverr"
        return 1
    fi
    
    # Check WAHA
    if ! docker ps --format '{{.Names}}' | grep -q "^smartprop-waha$"; then
        log "ERROR" "WAHA container is not running"
        docker start smartprop-waha 2>/dev/null || log "ERROR" "Failed to start WAHA"
        return 1
    fi
    
    log "INFO" "Docker containers healthy"
    return 0
}

# Check application health
check_app_health() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo "000")
    if [ "$response" != "200" ]; then
        log "WARN" "Application health check failed (HTTP $response)"
        return 1
    fi
    log "INFO" "Application health check passed"
    return 0
}

# Main check
main() {
    log "INFO" "Starting comprehensive health check..."
    
    local errors=0
    
    check_pm2 || ((errors++))
    check_docker || ((errors++))
    check_app_health || ((errors++))
    
    if [ $errors -eq 0 ]; then
        log "INFO" "All systems healthy"
        exit 0
    else
        log "ERROR" "Health check found $errors issue(s)"
        exit 1
    fi
}

main "$@"
HEALTHCHECK

sudo chmod +x /usr/local/bin/check-all-systems.sh
echo "   ✅ Health check script created"
echo ""

# 3. Create systemd service for comprehensive monitoring
echo "3. ⏰ Creating systemd service for comprehensive monitoring..."
sudo tee /etc/systemd/system/system-health-monitor.service > /dev/null << 'EOF'
[Unit]
Description=Comprehensive System Health Monitor
After=network.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/check-all-systems.sh
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Create timer
sudo tee /etc/systemd/system/system-health-monitor.timer > /dev/null << 'EOF'
[Unit]
Description=Run comprehensive health check every 5 minutes
Requires=system-health-monitor.service

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable system-health-monitor.timer
sudo systemctl start system-health-monitor.timer

echo "   ✅ Comprehensive monitoring timer created and enabled"
echo ""

# 4. Verify all monitoring is active
echo "4. ✅ Verifying all monitoring systems..."
echo ""
echo "   FlareSolverr monitoring:"
sudo systemctl is-active flaresolverr-monitor.timer && echo "      ✅ ACTIVE" || echo "      ❌ INACTIVE"
echo ""
echo "   System health monitoring:"
sudo systemctl is-active system-health-monitor.timer && echo "      ✅ ACTIVE" || echo "      ❌ INACTIVE"
echo ""
echo "   PM2 startup:"
systemctl is-enabled pm2-ec2-user.service 2>/dev/null && echo "      ✅ ENABLED" || echo "      ⚠️  Check manually: pm2 startup"
echo ""

echo "✅ Comprehensive monitoring setup complete!"
echo ""
echo "📊 Monitoring Summary:"
echo "   - FlareSolverr: Every 2 minutes (auto-restart on failure)"
echo "   - All Systems: Every 5 minutes (PM2, Docker, App health)"
echo "   - PM2: Auto-restart on failure (built-in)"
echo "   - Docker: Auto-restart on failure (restart policies)"
echo "   - Boot: PM2 processes start automatically"
echo ""
echo "📝 Logs:"
echo "   - FlareSolverr: /opt/smartprop/logs/flaresolverr-monitor.log"
echo "   - System Health: /opt/smartprop/logs/system-health.log"
ENDSSH

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Comprehensive monitoring successfully installed!"
else
    echo "❌ Setup failed"
    exit 1
fi

