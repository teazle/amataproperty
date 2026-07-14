#!/bin/bash
set -euo pipefail

readonly job_name='smartprop-chloe-valuation-refresh'
readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly prompt_path="$script_dir/../jobs/chloe-valuation-refresh.md"

if [[ -z "${CHLOE_VALUATION_ALERT_TO:-}" ]]; then
  printf '%s\n' 'CHLOE_VALUATION_ALERT_TO is required' >&2
  exit 2
fi
command -v openclaw >/dev/null || { printf '%s\n' 'openclaw is required' >&2; exit 2; }
command -v jq >/dev/null || { printf '%s\n' 'jq is required' >&2; exit 2; }
[[ -f "$prompt_path" ]] || { printf '%s\n' 'valuation job prompt is missing' >&2; exit 2; }

list_job_ids() {
  openclaw cron list --json | jq -r --arg name "$job_name" \
    '(.jobs // .)[]? | select(.name == $name) | .id'
}

job_ids="$(list_job_ids)"
job_count="$(printf '%s\n' "$job_ids" | awk 'NF { count += 1 } END { print count + 0 }')"
if [[ $job_count -gt 1 ]]; then
  printf '%s\n' 'multiple exact-name valuation jobs exist' >&2
  exit 3
fi

declare -a base_args=(
  --name smartprop-chloe-valuation-refresh
  --cron '30 8 * * *' --tz Asia/Singapore --exact
  --agent main --session isolated --no-deliver
  --timeout-seconds 2700
  --tools 'exec web_search web_fetch browser read'
  --message "$(cat "$prompt_path")"
)

if [[ $job_count -eq 0 ]]; then
  openclaw cron add "${base_args[@]}" --disabled --json >/dev/null
  job_ids="$(list_job_ids)"
  job_count="$(printf '%s\n' "$job_ids" | awk 'NF { count += 1 } END { print count + 0 }')"
fi

if [[ $job_count -ne 1 || -z "$job_ids" ]]; then
  printf '%s\n' 'valuation job creation did not produce exactly one job' >&2
  exit 3
fi

job_id="$job_ids"
openclaw cron edit "$job_id" "${base_args[@]}" \
  --failure-alert --failure-alert-after 1 \
  --failure-alert-channel whatsapp --failure-alert-to "$CHLOE_VALUATION_ALERT_TO" \
  --disable >/dev/null

reconciled_ids="$(list_job_ids)"
reconciled_count="$(printf '%s\n' "$reconciled_ids" | awk 'NF { count += 1 } END { print count + 0 }')"
if [[ $reconciled_count -ne 1 || -z "$reconciled_ids" ]]; then
  printf '%s\n' 'valuation job reconciliation did not produce exactly one job' >&2
  exit 3
fi

printf '%s\n' "staged disabled valuation job $reconciled_ids"
