# FlareSolverr Monitoring & Auto-Recovery

## Overview

FlareSolverr is now automatically monitored and will restart itself if it fails. This prevents the issue where FlareSolverr stops working without notice.

## How It Works

### 1. **Automatic Health Checks**
- Runs every **2 minutes** via systemd timer
- Checks if FlareSolverr container is running
- Tests API endpoint with a real request
- Verifies container health status

### 2. **Auto-Recovery**
- Automatically restarts FlareSolverr if it fails
- Pulls latest image before restart
- Waits for container to be ready
- Prevents restart loops with cooldown periods (5 minutes)
- Limits restart attempts (max 3 in a row)

### 3. **Logging**
- All events logged to `/opt/smartprop/logs/flaresolverr-monitor.log`
- Logs rotated automatically when they exceed 10MB
- Systemd journal also captures all runs

## Monitoring Status

### Check Monitoring Status
```bash
# From local machine
./scripts/check-flaresolverr-monitoring.sh

# Or SSH to EC2
ssh -i smartprop-new-key.pem ${EC2_USER:-ec2-user}@${EC2_IP}
sudo systemctl status flaresolverr-monitor.timer
```

### View Monitor Logs
```bash
# On EC2
tail -f /opt/smartprop/logs/flaresolverr-monitor.log

# View systemd logs
sudo journalctl -u flaresolverr-monitor.service -f
```

### Manual Health Check
```bash
# On EC2
sudo systemctl start flaresolverr-monitor.service

# Or run script directly
sudo /usr/local/bin/monitor-flaresolverr.sh
```

## What Gets Monitored

1. **Container Status**: Is the FlareSolverr container running?
2. **API Health**: Can we make successful requests to FlareSolverr?
3. **Container Health**: Is Docker's health check passing?
4. **Response Time**: Is FlareSolverr responding within 10 seconds?

## Auto-Recovery Features

### Restart Process
1. Stops existing container (if running)
2. Removes old container
3. Pulls latest FlareSolverr image
4. Starts new container with proper configuration:
   - 1GB memory limit
   - 1 CPU limit
   - Port 8191 exposed
   - Auto-restart enabled
   - Singapore timezone

### Safety Features
- **Cooldown Period**: Won't restart more than once every 5 minutes
- **Max Attempts**: Stops after 3 consecutive restart attempts
- **Logging**: All restart attempts are logged
- **Verification**: Verifies container started successfully before reporting success

## Troubleshooting

### If Monitoring Stops Working

1. **Check timer status**:
   ```bash
   sudo systemctl status flaresolverr-monitor.timer
   ```

2. **Restart timer**:
   ```bash
   sudo systemctl restart flaresolverr-monitor.timer
   ```

3. **Check for errors**:
   ```bash
   sudo journalctl -u flaresolverr-monitor.service -n 50
   ```

### If FlareSolverr Keeps Failing

1. **Check logs**:
   ```bash
   docker logs flaresolverr
   tail -f /opt/smartprop/logs/flaresolverr-monitor.log
   ```

2. **Check system resources**:
   ```bash
   docker stats flaresolverr
   free -h
   df -h
   ```

3. **Manual restart**:
   ```bash
   ./scripts/restart-flaresolverr-ec2.sh
   ```

## Disabling Monitoring

If you need to disable monitoring temporarily:

```bash
# Stop and disable timer
sudo systemctl stop flaresolverr-monitor.timer
sudo systemctl disable flaresolverr-monitor.timer

# Re-enable later
sudo systemctl enable flaresolverr-monitor.timer
sudo systemctl start flaresolverr-monitor.timer
```

## Files & Locations

- **Monitor Script**: `/usr/local/bin/monitor-flaresolverr.sh`
- **Systemd Service**: `/etc/systemd/system/flaresolverr-monitor.service`
- **Systemd Timer**: `/etc/systemd/system/flaresolverr-monitor.timer`
- **Log File**: `/opt/smartprop/logs/flaresolverr-monitor.log`
- **Source Script**: `smartprop/scripts/monitor-flaresolverr.sh`

## Integration with Existing Monitoring

The FlareSolverr monitor works alongside:
- PM2 process monitoring (for app/worker)
- Docker container health checks
- System monitoring (if `monitoring-setup.sh` was run)

## Benefits

✅ **Proactive**: Detects issues before they affect scrapers
✅ **Automatic**: No manual intervention needed
✅ **Safe**: Prevents restart loops and resource exhaustion
✅ **Observable**: All actions are logged
✅ **Reliable**: Uses systemd for guaranteed execution

## Next Steps

The monitoring is now active and will:
1. Check FlareSolverr every 2 minutes
2. Automatically restart if it fails
3. Log all events for troubleshooting
4. Prevent the issue from happening again

You can verify it's working by checking the logs or running the status check script.

