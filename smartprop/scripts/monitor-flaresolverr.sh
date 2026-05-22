#!/bin/bash
# FlareSolverr Health Monitor and Auto-Recovery Script
# This script monitors FlareSolverr and automatically restarts it if it fails

set -e

LOG_FILE="/opt/smartprop/logs/flaresolverr-monitor.log"
MAX_LOG_SIZE=10485760  # 10MB
FLARESOLVERR_URL="http://localhost:8191/v1"
CONTAINER_NAME="flaresolverr"
HEALTH_CHECK_TIMEOUT=10
MAX_RESTART_ATTEMPTS=3
RESTART_COOLDOWN=300  # 5 minutes between restart attempts

# Function to log with timestamp
log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Rotate log if it gets too large
rotate_log() {
    if [ -f "$LOG_FILE" ] && [ $(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) -gt $MAX_LOG_SIZE ]; then
        mv "$LOG_FILE" "${LOG_FILE}.old"
        log "INFO" "Log rotated"
    fi
}

# Check if FlareSolverr container is running
check_container_running() {
    docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# Check if FlareSolverr API is responding
check_api_health() {
    local response_code=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time $HEALTH_CHECK_TIMEOUT \
        -X POST "$FLARESOLVERR_URL" \
        -H 'Content-Type: application/json' \
        -d '{"cmd":"request.get","url":"https://www.google.com","maxTimeout":60000}' \
        2>/dev/null || echo "000")

    if [ "$response_code" = "200" ] || [ "$response_code" = "405" ]; then
        return 0  # Healthy
    else
        return 1  # Unhealthy
    fi
}

# Check container health status
check_container_health() {
    local health_status=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "none")
    if [ "$health_status" = "healthy" ]; then
        return 0
    else
        return 1
    fi
}

# Restart FlareSolverr container
restart_flaresolverr() {
    log "WARN" "Attempting to restart FlareSolverr..."

    # Stop existing container
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true

    # Pull latest image
    docker pull ghcr.io/flaresolverr/flaresolverr:latest

    # Start with proper configuration
    docker run -d \
        --name="$CONTAINER_NAME" \
        --platform=linux/arm64/v8 \
        --restart=unless-stopped \
        --shm-size=2g \
        -p 8191:8191 \
        -e LOG_LEVEL=info \
        -e LOG_HTML=false \
        -e CAPTCHA_SOLVER=none \
        -e TZ=Asia/Singapore \
        -e MAX_TIMEOUT=300000 \
        -e BROWSER_TIMEOUT=300000 \
        --memory=2g \
        --cpus=1.5 \
        ghcr.io/flaresolverr/flaresolverr:latest

    # Wait for container to start
    sleep 10

    # Verify it started
    if check_container_running; then
        log "INFO" "FlareSolverr container restarted successfully"
        return 0
    else
        log "ERROR" "Failed to restart FlareSolverr container"
        return 1
    fi
}

# Main health check function
main() {
    rotate_log

    log "INFO" "Starting FlareSolverr health check..."

    # Check if container exists and is running
    if ! check_container_running; then
        log "ERROR" "FlareSolverr container is not running"
        restart_flaresolverr
        exit $?
    fi

    # Check container health status
    if ! check_container_health; then
        log "WARN" "FlareSolverr container health check failed"
    fi

    # Check API health
    if ! check_api_health; then
        log "ERROR" "FlareSolverr API health check failed"

        # Check restart cooldown
        local last_restart=$(grep "restarted successfully" "$LOG_FILE" 2>/dev/null | tail -1 | cut -d' ' -f1-2 || echo "")
        if [ -n "$last_restart" ]; then
            local last_restart_epoch=$(date -d "$last_restart" +%s 2>/dev/null || date -j -f "%Y-%m-%d %H:%M:%S" "$last_restart" +%s 2>/dev/null || echo 0)
            local current_epoch=$(date +%s)
            local time_since_restart=$((current_epoch - last_restart_epoch))

            if [ $time_since_restart -lt $RESTART_COOLDOWN ]; then
                log "WARN" "Skipping restart (cooldown period: $((RESTART_COOLDOWN - time_since_restart))s remaining)"
                exit 1
            fi
        fi

        # Count recent restart attempts
        local recent_restarts=$(grep -c "restarted successfully" "$LOG_FILE" 2>/dev/null | tail -1 || echo 0)
        if [ "$recent_restarts" -ge "$MAX_RESTART_ATTEMPTS" ]; then
            log "ERROR" "Maximum restart attempts ($MAX_RESTART_ATTEMPTS) reached. Manual intervention required."
            exit 1
        fi

        restart_flaresolverr
        exit $?
    fi

    log "INFO" "FlareSolverr is healthy"
    exit 0
}

# Run main function
main "$@"
