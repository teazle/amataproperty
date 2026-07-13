#!/usr/bin/env bash
set -Euo pipefail

umask 0077

TEST_MODE="${SMARTPROP_NEWSLETTER_TEST_MODE:-0}"
if [[ "$TEST_MODE" == 1 ]]; then
  APP_DIR="${SMARTPROP_NEWSLETTER_APP_DIR:-}"
  LOG_DIR="${SMARTPROP_NEWSLETTER_LOG_DIR:-}"
  BUN_BIN="${SMARTPROP_NEWSLETTER_BUN_BIN:-}"
  FLOCK_BIN="${SMARTPROP_NEWSLETTER_FLOCK_BIN:-}"
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
  local artifact cutoff_epoch mtime_epoch now_epoch
  now_epoch="$(date +%s)"
  cutoff_epoch=$((now_epoch - 2592000))
  while IFS= read -r -d '' artifact; do
    chmod 0600 "$artifact"
    if [[ "$TEST_MODE" == 1 && "$(uname -s)" == Darwin ]]; then
      mtime_epoch="$(stat -f %m "$artifact")"
    else
      mtime_epoch="$(stat -c %Y "$artifact")"
    fi
    if (( mtime_epoch <= cutoff_epoch )); then
      rm -f -- "$artifact"
    fi
  done < <(find "$LOG_DIR" -type f -name '*.json' ! -name run.lock -print0)
}

manual_attention_exit() {
  trap - ERR HUP INT QUIT TERM
  set +e
  if [[ -n "${LOG_DIR:-}" && -d "$LOG_DIR" && -w "$LOG_DIR" ]]; then
    write_artifact status manual-attention 30 >/dev/null 2>&1
    write_artifact heartbeat manual-attention 30 >/dev/null 2>&1
    prune_artifacts >/dev/null 2>&1
  fi
  exit 30
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
  if (
    cd "$APP_DIR"
    "$BUN_BIN" scripts/run-whatsapp-newsletter-campaign.ts run --json
  ); then
    exit_code=0
  else
    exit_code=$?
  fi

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

trap 'manual_attention_exit' ERR
trap 'manual_attention_exit' HUP INT QUIT TERM
set -e

if [[ "$TEST_MODE" == 1 ]]; then
  [[ -n "$APP_DIR" && -n "$LOG_DIR" && -n "$BUN_BIN" && -n "$FLOCK_BIN" ]] || manual_attention_exit
fi

prepare_log_dir

if [[ "${1:-}" == "--locked" ]]; then
  run_locked
  exit $?
fi

if "$FLOCK_BIN" -n -E 75 "$LOCK_PATH" "$0" --locked; then
  exit_code=0
else
  exit_code=$?
fi

if [[ "$exit_code" -eq 75 ]]; then
  write_artifact status lock-contended 0
  prune_artifacts
  exit 0
fi

case "$exit_code" in
  0|10|20|30) exit "$exit_code" ;;
  *) manual_attention_exit ;;
esac
