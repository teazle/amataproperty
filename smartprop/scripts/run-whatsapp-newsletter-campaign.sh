#!/usr/bin/env bash
set -u -o pipefail

umask 0077

TEST_MODE="${SMARTPROP_NEWSLETTER_TEST_MODE:-0}"
if [[ "$TEST_MODE" == 1 ]]; then
  APP_DIR="${SMARTPROP_NEWSLETTER_APP_DIR:?test app directory is required}"
  LOG_DIR="${SMARTPROP_NEWSLETTER_LOG_DIR:?test log directory is required}"
  BUN_BIN="${SMARTPROP_NEWSLETTER_BUN_BIN:?test Bun path is required}"
  FLOCK_BIN="${SMARTPROP_NEWSLETTER_FLOCK_BIN:?test flock path is required}"
else
  APP_DIR=/opt/smartprop/app/smartprop
  LOG_DIR=/opt/smartprop/logs/newsletter
  BUN_BIN=/root/.bun/bin/bun
  FLOCK_BIN=/usr/bin/flock
fi
LOCK_PATH="$LOG_DIR/run.lock"

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
  find "$LOG_DIR" -type f -name '*.json' ! -name run.lock -exec chmod 0600 {} +
  find "$LOG_DIR" -type f -name '*.json' ! -name run.lock -mmin +43200 -delete
}

before_retry_cutoff() {
  local sgt_time
  if [[ "$TEST_MODE" == 1 ]]; then
    sgt_time="${SMARTPROP_NEWSLETTER_TEST_SGT_TIME:?test SGT time is required}"
  else
    sgt_time="$(TZ=Asia/Singapore date +%H:%M)"
  fi
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
      write_artifact status manual-attention 30
      write_artifact heartbeat manual-attention 30
      prune_artifacts
      exit 30
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
"$FLOCK_BIN" -n -E 75 "$LOCK_PATH" "$0" --locked
exit_code=$?
set -e

if [[ "$exit_code" -eq 75 ]]; then
  write_artifact status lock-contended 0
  prune_artifacts
  exit 0
fi

exit "$exit_code"
