#!/bin/bash
set -euo pipefail

expect=staged
expected_prompt_sha=''
job_name='smartprop-chloe-valuation-refresh'
prompt_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../jobs/chloe-valuation-refresh.md"
sha256_bin=/usr/bin/sha256sum
if [[ "${CHLOE_VALUATION_VERIFIER_TEST_MODE:-0}" == 1 ]]; then
  prompt_path="${CHLOE_VALUATION_VERIFIER_PROMPT_PATH:?test prompt path is required}"
  sha256_bin="${CHLOE_VALUATION_VERIFIER_SHA256_BIN:?test SHA-256 binary is required}"
fi

usage() {
  printf 'usage: %s --expect=staged|live --expected-prompt-sha256=<64 hex>\n' "$0" >&2
  exit 64
}
for argument in "$@"; do
  case "$argument" in
    --expect=staged) expect=staged ;;
    --expect=live) expect=live ;;
    --expected-prompt-sha256=*) expected_prompt_sha="${argument#*=}" ;;
    *) usage ;;
  esac
done
[[ "$expected_prompt_sha" =~ ^[0-9A-Fa-f]{64}$ ]] || usage
: "${CHLOE_VALUATION_ALERT_TO:?CHLOE_VALUATION_ALERT_TO is required}"
command -v openclaw >/dev/null || exit 2
command -v jq >/dev/null || exit 2
[[ -f "$prompt_path" ]] || exit 2

jobs_json="$(openclaw cron list --json)"
job_count="$(printf '%s' "$jobs_json" | jq --arg name "$job_name" '[.jobs[]? | select(.name == $name)] | length')"
[[ "$job_count" == 1 ]] || { printf 'expected exactly one %s job\n' "$job_name" >&2; exit 1; }
job_json="$(printf '%s' "$jobs_json" | jq -c --arg name "$job_name" '.jobs[] | select(.name == $name)')"
job_id="$(printf '%s' "$job_json" | jq -r '.id')"

prompt_sha="$("$sha256_bin" "$prompt_path" | awk '{print $1}')"
message_sha="$(printf '%s' "$job_json" | jq -r '.payload.message' | "$sha256_bin" | awk '{print $1}')"
[[ "$prompt_sha" == "$expected_prompt_sha" && "$message_sha" == "$expected_prompt_sha" ]] || {
  printf '%s\n' 'deployed Chloe prompt revision mismatch' >&2
  exit 1
}

printf '%s' "$job_json" | EXPECT="$expect" ALERT_TO="$CHLOE_VALUATION_ALERT_TO" jq -e '
  .schedule.kind == "cron" and
  .schedule.expr == "30 8 * * *" and
  .schedule.tz == "Asia/Singapore" and
  ((.schedule.staggerMs // 0) == 0) and
  ((.agentId // "main") == "main") and
  .sessionTarget == "isolated" and
  .payload.timeoutSeconds == 2700 and
  ((.payload.toolsAllow // []) | sort) == (["exec","web_search","web_fetch","browser","read"] | sort) and
  ((.delivery.mode // "none") == "none") and
  .failureAlert.after == 1 and
  .failureAlert.channel == "whatsapp" and
  .failureAlert.to == env.ALERT_TO and
  (if env.EXPECT == "live" then .enabled == true else .enabled == false end)
' >/dev/null || { printf '%s\n' 'Chloe valuation job configuration mismatch' >&2; exit 1; }

runs_json="$(openclaw cron runs --id "$job_id" --limit 1)"
last_status="$(printf '%s' "$runs_json" | jq -r '.entries[0].status // "none"')"
if [[ "$expect" == live ]]; then
  [[ "$last_status" == ok ]] || { printf '%s\n' 'live Chloe valuation job has no successful latest run' >&2; exit 1; }
elif [[ "$last_status" != none && "$last_status" != ok ]]; then
  printf '%s\n' 'staged Chloe valuation job latest run is not successful' >&2
  exit 1
fi

printf 'jobId=%s enabled=%s promptSha256=%s lastRunStatus=%s\n' \
  "$job_id" "$(printf '%s' "$job_json" | jq -r '.enabled')" "$prompt_sha" "$last_status"
