#!/usr/bin/env bash
set -euo pipefail

TARGET=root@109.123.239.107
PORT=2222
EXPECTED_HOSTNAME=vmi3201429
REMOTE_SCRIPT=/opt/smartprop/app/smartprop/scripts/verify-newsletter-campaign.sh
EXPECT=staged
EXPECTED_REVISION="${SMARTPROP_NEWSLETTER_EXPECTED_REVISION:-}"
FRESHNESS_MINUTES="${SMARTPROP_NEWSLETTER_FRESHNESS_MINUTES:-30}"
MODE=controller

usage() {
  printf 'Usage: %s --expect=staged|live --expected-revision=<7-64 hex>\n' "$0" >&2
  exit 64
}

fail() {
  printf 'newsletter verification failed: %s\n' "$1" >&2
  exit 1
}

singapore_date() {
  local value="$1"
  VERIFY_NOW="$value" "$BUN_BIN" -e '
const value = new Date(process.env.VERIFY_NOW);
if (Number.isNaN(value.getTime())) process.exit(1);
const singapore = new Date(value.getTime() + 8 * 60 * 60 * 1000);
console.log(`${singapore.getUTCFullYear()}-${String(singapore.getUTCMonth() + 1).padStart(2, "0")}-${String(singapore.getUTCDate()).padStart(2, "0")}`);
'
}

verify_target() {
  local expect="$1"
  local expected_revision="$2"
  local freshness_minutes="$3"
  local test_mode="$4"
  local app_dir log_dir db_env actual_hostname now waha_api_key
  local curl_bin psql_bin systemctl_bin stat_bin

  if [[ "$test_mode" == 1 ]]; then
    app_dir="${SMARTPROP_NEWSLETTER_TEST_APP_DIR:?test app directory is required}"
    log_dir="${SMARTPROP_NEWSLETTER_TEST_LOG_DIR:?test log directory is required}"
    db_env="${SMARTPROP_NEWSLETTER_TEST_DB_ENV:?test DB env path is required}"
    actual_hostname="${SMARTPROP_NEWSLETTER_TEST_HOSTNAME:?test hostname is required}"
    now="${SMARTPROP_NEWSLETTER_TEST_NOW:?test clock is required}"
    curl_bin="${SMARTPROP_NEWSLETTER_CURL_BIN:?test curl path is required}"
    psql_bin="${SMARTPROP_NEWSLETTER_PSQL_BIN:?test psql path is required}"
    systemctl_bin="${SMARTPROP_NEWSLETTER_SYSTEMCTL_BIN:?test systemctl path is required}"
    stat_bin="${SMARTPROP_NEWSLETTER_STAT_BIN:?test stat path is required}"
    BUN_BIN="${SMARTPROP_NEWSLETTER_BUN_BIN:?test Bun path is required}"
    waha_api_key="${SMARTPROP_NEWSLETTER_TEST_WAHA_API_KEY:?test WAHA API key is required}"
  else
    app_dir=/opt/smartprop/app/smartprop
    log_dir=/opt/smartprop/logs/newsletter
    db_env=/etc/smartprop/newsletter-db.env
    actual_hostname="$(hostname -s)"
    now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    curl_bin=/usr/bin/curl
    psql_bin=/usr/bin/psql
    systemctl_bin=/usr/bin/systemctl
    stat_bin=/usr/bin/stat
    BUN_BIN="${SMARTPROP_NEWSLETTER_BUN_BIN:-/root/.bun/bin/bun}"
    waha_api_key=''
    while IFS= read -r env_line || [[ -n "$env_line" ]]; do
      case "$env_line" in
        WAHA_API_KEY=*) waha_api_key="${env_line#WAHA_API_KEY=}" ;;
      esac
    done < "$app_dir/.env.local"
  fi

  [[ -n "$waha_api_key" ]] || fail 'WAHA API key is missing'

  [[ "$actual_hostname" == "$EXPECTED_HOSTNAME" ]] || fail 'hostname mismatch'
  [[ "$expected_revision" =~ ^[0-9a-fA-F]{7,64}$ ]] || fail 'expected revision format is invalid'
  [[ -s "$app_dir/.deploy-source-revision" ]] || fail 'missing deploy source revision'
  local revision
  revision="$(tr -d '\r\n' < "$app_dir/.deploy-source-revision")"
  [[ "$revision" =~ ^[0-9a-fA-F]{7,64}$ ]] || fail 'deploy source revision format is invalid'
  [[ "$revision" == "$expected_revision" ]] || fail 'deploy source revision does not match expected revision'
  printf 'sourceRevision=%s\n' "$revision"

  local expected_run_date health
  expected_run_date="$(singapore_date "$now")"
  health="$("$curl_bin" --fail --silent --show-error http://127.0.0.1:3000/api/health)"
  printf '%s\n' "$health"
  printf '%s' "$health" | \
    VERIFY_EXPECT="$expect" \
    VERIFY_EXPECTED_REVISION="$expected_revision" \
    VERIFY_EXPECTED_RUN_DATE="$expected_run_date" \
    VERIFY_FRESHNESS_MINUTES="$freshness_minutes" \
    VERIFY_NOW="$now" \
    "$BUN_BIN" -e '
const value = JSON.parse(await Bun.stdin.text());
const check = value?.checks?.newsletter;
const valuation = value?.checks?.newsletterValuation;
const expected = process.env.VERIFY_EXPECT;
const expectedRevision = process.env.VERIFY_EXPECTED_REVISION;
const expectedRunDate = process.env.VERIFY_EXPECTED_RUN_DATE;
const freshnessMinutes = Number(process.env.VERIFY_FRESHNESS_MINUTES);
const now = new Date(process.env.VERIFY_NOW);
if (!check || !valuation || !Number.isInteger(freshnessMinutes) || freshnessMinutes <= 0 || Number.isNaN(now.getTime())) process.exit(1);
for (const key of ["status", "enabled", "sourceRevision", "latestRunDate", "latestRunStatus", "lastHeartbeatAt", "lastMeaningfulWorkAt", "freshnessMinutes", "attempted", "accepted", "unknown", "wahaReady"]) {
  if (!(key in check)) process.exit(1);
}
for (const key of ["state", "enabled", "sourceRevision", "currentRunDate", "currentRunStatus", "lastHeartbeatAt", "lastMeaningfulWorkAt", "candidateCount", "projectCount", "acceptedCount", "rejectedCount", "blockedCount", "failedCount", "newestAcceptedCacheAt", "latestLocalFailure", "rollingAcceptedImports", "rollingCompletedItems", "rollingAcceptedImportRate", "freshnessMinutes", "blocker"]) {
  if (!(key in valuation)) process.exit(1);
}
if (!/^[0-9a-f]{7,64}$/i.test(check.sourceRevision || "") || check.sourceRevision !== expectedRevision) process.exit(1);
if (check.freshnessMinutes !== freshnessMinutes) process.exit(1);
const fresh = (timestamp) => {
  if (!timestamp) return false;
  const age = now.getTime() - Date.parse(timestamp);
  return Number.isFinite(age) && age >= 0 && age <= freshnessMinutes * 60_000;
};
if (expected === "staged") {
  if (check.status !== "quiet" || check.enabled !== false ||
      valuation.state !== "disabled" || valuation.enabled !== false) process.exit(1);
} else {
  const completedQuiet = check.status === "quiet" && check.latestRunStatus === "completed" && check.latestRunDate === expectedRunDate;
  const activeFresh = check.status === "healthy" && fresh(check.lastHeartbeatAt) && fresh(check.lastMeaningfulWorkAt);
  const valuationTerminal = valuation.currentRunDate === expectedRunDate &&
    ["completed", "quiet"].includes(valuation.currentRunStatus) &&
    ["healthy", "quiet"].includes(valuation.state);
  const valuationLinked = valuation.acceptedCount === 0 || Boolean(valuation.newestAcceptedCacheAt);
  if (check.enabled !== true || check.wahaReady !== true || (!completedQuiet && !activeFresh) ||
      valuation.enabled !== true || !valuationTerminal || !valuationLinked ||
      valuation.latestLocalFailure !== null || valuation.rollingAcceptedImports < 1 ||
      valuation.rollingCompletedItems < valuation.rollingAcceptedImports ||
      !(valuation.rollingAcceptedImportRate > 0 && valuation.rollingAcceptedImportRate <= 1)) process.exit(1);
}
' || fail 'newsletter health revision or freshness verification failed'

  local session
  session="$("$curl_bin" --fail --silent --show-error --header "X-Api-Key: $waha_api_key" http://127.0.0.1:3030/api/sessions/default)"
  printf '%s' "$session" | "$BUN_BIN" -e '
const value = JSON.parse(await Bun.stdin.text());
process.exit(value?.status === "WORKING" ? 0 : 1);
' || fail 'WAHA default session is not WORKING'

  [[ -f "$db_env" ]] || fail 'missing newsletter database environment file'
  [[ "$("$stat_bin" -c %U "$db_env")" == root ]] || fail 'newsletter database environment file must be root-owned'
  [[ "$("$stat_bin" -c %a "$db_env")" == 600 ]] || fail 'newsletter database environment file must be mode 0600'
  local -a db_lines=()
  local db_line
  while IFS= read -r db_line || [[ -n "$db_line" ]]; do
    db_lines+=("$db_line")
  done < "$db_env"
  [[ "${#db_lines[@]}" -eq 1 ]] || fail 'database environment file must contain exactly one assignment'
  [[ "${db_lines[0]}" =~ ^SMARTPROP_NEWSLETTER_DATABASE_URL=(postgres(ql)?://[^[:space:]]+)$ ]] \
    || fail 'database environment assignment is invalid'
  local database_url="${BASH_REMATCH[1]}"

  local database_sql database_json
  local baseline_real baseline_test baseline_attempts
  baseline_real="${SMARTPROP_NEWSLETTER_STAGED_BASELINE_REAL_SENDS:-}"
  baseline_test="${SMARTPROP_NEWSLETTER_STAGED_BASELINE_TEST_SENDS:-}"
  baseline_attempts="${SMARTPROP_NEWSLETTER_STAGED_BASELINE_PROVIDER_ATTEMPTS:-}"
  if [[ "$expect" == staged ]]; then
    [[ "$baseline_real" =~ ^[0-9]+$ && "$baseline_test" =~ ^[0-9]+$ && "$baseline_attempts" =~ ^[0-9]+$ ]] \
      || fail 'staged no-send baselines are required'
  fi
  database_sql="$(cat <<'SQL'
BEGIN READ ONLY;
WITH schema_contract AS (
  SELECT
    to_regclass('public.newsletter_runs') IS NOT NULL
    AND to_regclass('public.newsletter_sends') IS NOT NULL
    AND to_regclass('public.newsletter_operator_reports') IS NOT NULL
    AND to_regclass('public.newsletter_suppressions') IS NOT NULL
    AND to_regclass('public.newsletter_suppression_events') IS NOT NULL
    AND to_regclass('public.newsletter_valuation_runs') IS NOT NULL
    AND to_regclass('public.newsletter_valuation_items') IS NOT NULL
    AND to_regclass('public.propnex_valuations') IS NOT NULL
    AND to_regprocedure('public.claim_newsletter_run(text)') IS NOT NULL
    AND to_regprocedure('public.queue_newsletter_attempt(uuid,uuid,text,text,jsonb)') IS NOT NULL
    AND to_regprocedure('public.start_newsletter_attempt(uuid,integer,text)') IS NOT NULL
    AND to_regprocedure('public.finalize_newsletter_attempt(uuid,text,text,text,boolean)') IS NOT NULL
    AND to_regprocedure('public.record_accepted_newsletter_recovery(uuid,text,text)') IS NOT NULL
    AND to_regprocedure('public.finalize_newsletter_operator_report(uuid,text,text,text)') IS NOT NULL
    AND to_regprocedure('public.recover_stale_newsletter_operator_reports(uuid,timestamp with time zone)') IS NOT NULL
    AND to_regprocedure('public.record_newsletter_opt_out(text,text,text)') IS NOT NULL
    AND to_regprocedure('public.resolve_newsletter_unknown(uuid,text,text,text)') IS NOT NULL
    AND to_regprocedure('public.create_newsletter_test_send(uuid,uuid,text,text,jsonb)') IS NOT NULL
    AND to_regprocedure('public.finalize_newsletter_test_send(uuid,text,text,text,boolean)') IS NOT NULL
    AND to_regprocedure('public.claim_newsletter_run(text,uuid)') IS NOT NULL
    AND to_regprocedure('public.claim_newsletter_valuation_run(text,text)') IS NOT NULL
    AND to_regprocedure('public.heartbeat_newsletter_valuation_run(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.record_newsletter_valuation_item(uuid,uuid,uuid,jsonb)') IS NOT NULL
    AND to_regprocedure('public.complete_newsletter_valuation_run(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.get_newsletter_valuation_gate(uuid)') IS NOT NULL AS ok
), current_run AS (
  SELECT * FROM newsletter_runs
  WHERE run_date = (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::date
  ORDER BY created_at DESC
  LIMIT 1
), report_counts AS (
  SELECT
    count(DISTINCT operator_key)::integer AS operators,
    count(*)::integer AS total,
    count(*) FILTER (WHERE status IN ('sent','failed','unknown'))::integer AS terminal,
    count(*) FILTER (WHERE status = 'sent')::integer AS accepted
  FROM newsletter_operator_reports
  WHERE run_id = (SELECT id FROM current_run)
), all_time AS (
  SELECT
    count(*) FILTER (WHERE is_test = false AND attempt_started_at IS NOT NULL)::integer AS attempted,
    count(*) FILTER (WHERE is_test = false AND status = 'sent')::integer AS accepted
  FROM newsletter_sends
), current_valuation_run AS (
  SELECT * FROM newsletter_valuation_runs
  WHERE run_date = (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::date
  ORDER BY created_at DESC
  LIMIT 1
), valuation_link AS (
  SELECT
    count(*) FILTER (WHERE item.status = 'accepted')::integer AS accepted_items,
    count(*) FILTER (
      WHERE item.status = 'accepted'
        AND item.cache_valuation_id IS NOT NULL
        AND valuation.id = item.cache_valuation_id
        AND valuation.evidence_item_id = item.id
        AND valuation.evidence_status = 'accepted'
        AND valuation.evidence_contract_version = 'chloe-valuation-v1'
        AND valuation.validated_confidence IN ('medium','high')
        AND valuation.expires_at > clock_timestamp()
    )::integer AS linked_items
  FROM newsletter_valuation_items AS item
  LEFT JOIN propnex_valuations AS valuation ON valuation.id = item.cache_valuation_id
  WHERE item.run_id = (SELECT id FROM current_valuation_run)
), rolling_valuation AS (
  SELECT
    count(*) FILTER (WHERE status = 'accepted')::integer AS accepted,
    count(*)::integer AS completed
  FROM newsletter_valuation_items
  WHERE status IN ('accepted','rejected','blocked','failed')
    AND recorded_at >= clock_timestamp() - INTERVAL '30 days'
), send_totals AS (
  SELECT
    count(*) FILTER (WHERE is_test = false)::integer AS real_sends,
    count(*) FILTER (WHERE is_test = true)::integer AS test_sends,
    count(*) FILTER (WHERE attempt_started_at IS NOT NULL)::integer AS provider_attempts
  FROM newsletter_sends
)
SELECT json_build_object(
  'schemaOk', (SELECT ok FROM schema_contract),
  'currentRunExists', EXISTS (SELECT 1 FROM current_run),
  'runDate', (SELECT run_date::text FROM current_run),
  'runStatus', (SELECT status FROM current_run),
  'selected', COALESCE((SELECT selected_count FROM current_run), 0),
  'attempted', COALESCE((SELECT attempted_count FROM current_run), 0),
  'accepted', COALESCE((SELECT sent_count FROM current_run), 0),
  'failed', COALESCE((SELECT failed_count FROM current_run), 0),
  'unknown', COALESCE((SELECT unknown_count FROM current_run), 0),
  'skipped', COALESCE((SELECT skipped_count FROM current_run), 0),
  'reportOperators', (SELECT operators FROM report_counts),
  'reportTotal', (SELECT total FROM report_counts),
  'reportTerminal', (SELECT terminal FROM report_counts),
  'reportAccepted', (SELECT accepted FROM report_counts),
  'allTimeAttempted', (SELECT attempted FROM all_time),
  'allTimeAccepted', (SELECT accepted FROM all_time),
  'valuationRunExists', EXISTS (SELECT 1 FROM current_valuation_run),
  'valuationRunDate', (SELECT run_date::text FROM current_valuation_run),
  'valuationRunStatus', (SELECT status FROM current_valuation_run),
  'valuationCandidates', COALESCE((SELECT candidate_count FROM current_valuation_run), 0),
  'valuationAccepted', COALESCE((SELECT accepted_count FROM current_valuation_run), 0),
  'valuationRejected', COALESCE((SELECT rejected_count FROM current_valuation_run), 0),
  'valuationBlocked', COALESCE((SELECT blocked_count FROM current_valuation_run), 0),
  'valuationFailed', COALESCE((SELECT failed_count FROM current_valuation_run), 0),
  'valuationCacheLinked', COALESCE((SELECT accepted_items > 0 AND accepted_items = linked_items FROM valuation_link), false),
  'rollingValuationAccepted', COALESCE((SELECT accepted FROM rolling_valuation), 0),
  'rollingValuationCompleted', COALESCE((SELECT completed FROM rolling_valuation), 0),
  'realSendRows', COALESCE((SELECT real_sends FROM send_totals), 0),
  'testSendRows', COALESCE((SELECT test_sends FROM send_totals), 0),
  'providerAttemptRows', COALESCE((SELECT provider_attempts FROM send_totals), 0)
)::text;
COMMIT;
SQL
)"
  database_json="$(PGOPTIONS='-c default_transaction_read_only=on' "$psql_bin" "$database_url" -XqAt -v ON_ERROR_STOP=1 -c "$database_sql")"
  printf '%s' "$database_json" | \
    VERIFY_EXPECT="$expect" VERIFY_EXPECTED_RUN_DATE="$expected_run_date" \
    VERIFY_BASELINE_REAL="$baseline_real" VERIFY_BASELINE_TEST="$baseline_test" \
    VERIFY_BASELINE_ATTEMPTS="$baseline_attempts" "$BUN_BIN" -e '
const value = JSON.parse(await Bun.stdin.text());
if (value.schemaOk !== true) process.exit(1);
const numeric = ["selected", "attempted", "accepted", "failed", "unknown", "skipped", "reportOperators", "reportTotal", "reportTerminal", "reportAccepted", "allTimeAttempted", "allTimeAccepted", "valuationCandidates", "valuationAccepted", "valuationRejected", "valuationBlocked", "valuationFailed", "rollingValuationAccepted", "rollingValuationCompleted", "realSendRows", "testSendRows", "providerAttemptRows"];
if (numeric.some((key) => !Number.isInteger(value[key]) || value[key] < 0)) process.exit(1);
if (process.env.VERIFY_EXPECT !== "live") {
  if (value.realSendRows !== Number(process.env.VERIFY_BASELINE_REAL) ||
      value.testSendRows !== Number(process.env.VERIFY_BASELINE_TEST) ||
      value.providerAttemptRows !== Number(process.env.VERIFY_BASELINE_ATTEMPTS)) process.exit(1);
  console.log(`stagedNoSendCounts=${value.realSendRows}|${value.testSendRows}|${value.providerAttemptRows}`);
  process.exit(0);
}
if (!value.currentRunExists || value.runDate !== process.env.VERIFY_EXPECTED_RUN_DATE || value.runStatus !== "completed") process.exit(1);
if (value.selected > 5 || value.attempted > 5 || value.accepted + value.failed + value.unknown !== value.attempted) process.exit(1);
if (value.selected !== value.attempted + value.skipped || value.unknown !== 0) process.exit(1);
if (value.reportOperators < 1 || value.reportOperators > 2 || value.reportTotal !== value.reportOperators * (value.selected + 1)) process.exit(1);
if (value.reportTerminal !== value.reportTotal || value.reportAccepted !== value.reportTotal) process.exit(1);
if (value.allTimeAttempted < 1 || value.allTimeAccepted < 1 || value.allTimeAccepted > value.allTimeAttempted) process.exit(1);
if (!value.valuationRunExists || value.valuationRunDate !== process.env.VERIFY_EXPECTED_RUN_DATE ||
    !["completed", "quiet"].includes(value.valuationRunStatus)) process.exit(1);
if (value.valuationCandidates > 0 && (value.valuationAccepted < 1 || value.valuationCacheLinked !== true)) process.exit(1);
if (value.rollingValuationAccepted < 1 || value.rollingValuationCompleted < value.rollingValuationAccepted) process.exit(1);
console.log(`latestRun=${value.runDate}|${value.runStatus}|${value.attempted}|${value.accepted}|${value.unknown}`);
console.log(`operatorReports=${value.reportAccepted}/${value.reportTotal}`);
console.log(`allTimeAccepted=${value.allTimeAccepted} allTimeAttempted=${value.allTimeAttempted}`);
console.log(`allTimeSuccessRate=${(value.allTimeAccepted / value.allTimeAttempted * 100).toFixed(2)}%`);
console.log(`valuationRun=${value.valuationRunDate}|${value.valuationRunStatus}|${value.valuationAccepted}`);
console.log(`valuationAcceptedRate=${(value.rollingValuationAccepted / value.rollingValuationCompleted * 100).toFixed(2)}%`);
' || fail 'newsletter schema, current run, reports, or success-rate verification failed'

  local timer_enabled timer_active service_state
  timer_enabled="$("$systemctl_bin" is-enabled smartprop-whatsapp-newsletter.timer 2>/dev/null || true)"
  timer_active="$("$systemctl_bin" is-active smartprop-whatsapp-newsletter.timer 2>/dev/null || true)"
  service_state="$("$systemctl_bin" is-active smartprop-whatsapp-newsletter.service 2>/dev/null || true)"
  printf 'timerEnabled=%s timerActive=%s serviceActive=%s\n' "$timer_enabled" "$timer_active" "$service_state"
  if [[ "$expect" == staged ]]; then
    [[ "$timer_enabled" == disabled && "$timer_active" == inactive ]] || fail 'staged mode requires disabled/inactive timer'
  else
    [[ "$timer_enabled" == enabled && "$timer_active" == active ]] || fail 'live mode requires enabled/active timer'
  fi

  [[ -d "$log_dir" ]] || fail 'newsletter log directory is absent'
  [[ "$("$stat_bin" -c %a "$log_dir")" == 700 ]] || fail 'newsletter log directory is not mode 0700'
  local artifact
  while IFS= read -r -d '' artifact; do
    [[ "$("$stat_bin" -c %a "$artifact")" == 600 ]] || fail 'newsletter artifact is not mode 0600'
  done < <(find "$log_dir" -type f -name '*.json' ! -name run.lock -print0)
VERIFY_LOG_DIR="$log_dir" "$BUN_BIN" -e '
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
const cutoff = Date.now() - 2_592_000_000;
async function verifyRetention(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await verifyRetention(path);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "run.lock") continue;
    if ((await stat(path)).mtimeMs <= cutoff) process.exit(1);
  }
}
await verifyRetention(process.env.VERIFY_LOG_DIR);
' || fail 'newsletter artifact retention exceeds 43200 minutes'
}

for argument in "$@"; do
  case "$argument" in
    --expect=staged) EXPECT=staged ;;
    --expect=live) EXPECT=live ;;
    --expected-revision=*) EXPECTED_REVISION="${argument#*=}" ;;
    --freshness-minutes=*) FRESHNESS_MINUTES="${argument#*=}" ;;
    --remote) MODE=remote ;;
    --local-test) MODE=local ;;
    *) usage ;;
  esac
done

[[ "$EXPECTED_REVISION" =~ ^[0-9a-fA-F]{7,64}$ ]] || usage
[[ "$FRESHNESS_MINUTES" =~ ^[0-9]+$ ]] && (( FRESHNESS_MINUTES > 0 && FRESHNESS_MINUTES <= 1440 )) || usage

case "$MODE" in
  local)
    [[ "${SMARTPROP_NEWSLETTER_VERIFIER_TEST_MODE:-0}" == 1 ]] || usage
    verify_target "$EXPECT" "$EXPECTED_REVISION" "$FRESHNESS_MINUTES" 1
    ;;
  remote)
    verify_target "$EXPECT" "$EXPECTED_REVISION" "$FRESHNESS_MINUTES" 0
    ;;
  controller)
    ssh -p "$PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" \
      "$REMOTE_SCRIPT" --remote --expect="$EXPECT" --expected-revision="$EXPECTED_REVISION" --freshness-minutes="$FRESHNESS_MINUTES"
    ;;
esac
