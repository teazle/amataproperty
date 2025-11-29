# Auto-Recovery System

## Overview

All systems on EC2 now have comprehensive auto-recovery mechanisms to prevent downtime and ensure continuous operation.

## Auto-Recovery Components

### 1. FlareSolverr Auto-Recovery ✅

**Monitoring:**
- Systemd timer runs every **2 minutes**
- Checks container status and API health
- Logs all events to `/opt/smartprop/logs/flaresolverr-monitor.log`

**Recovery Actions:**
- Automatically restarts container if it fails
- Pulls latest image before restart
- Prevents restart loops (5-minute cooldown, max 3 attempts)
- Verifies container started successfully

**Status:**
```bash
sudo systemctl status flaresolverr-monitor.timer
```

### 2. PM2 Processes Auto-Recovery ✅

**Configuration:**
- `autorestart: true` - Automatically restarts on crash
- `max_restarts: 10` - Maximum restart attempts
- `restart_delay: 5000` - 5 second delay between restarts

**Processes:**
- `smartprop` - Main application
- `scraper-worker` - Background worker

**Boot Recovery:**
- PM2 startup service enabled
- All processes start automatically on system boot
- Saved process list persists across reboots

**Status:**
```bash
pm2 list
pm2 status
systemctl status pm2-ec2-user.service
```

### 3. Docker Containers Auto-Recovery ✅

**Restart Policies:**
- `flaresolverr`: `unless-stopped` - Restarts unless manually stopped
- `smartprop-waha`: `unless-stopped` - Restarts unless manually stopped

**Recovery:**
- Docker automatically restarts containers on failure
- Health checks ensure containers are working
- Containers restart on system reboot

**Status:**
```bash
docker ps
docker inspect <container-name> | grep RestartPolicy
```

### 4. Comprehensive System Health Monitor ✅

**Monitoring:**
- Systemd timer runs every **5 minutes**
- Checks all critical systems:
  - PM2 processes (smartprop, scraper-worker)
  - Docker containers (flaresolverr, WAHA)
  - Application health endpoint

**Recovery Actions:**
- Restarts PM2 processes if they're not online
- Starts Docker containers if they're stopped
- Logs all issues to `/opt/smartprop/logs/system-health.log`

**Status:**
```bash
sudo systemctl status system-health-monitor.timer
tail -f /opt/smartprop/logs/system-health.log
```

## Monitoring Intervals

| System | Check Interval | Auto-Restart |
|--------|---------------|--------------|
| FlareSolverr | 2 minutes | ✅ Yes |
| System Health | 5 minutes | ✅ Yes |
| PM2 Processes | Continuous | ✅ Yes (on crash) |
| Docker Containers | Continuous | ✅ Yes (on failure) |

## Boot Recovery

All services are configured to start automatically on system boot:

1. **PM2 Processes**: Started via `pm2-ec2-user.service`
2. **Docker Containers**: Started via Docker's restart policies
3. **Monitoring Timers**: Started via systemd timers

## Logs

All monitoring and recovery actions are logged:

- **FlareSolverr**: `/opt/smartprop/logs/flaresolverr-monitor.log`
- **System Health**: `/opt/smartprop/logs/system-health.log`
- **PM2**: `~/.pm2/logs/`
- **Docker**: `docker logs <container-name>`
- **Systemd**: `sudo journalctl -u <service-name>`

## Manual Recovery

If automatic recovery fails, you can manually restart:

```bash
# Restart PM2 processes
pm2 restart all

# Restart Docker containers
docker restart flaresolverr smartprop-waha

# Restart monitoring
sudo systemctl restart flaresolverr-monitor.timer
sudo systemctl restart system-health-monitor.timer

# Check status
pm2 status
docker ps
sudo systemctl list-timers
```

## Verification

Check that all auto-recovery is working:

```bash
# Check all timers
sudo systemctl list-timers | grep -E "(flare|system-health)"

# Check PM2 startup
systemctl is-enabled pm2-ec2-user.service

# Check Docker restart policies
docker inspect flaresolverr smartprop-waha --format '{{.Name}}: {{.HostConfig.RestartPolicy}}'

# Check recent recovery actions
tail -20 /opt/smartprop/logs/flaresolverr-monitor.log
tail -20 /opt/smartprop/logs/system-health.log
```

## Benefits

✅ **Zero Downtime**: Systems automatically recover from failures  
✅ **Proactive**: Issues detected before they cause problems  
✅ **Comprehensive**: All critical systems are monitored  
✅ **Observable**: All actions are logged for troubleshooting  
✅ **Reliable**: Multiple layers of protection  

## What Gets Recovered

1. **FlareSolverr crashes** → Auto-restart within 2 minutes
2. **PM2 process crashes** → Auto-restart within 5 seconds
3. **Docker container stops** → Auto-restart immediately
4. **Application becomes unresponsive** → Detected and restarted within 5 minutes
5. **System reboots** → All services start automatically

## Next Steps

The system is now fully self-healing. All components will:
- Automatically detect failures
- Restart failed components
- Log all recovery actions
- Continue operating without manual intervention

