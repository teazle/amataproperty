#!/bin/bash

# SmartProp Monitoring Setup Script
# This script sets up basic monitoring for the SmartProp application on EC2

set -e

echo "🔍 Setting up monitoring for SmartProp..."

# Create monitoring directories
sudo mkdir -p /opt/monitoring/{scripts,logs,config}
sudo chown -R $USER:$USER /opt/monitoring

# Install monitoring tools
echo "📦 Installing monitoring tools..."
sudo apt-get update
sudo apt-get install -y htop iotop nethogs ncdu jq curl

# Create system monitoring script
cat > /opt/monitoring/scripts/system-monitor.sh << 'EOF'
#!/bin/bash

# System monitoring script for SmartProp
LOG_FILE="/opt/monitoring/logs/system-$(date +%Y%m%d).log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Function to log with timestamp
log_with_timestamp() {
    echo "[$TIMESTAMP] $1" >> "$LOG_FILE"
}

# System metrics
CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | awk -F'%' '{print $1}')
MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.1f", ($3/$2) * 100.0}')
DISK_USAGE=$(df -h / | awk 'NR==2{printf "%s", $5}' | sed 's/%//')
LOAD_AVG=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | sed 's/,//')

log_with_timestamp "SYSTEM - CPU: ${CPU_USAGE}%, Memory: ${MEMORY_USAGE}%, Disk: ${DISK_USAGE}%, Load: ${LOAD_AVG}"

# Docker container status
CONTAINERS=$(docker ps --format "table {{.Names}}\t{{.Status}}" | grep -v NAMES)
while IFS= read -r line; do
    if [[ ! -z "$line" ]]; then
        log_with_timestamp "CONTAINER - $line"
    fi
done <<< "$CONTAINERS"

# Application health checks
SMARTPROP_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health || echo "000")
WAHA_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3030/health || echo "000")

log_with_timestamp "HEALTH - SmartProp: ${SMARTPROP_HEALTH}, WAHA: ${WAHA_HEALTH}"

# Check for errors in application logs
ERROR_COUNT=$(docker-compose -f /opt/smartprop/app/docker-compose.prod.yml logs --since="5m" 2>/dev/null | grep -i error | wc -l)
log_with_timestamp "ERRORS - Last 5min: ${ERROR_COUNT}"

# Alert if critical thresholds are exceeded
if (( $(echo "$MEMORY_USAGE > 85" | bc -l) )); then
    log_with_timestamp "ALERT - High memory usage: ${MEMORY_USAGE}%"
fi

if (( $(echo "$CPU_USAGE > 80" | bc -l) )); then
    log_with_timestamp "ALERT - High CPU usage: ${CPU_USAGE}%"
fi

if [[ "$DISK_USAGE" -gt 85 ]]; then
    log_with_timestamp "ALERT - High disk usage: ${DISK_USAGE}%"
fi

if [[ "$SMARTPROP_HEALTH" != "200" ]]; then
    log_with_timestamp "ALERT - SmartProp health check failed: ${SMARTPROP_HEALTH}"
fi

if [[ "$WAHA_HEALTH" != "200" ]]; then
    log_with_timestamp "ALERT - WAHA health check failed: ${WAHA_HEALTH}"
fi
EOF

chmod +x /opt/monitoring/scripts/system-monitor.sh

# Create application monitoring script
cat > /opt/monitoring/scripts/app-monitor.sh << 'EOF'
#!/bin/bash

# Application-specific monitoring for SmartProp
LOG_FILE="/opt/monitoring/logs/app-$(date +%Y%m%d).log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
APP_DIR="/opt/smartprop/app"

# Function to log with timestamp
log_with_timestamp() {
    echo "[$TIMESTAMP] $1" >> "$LOG_FILE"
}

cd "$APP_DIR" || exit 1

# Check container resource usage
SMARTPROP_STATS=$(docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep smartprop-app || echo "smartprop-app	N/A	N/A")
WAHA_STATS=$(docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep waha || echo "waha	N/A	N/A")
WORKER_STATS=$(docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep worker || echo "worker	N/A	N/A")

log_with_timestamp "STATS - $SMARTPROP_STATS"
log_with_timestamp "STATS - $WAHA_STATS"
log_with_timestamp "STATS - $WORKER_STATS"

# Check for recent errors in application logs
RECENT_ERRORS=$(docker-compose -f docker-compose.prod.yml logs --since="10m" smartprop-app 2>/dev/null | grep -i "error\|exception\|failed" | tail -5)
if [[ ! -z "$RECENT_ERRORS" ]]; then
    log_with_timestamp "APP_ERRORS - Recent errors detected"
    echo "$RECENT_ERRORS" | while IFS= read -r line; do
        log_with_timestamp "ERROR_DETAIL - $line"
    done
fi

# Check WAHA session status
WAHA_SESSIONS=$(curl -s http://localhost:3030/api/sessions 2>/dev/null | jq -r '.[] | "\(.name): \(.status)"' 2>/dev/null || echo "Unable to fetch sessions")
log_with_timestamp "WAHA_SESSIONS - $WAHA_SESSIONS"

# Check disk space for application directories
STORAGE_USAGE=$(du -sh /opt/smartprop/storage 2>/dev/null | awk '{print $1}' || echo "N/A")
LOGS_USAGE=$(du -sh /opt/smartprop/logs 2>/dev/null | awk '{print $1}' || echo "N/A")
WAHA_USAGE=$(du -sh /opt/smartprop/waha-sessions 2>/dev/null | awk '{print $1}' || echo "N/A")

log_with_timestamp "DISK_USAGE - Storage: ${STORAGE_USAGE}, Logs: ${LOGS_USAGE}, WAHA: ${WAHA_USAGE}"
EOF

chmod +x /opt/monitoring/scripts/app-monitor.sh

# Create log rotation script
cat > /opt/monitoring/scripts/rotate-logs.sh << 'EOF'
#!/bin/bash

# Log rotation script for SmartProp monitoring
MONITORING_LOGS="/opt/monitoring/logs"
APP_LOGS="/opt/smartprop/logs"

# Keep only last 7 days of monitoring logs
find "$MONITORING_LOGS" -name "*.log" -type f -mtime +7 -delete

# Compress old application logs
find "$APP_LOGS" -name "*.log" -type f -mtime +1 -exec gzip {} \;
find "$APP_LOGS" -name "*.gz" -type f -mtime +30 -delete

# Rotate Docker logs if they get too large
docker system prune -f --volumes --filter "until=168h"

echo "$(date): Log rotation completed" >> "$MONITORING_LOGS/rotation.log"
EOF

chmod +x /opt/monitoring/scripts/rotate-logs.sh

# Create monitoring dashboard script
cat > /opt/monitoring/scripts/dashboard.sh << 'EOF'
#!/bin/bash

# Simple monitoring dashboard for SmartProp
clear

echo "🚀 SmartProp Monitoring Dashboard"
echo "=================================="
echo ""

# System info
echo "📊 System Overview:"
echo "  Uptime: $(uptime -p)"
echo "  Load: $(uptime | awk -F'load average:' '{print $2}')"
echo "  Memory: $(free -h | awk 'NR==2{printf "Used: %s/%s (%.1f%%)", $3,$2,($3/$2)*100}')"
echo "  Disk: $(df -h / | awk 'NR==2{printf "Used: %s/%s (%s)", $3,$2,$5}')"
echo ""

# Container status
echo "🐳 Container Status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "(smartprop|waha|nginx|worker)"
echo ""

# Recent logs
echo "📝 Recent Activity (last 10 entries):"
if [[ -f "/opt/monitoring/logs/system-$(date +%Y%m%d).log" ]]; then
    tail -10 "/opt/monitoring/logs/system-$(date +%Y%m%d).log"
else
    echo "  No monitoring logs found for today"
fi
echo ""

# Health checks
echo "🏥 Health Status:"
SMARTPROP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "000")
WAHA_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3030/health 2>/dev/null || echo "000")

if [[ "$SMARTPROP_STATUS" == "200" ]]; then
    echo "  ✅ SmartProp: Healthy"
else
    echo "  ❌ SmartProp: Unhealthy ($SMARTPROP_STATUS)"
fi

if [[ "$WAHA_STATUS" == "200" ]]; then
    echo "  ✅ WAHA: Healthy"
else
    echo "  ❌ WAHA: Unhealthy ($WAHA_STATUS)"
fi

echo ""
echo "Run 'watch -n 30 /opt/monitoring/scripts/dashboard.sh' for auto-refresh"
EOF

chmod +x /opt/monitoring/scripts/dashboard.sh

# Set up cron jobs for monitoring
echo "⏰ Setting up monitoring cron jobs..."

# Add cron jobs
(crontab -l 2>/dev/null; echo "# SmartProp Monitoring") | crontab -
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/monitoring/scripts/system-monitor.sh") | crontab -
(crontab -l 2>/dev/null; echo "*/10 * * * * /opt/monitoring/scripts/app-monitor.sh") | crontab -
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/monitoring/scripts/rotate-logs.sh") | crontab -

# Create monitoring configuration
cat > /opt/monitoring/config/alerts.conf << 'EOF'
# SmartProp Monitoring Configuration

# Thresholds
CPU_THRESHOLD=80
MEMORY_THRESHOLD=85
DISK_THRESHOLD=85

# Health check URLs
SMARTPROP_HEALTH_URL=http://localhost:3000/health
WAHA_HEALTH_URL=http://localhost:3030/health

# Log retention (days)
MONITORING_LOG_RETENTION=7
APPLICATION_LOG_RETENTION=30
EOF

# Create simple alerting script (can be extended with email/Slack notifications)
cat > /opt/monitoring/scripts/check-alerts.sh << 'EOF'
#!/bin/bash

# Simple alerting script for SmartProp
source /opt/monitoring/config/alerts.conf

ALERT_LOG="/opt/monitoring/logs/alerts-$(date +%Y%m%d).log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Check if any alerts were logged in the last 5 minutes
RECENT_ALERTS=$(grep "ALERT" "/opt/monitoring/logs/system-$(date +%Y%m%d).log" 2>/dev/null | tail -5)

if [[ ! -z "$RECENT_ALERTS" ]]; then
    echo "[$TIMESTAMP] ALERTS DETECTED:" >> "$ALERT_LOG"
    echo "$RECENT_ALERTS" >> "$ALERT_LOG"
    
    # Here you can add email/Slack notifications
    # Example: echo "$RECENT_ALERTS" | mail -s "SmartProp Alert" admin@example.com
fi
EOF

chmod +x /opt/monitoring/scripts/check-alerts.sh

# Add alert checking to cron
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/monitoring/scripts/check-alerts.sh") | crontab -

echo "✅ Monitoring setup completed!"
echo ""
echo "📋 Available monitoring commands:"
echo "  - View dashboard: /opt/monitoring/scripts/dashboard.sh"
echo "  - Check system logs: tail -f /opt/monitoring/logs/system-$(date +%Y%m%d).log"
echo "  - Check app logs: tail -f /opt/monitoring/logs/app-$(date +%Y%m%d).log"
echo "  - View alerts: tail -f /opt/monitoring/logs/alerts-$(date +%Y%m%d).log"
echo ""
echo "🔄 Monitoring runs automatically every 5-10 minutes via cron"
echo "📊 Run 'watch -n 30 /opt/monitoring/scripts/dashboard.sh' for live dashboard"