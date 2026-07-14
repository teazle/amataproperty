#!/bin/bash
set -euo pipefail

readonly check_name='smartprop-whatsapp-newsletter-heartbeat'
verifier=/opt/smartprop/app/smartprop/scripts/verify-newsletter-campaign.sh
timeout_bin=/usr/bin/timeout
curl_bin=/usr/bin/curl
bun_bin="${SMARTPROP_NEWSLETTER_BUN_BIN:-/root/.bun/bin/bun}"

if [[ "${SMARTPROP_NEWSLETTER_MONITOR_TEST_MODE:-0}" == 1 ]]; then
  verifier="${SMARTPROP_NEWSLETTER_MONITOR_VERIFIER:?test verifier is required}"
  timeout_bin="${SMARTPROP_NEWSLETTER_MONITOR_TIMEOUT_BIN:?test timeout is required}"
  curl_bin="${SMARTPROP_NEWSLETTER_MONITOR_CURL_BIN:?test curl is required}"
  bun_bin="${SMARTPROP_NEWSLETTER_MONITOR_BUN_BIN:?test Bun is required}"
fi

: "${SMARTPROP_NEWSLETTER_MONITOR_URL:?SMARTPROP_NEWSLETTER_MONITOR_URL is required}"
: "${SMARTPROP_NEWSLETTER_ALERT_TOKEN:?SMARTPROP_NEWSLETTER_ALERT_TOKEN is required}"
: "${EXPECTED_REVISION:?EXPECTED_REVISION is required}"
[[ "$EXPECTED_REVISION" =~ ^[0-9A-Fa-f]{7,64}$ ]] || { printf '%s\n' 'EXPECTED_REVISION is invalid' >&2; exit 2; }

umask 077
output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT
set +e
"$timeout_bin" 120 "$verifier" --expect=live --expected-revision="$EXPECTED_REVISION" >"$output_file" 2>&1
verify_exit=$?
set -e

tail_text="$(tail -c 1024 "$output_file" | tr -cd '\11\12\15\40-\176')"
check_id="${check_name}-$(date -u +%Y%m%dT%H%M%SZ)-$(/usr/bin/uuidgen | tr '[:upper:]' '[:lower:]')"
payload="$(CHECK_ID="$check_id" CHECK_NAME="$check_name" VERIFY_EXIT="$verify_exit" \
  EXPECTED_REVISION="$EXPECTED_REVISION" VERIFY_TAIL="$tail_text" "$bun_bin" -e '
console.log(JSON.stringify({
  checkId: process.env.CHECK_ID,
  checkName: process.env.CHECK_NAME,
  status: process.env.VERIFY_EXIT === "0" ? "success" : "failure",
  verifierExit: Number(process.env.VERIFY_EXIT),
  expectedRevision: process.env.EXPECTED_REVISION,
  observedAt: new Date().toISOString(),
  redactedTail: (process.env.VERIFY_TAIL || "").slice(-1024),
}));
')"

"$curl_bin" --fail --silent --show-error --request POST \
  --header "Authorization: Bearer $SMARTPROP_NEWSLETTER_ALERT_TOKEN" \
  --header 'Content-Type: application/json' \
  --data-binary "$payload" \
  "$SMARTPROP_NEWSLETTER_MONITOR_URL" >/dev/null || exit 1

(( verify_exit == 0 )) || exit 1
printf 'checkId=%s status=success\n' "$check_id"
