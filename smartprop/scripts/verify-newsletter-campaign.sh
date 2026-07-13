#!/usr/bin/env bash
set -euo pipefail

TARGET=root@109.123.239.107
PORT=2222
EXPECTED_HOSTNAME=vmi3201429
EXPECT=staged

usage() {
  printf 'Usage: %s [--expect=staged|live]\n' "$0" >&2
  exit 64
}

for argument in "$@"; do
  case "$argument" in
    --expect=staged) EXPECT=staged ;;
    --expect=live) EXPECT=live ;;
    *) usage ;;
  esac
done

ssh -p "$PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" /bin/bash -s -- "$EXPECT" "$EXPECTED_HOSTNAME" <<'REMOTE'
set -euo pipefail

expect="$1"
expected_hostname="$2"
app_dir=/opt/smartprop/app/smartprop
log_dir=/opt/smartprop/logs/newsletter
bun_bin=/root/.bun/bin/bun
readonly_db_env=/etc/smartprop/newsletter-readonly-db.env

fail() {
  printf 'newsletter verification failed: %s\n' "$1" >&2
  exit 1
}

[[ "$(hostname -s)" == "$expected_hostname" ]] || fail 'hostname mismatch'
[[ -s "$app_dir/.deploy-source-revision" ]] || fail 'missing deploy source revision'
revision="$(tr -d '[:space:]' < "$app_dir/.deploy-source-revision")"
[[ -n "$revision" ]] || fail 'empty deploy source revision'
printf 'sourceRevision=%s\n' "$revision"

health="$(curl --fail --silent --show-error http://127.0.0.1:3000/api/health)"
printf '%s\n' "$health"
printf '%s' "$health" | VERIFY_EXPECT="$expect" "$bun_bin" -e '
const value = JSON.parse(await Bun.stdin.text());
const check = value?.checks?.newsletter;
if (!check || !["healthy", "quiet", "blocked", "stale", "unknown"].includes(check.status)) process.exit(1);
for (const key of ["enabled", "sourceRevision", "latestRunDate", "latestRunStatus", "lastHeartbeatAt", "lastMeaningfulWorkAt", "attempted", "accepted", "unknown", "wahaReady"]) {
  if (!(key in check)) process.exit(1);
}
const expect = process.env.VERIFY_EXPECT;
const sgtDate = (value) => {
  const date = new Date(value);
  const singapore = new Date(date.getTime() + (8 * 60 * 60 * 1000));
  return `${singapore.getUTCFullYear()}-${String(singapore.getUTCMonth() + 1).padStart(2, "0")}-${String(singapore.getUTCDate()).padStart(2, "0")}`;
};
if (expect === "staged" && (check.status !== "quiet" || check.enabled !== false)) process.exit(1);
if (expect === "live" && (
  check.status !== "healthy" || check.wahaReady !== true || !check.lastHeartbeatAt || !check.lastMeaningfulWorkAt
  || sgtDate(check.lastHeartbeatAt) !== sgtDate(new Date()) || sgtDate(check.lastMeaningfulWorkAt) !== sgtDate(new Date())
)) process.exit(1);
' || fail 'newsletter health is not fresh for live mode'

session="$(curl --fail --silent --show-error http://127.0.0.1:3030/api/sessions/default)"
printf '%s' "$session" | "$bun_bin" -e 'const value = JSON.parse(await Bun.stdin.text()); process.exit(value?.status === "WORKING" ? 0 : 1)' \
  || fail 'WAHA default session is not WORKING'

[[ -r "$readonly_db_env" ]] || fail "missing documented read-only DB env: $readonly_db_env"
# This file must set SMARTPROP_NEWSLETTER_READONLY_DATABASE_URL to a read-only role URL.
set -a
. "$readonly_db_env"
set +a
: "${SMARTPROP_NEWSLETTER_READONLY_DATABASE_URL:?missing read-only newsletter DB URL}"
export PGOPTIONS='-c default_transaction_read_only=on'

schema_ok="$(psql "$SMARTPROP_NEWSLETTER_READONLY_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc "
  SELECT to_regclass('public.newsletter_runs') IS NOT NULL
     AND to_regclass('public.newsletter_sends') IS NOT NULL
     AND to_regclass('public.newsletter_operator_reports') IS NOT NULL
     AND to_regprocedure('public.claim_newsletter_run(text)') IS NOT NULL
     AND to_regprocedure('public.finalize_newsletter_attempt(uuid,text,text,text,boolean)') IS NOT NULL;
")"
[[ "$schema_ok" == t ]] || fail 'newsletter migration tables or RPCs are absent'

latest_counts="$(psql "$SMARTPROP_NEWSLETTER_READONLY_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' -c "
  SELECT COALESCE(run_date::text, 'none'), COALESCE(status, 'none'), attempted_count, sent_count, unknown_count
  FROM newsletter_runs ORDER BY run_date DESC LIMIT 1;
")"
printf 'latestRun=%s\n' "${latest_counts:-none}"
report_count="$(psql "$SMARTPROP_NEWSLETTER_READONLY_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM newsletter_operator_reports;")"
printf 'operatorReportCount=%s\n' "$report_count"

timer_enabled="$(systemctl is-enabled smartprop-whatsapp-newsletter.timer 2>/dev/null || true)"
timer_active="$(systemctl is-active smartprop-whatsapp-newsletter.timer 2>/dev/null || true)"
service_state="$(systemctl is-active smartprop-whatsapp-newsletter.service 2>/dev/null || true)"
printf 'timerEnabled=%s timerActive=%s serviceActive=%s\n' "$timer_enabled" "$timer_active" "$service_state"
if [[ "$expect" == staged ]]; then
  [[ "$timer_enabled" == disabled && "$timer_active" == inactive ]] || fail 'staged mode requires disabled/inactive timer'
else
  [[ "$timer_enabled" == enabled && "$timer_active" == active ]] || fail 'live mode requires enabled/active timer'
  accepted_all_time="$(psql "$SMARTPROP_NEWSLETTER_READONLY_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc "
    SELECT count(*) FROM newsletter_sends WHERE is_test = false AND status = 'sent';
  ")"
  [[ "$accepted_all_time" =~ ^[1-9][0-9]*$ ]] || fail 'live mode requires nonzero non-test accepted sends'
  printf 'acceptedAllTime=%s\n' "$accepted_all_time"
fi

[[ "$(stat -c %a "$log_dir")" == 700 ]] || fail 'newsletter log directory is not mode 0700'
if find "$log_dir" -type f ! -name run.lock -printf '%m\n' | grep -v '^600$' >/dev/null; then
  fail 'newsletter artifacts are not mode 0600'
fi
if find "$log_dir" -type f -name '*.json' ! -name run.lock -mtime +30 -print -quit | grep -q .; then
  fail 'newsletter artifact retention exceeds 30 days'
fi
REMOTE
