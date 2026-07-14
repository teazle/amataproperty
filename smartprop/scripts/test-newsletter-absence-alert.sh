#!/bin/bash
set -euo pipefail

required() {
  local name="$1"
  [[ -n "${!name:-}" ]] || { printf '%s is required\n' "$name" >&2; exit 2; }
}

required SMARTPROP_NEWSLETTER_ALERT_TEST_URL
required SMARTPROP_NEWSLETTER_ALERT_STATUS_URL
required SMARTPROP_NEWSLETTER_ALERT_TOKEN

curl_bin=/usr/bin/curl
bun_bin=/root/.bun/bin/bun
sleep_bin=/usr/bin/sleep
max_polls=24
if [[ "${SMARTPROP_NEWSLETTER_ALERT_TEST_MODE:-0}" == 1 ]]; then
  curl_bin="${SMARTPROP_NEWSLETTER_ALERT_CURL_BIN:?test curl is required}"
  bun_bin="${SMARTPROP_NEWSLETTER_ALERT_BUN_BIN:?test Bun is required}"
  sleep_bin="${SMARTPROP_NEWSLETTER_ALERT_SLEEP_BIN:?test sleep is required}"
  max_polls="${SMARTPROP_NEWSLETTER_ALERT_MAX_POLLS:-1}"
fi
[[ "$max_polls" =~ ^[0-9]+$ ]] && (( max_polls > 0 && max_polls <= 24 )) || exit 2

check_id="smartprop-newsletter-alert-test-$(date -u +%Y%m%dT%H%M%SZ)-$(/usr/bin/uuidgen | tr '[:upper:]' '[:lower:]')"
payload="$(CHECK_ID="$check_id" "$bun_bin" -e '
console.log(JSON.stringify({
  checkId: process.env.CHECK_ID,
  checkName: "smartprop-whatsapp-newsletter-heartbeat",
  event: "absence-alert-delivery-test",
  sentAt: new Date().toISOString(),
}));
')"

"$curl_bin" --fail --silent --show-error --request POST \
  --header "Authorization: Bearer $SMARTPROP_NEWSLETTER_ALERT_TOKEN" \
  --header 'Content-Type: application/json' \
  --data-binary "$payload" \
  "$SMARTPROP_NEWSLETTER_ALERT_TEST_URL" >/dev/null

separator='?'
[[ "$SMARTPROP_NEWSLETTER_ALERT_STATUS_URL" == *'?'* ]] && separator='&'
for (( poll = 1; poll <= max_polls; poll += 1 )); do
  status="$($curl_bin --fail --silent --show-error \
    --header "Authorization: Bearer $SMARTPROP_NEWSLETTER_ALERT_TOKEN" \
    "${SMARTPROP_NEWSLETTER_ALERT_STATUS_URL}${separator}checkId=${check_id}")" || status=''
  if parsed="$(printf '%s' "$status" | EXPECTED_CHECK_ID="$check_id" "$bun_bin" -e '
const value = JSON.parse(await Bun.stdin.text());
if (value?.checkId !== process.env.EXPECTED_CHECK_ID || value?.received !== true ||
    typeof value?.alertId !== "string" || !value.alertId.trim() ||
    typeof value?.receivedAt !== "string" || Number.isNaN(Date.parse(value.receivedAt))) process.exit(1);
console.log(`${value.alertId}\t${value.receivedAt}`);
' 2>/dev/null)"; then
    IFS=$'\t' read -r alert_id received_at <<<"$parsed"
    printf 'checkId=%s alertId=%s receivedAt=%s\n' "$check_id" "$alert_id" "$received_at"
    exit 0
  fi
  (( poll == max_polls )) || "$sleep_bin" 5
done

printf 'alert receiver did not confirm checkId=%s within 120 seconds\n' "$check_id" >&2
exit 1
