#!/usr/bin/env bash
set -u -o pipefail

umask 0077

APP_DIR=/opt/smartprop/app/smartprop
LOG_DIR=/opt/smartprop/logs/newsletter
LOCK_PATH="$LOG_DIR/run.lock"
BUN_BIN=/root/.bun/bin/bun

prepare_log_dir() {
  mkdir -p "$LOG_DIR"
  chmod 0700 "$LOG_DIR"
  touch "$LOCK_PATH"
  chmod 0600 "$LOCK_PATH"
}

write_artifact() {
  local kind="$1"
  local status="$2"
  local exit_code="$3"
  local timestamp temp
  timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  temp="$(mktemp "$LOG_DIR/.${kind}.XXXXXX")"
  chmod 0600 "$temp"
  printf '{"recordedAt":"%s","kind":"%s","status":"%s","exitCode":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$kind" "$status" "$exit_code" > "$temp"
  mv "$temp" "$LOG_DIR/${timestamp}-${kind}.json"
  chmod 0600 "$LOG_DIR/${timestamp}-${kind}.json"
}

prune_artifacts() {
  find "$LOG_DIR" -type f -name '*.json' ! -name run.lock -mtime +30 -delete
}

before_retry_cutoff() {
  local sgt_time
  sgt_time="$(TZ=Asia/Singapore date +%H:%M)"
  [[ "$sgt_time" < "10:30" ]]
}

run_locked() {
  local exit_code
  write_artifact heartbeat running 0
  set +e
  (
    cd "$APP_DIR"
    "$BUN_BIN" scripts/run-whatsapp-newsletter-campaign.ts run --json
  )
  exit_code=$?
  set -e

  case "$exit_code" in
    0)
      write_artifact status completed 0
      ;;
    10)
      if before_retry_cutoff; then
        write_artifact status blocked-retryable 10
        write_artifact heartbeat blocked-retryable 10
        prune_artifacts
        exit 10
      fi
      write_artifact status blocked-cutoff 0
      ;;
    20|30)
      write_artifact status manual-attention "$exit_code"
      write_artifact heartbeat manual-attention "$exit_code"
      prune_artifacts
      exit "$exit_code"
      ;;
    *)
      write_artifact status failed "$exit_code"
      write_artifact heartbeat failed "$exit_code"
      prune_artifacts
      exit "$exit_code"
      ;;
  esac

  write_artifact heartbeat completed 0
  prune_artifacts
}

prepare_log_dir

if [[ "${1:-}" == "--locked" ]]; then
  run_locked
  exit $?
fi

set +e
/usr/bin/flock -n -E 75 "$LOCK_PATH" "$0" --locked
exit_code=$?
set -e

if [[ "$exit_code" -eq 75 ]]; then
  write_artifact status lock-contended 0
  prune_artifacts
  exit 0
fi

exit "$exit_code"
