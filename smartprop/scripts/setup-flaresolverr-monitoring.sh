#!/bin/bash
# Setup script to install FlareSolverr monitoring on EC2

EC2_IP="${EC2_IP:?Set EC2_IP to the current VPS IP or hostname}"
EC2_USER="ec2-user"
PEM_KEY="/Users/vincent/propertydemo/smartprop-new-key.pem"

echo "🔧 Setting up FlareSolverr monitoring on EC2..."
echo ""

ssh -i ${PEM_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_IP} << 'ENDSSH'
set -e

cd /opt/smartprop/app/smartprop

# Create logs directory if it doesn't exist
mkdir -p /opt/smartprop/logs

# Copy monitor script
if [ -f "scripts/monitor-flaresolverr.sh" ]; then
    echo "📋 Installing monitor script..."
    sudo cp scripts/monitor-flaresolverr.sh /usr/local/bin/monitor-flaresolverr.sh
    sudo chmod +x /usr/local/bin/monitor-flaresolverr.sh
    echo "✅ Monitor script installed"
else
    echo "❌ monitor-flaresolverr.sh not found!"
    exit 1
fi

# Create systemd service for monitoring
echo "📦 Creating systemd service..."
sudo tee /etc/systemd/system/flaresolverr-monitor.service > /dev/null << 'EOF'
[Unit]
Description=FlareSolverr Health Monitor
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/monitor-flaresolverr.sh
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Create systemd timer for periodic checks
echo "⏰ Creating systemd timer..."
sudo tee /etc/systemd/system/flaresolverr-monitor.timer > /dev/null << 'EOF'
[Unit]
Description=Run FlareSolverr health check every 2 minutes
Requires=flaresolverr-monitor.service

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF

# Reload systemd and enable timer
echo "🔄 Enabling monitoring timer..."
sudo systemctl daemon-reload
sudo systemctl enable flaresolverr-monitor.timer
sudo systemctl start flaresolverr-monitor.timer

# Verify timer is active
echo ""
echo "✅ FlareSolverr monitoring setup complete!"
echo ""
echo "📊 Status:"
sudo systemctl status flaresolverr-monitor.timer --no-pager -l | head -10

echo ""
echo "📝 Useful commands:"
echo "  - Check timer status: sudo systemctl status flaresolverr-monitor.timer"
echo "  - View monitor logs: tail -f /opt/smartprop/logs/flaresolverr-monitor.log"
echo "  - View service logs: sudo journalctl -u flaresolverr-monitor.service -f"
echo "  - Manually run check: sudo systemctl start flaresolverr-monitor.service"
echo "  - Disable monitoring: sudo systemctl stop flaresolverr-monitor.timer && sudo systemctl disable flaresolverr-monitor.timer"

# Also add to crontab as backup (runs every 2 minutes) - optional
echo ""
echo "📅 Adding crontab backup (runs every 2 minutes)..."
if command -v crontab &> /dev/null; then
    (crontab -l 2>/dev/null | grep -v "monitor-flaresolverr"; echo "*/2 * * * * /usr/local/bin/monitor-flaresolverr.sh >> /opt/smartprop/logs/flaresolverr-cron.log 2>&1") | crontab -
    echo "✅ Crontab backup added"
else
    echo "⚠️  crontab not available, using systemd timer only (this is fine)"
fi

echo ""
echo "🎉 Setup complete! FlareSolverr will be monitored every 2 minutes."
ENDSSH

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ FlareSolverr monitoring successfully installed on EC2!"
    echo ""
    echo "The monitor will:"
    echo "  - Check FlareSolverr health every 2 minutes"
    echo "  - Automatically restart if it fails"
    echo "  - Log all events to /opt/smartprop/logs/flaresolverr-monitor.log"
    echo "  - Prevent restart loops with cooldown periods"
else
    echo "❌ Setup failed"
    exit 1
fi

