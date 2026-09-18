#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="${SERVICE_NAME:-openclaw-gateway.service}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:18789/}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
LOG_FILE="${LOG_FILE:-/var/log/openclaw-gateway-watchdog.log}"
LOCK_FILE="${LOCK_FILE:-/run/openclaw-gateway-watchdog.lock}"
USER_RUNTIME_DIR="${USER_RUNTIME_DIR:-/run/user/0}"
RESTART_SETTLE_SECONDS="${RESTART_SETTLE_SECONDS:-5}"
RESTART_READY_ATTEMPTS="${RESTART_READY_ATTEMPTS:-18}"

export XDG_RUNTIME_DIR="${USER_RUNTIME_DIR}"

log() {
  printf '%s %s\n' "$(date -Is)" "$*" >>"${LOG_FILE}"
}

user_systemctl() {
  systemctl --user "$@"
}

service_active() {
  user_systemctl is-active --quiet "${SERVICE_NAME}"
}

port_listening() {
  ss -ltn "sport = :${GATEWAY_PORT}" | grep -q ":${GATEWAY_PORT}"
}

http_responding() {
  curl -fsS --max-time 8 "${GATEWAY_URL}" >/dev/null 2>&1
}

openclaw_probe() {
  timeout 25s openclaw status >/dev/null 2>&1
}

hard_health_ok() {
  service_active && port_listening && openclaw_probe
}

restart_gateway() {
  log "hard-unhealthy service_active=$(service_active && echo true || echo false) port_listening=$(port_listening && echo true || echo false) http_responding=$(http_responding && echo true || echo false) openclaw_probe=$(openclaw_probe && echo true || echo false); restarting ${SERVICE_NAME}"
  user_systemctl restart "${SERVICE_NAME}" >>"${LOG_FILE}" 2>&1
  sleep "${RESTART_SETTLE_SECONDS}"
}

wait_for_recovery() {
  local attempt
  for attempt in $(seq 1 "${RESTART_READY_ATTEMPTS}"); do
    if hard_health_ok; then
      log "recovered ${SERVICE_NAME} after attempt ${attempt}/${RESTART_READY_ATTEMPTS}"
      return 0
    fi
    sleep 5
  done
  return 1
}

main() {
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    log "skipping; another watchdog run is active"
    exit 0
  fi

  if hard_health_ok; then
    exit 0
  fi

  if hard_health_ok; then
    log "hard-health recovered before restart; no restart"
    exit 0
  fi

  restart_gateway

  if wait_for_recovery; then
    exit 0
  fi

  log "still hard-unhealthy after restart"
  user_systemctl status "${SERVICE_NAME}" --no-pager >>"${LOG_FILE}" 2>&1 || true
  exit 1
}

main "$@"
