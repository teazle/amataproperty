# WhatsApp Newsletter Operations

This runbook controls a five-recipient daily WhatsApp campaign. Deployment alone does not make it live. None of the backup, migration, relink, alert, or controlled-send prerequisites below are claimed as currently satisfied.

## Schedule, freshness, and exit contract

The timer starts at **01:30 UTC (09:30 SGT)**. Exit 10 is retryable only before **10:30 SGT**. At or after the cutoff, exit 10 is recorded as blocked and mapped to success. Lock contention is also success. Exit 20, exit 30, and unexpected runner failures require manual attention and are prevented from restarting by systemd.

Set `SMARTPROP_NEWSLETTER_FRESHNESS_MINUTES=30` in the application environment. A running campaign is stale when its heartbeat is more than 30 minutes old. A completed current-day campaign becomes `quiet` after that threshold; the old heartbeat remains visible but is never reported as healthy.

`SMARTPROP_NEWSLETTER_ENABLED=1` permits campaign execution. Any other value disables lead sending.

## Prerequisites

Record evidence for every item before go-live:

- A current DB backup and tested restore, including backup path, size, timestamp, and scratch-restore result.
- Migration `019_add_whatsapp_newsletter_campaign.sql`, including all campaign ledgers and secured RPCs.
- WAHA session `default` reporting exactly `WORKING`.
- Valid `SMARTPROP_NEWSLETTER_REPORT_TO`, `SMARTPROP_NEWSLETTER_TEST_TO`, and webhook secret settings.
- A root-owned mode-0600 verifier file containing exactly one line and no `export`, comments, or shell syntax:

```text
SMARTPROP_NEWSLETTER_DATABASE_URL=postgresql://readonly-role:password@host/database
```

The database role must be read-only. The verifier also opens an explicit `BEGIN READ ONLY` transaction.

## Clean staged installation

Use the reviewed revision as the explicit identity throughout:

```bash
EXPECTED_REVISION=<reviewed-commit-sha>
sudo install -d -m 0700 /opt/smartprop/logs/newsletter
sudo install -o root -g root -m 0755 scripts/run-whatsapp-newsletter-campaign.sh /opt/smartprop/app/smartprop/scripts/
sudo install -o root -g root -m 0755 scripts/verify-newsletter-campaign.sh /opt/smartprop/app/smartprop/scripts/
sudo install -o root -g root -m 0644 systemd/smartprop-whatsapp-newsletter.service /etc/systemd/system/
sudo install -o root -g root -m 0644 systemd/smartprop-whatsapp-newsletter.timer /etc/systemd/system/
printf '%s\n' "$EXPECTED_REVISION" | sudo tee /opt/smartprop/app/smartprop/.deploy-source-revision >/dev/null
sudo chmod 0600 /opt/smartprop/app/smartprop/.deploy-source-revision
sudo systemd-analyze verify /etc/systemd/system/smartprop-whatsapp-newsletter.service /etc/systemd/system/smartprop-whatsapp-newsletter.timer
sudo systemctl daemon-reload
sudo systemctl is-enabled smartprop-whatsapp-newsletter.timer
sudo systemctl is-active smartprop-whatsapp-newsletter.timer
sudo /opt/smartprop/app/smartprop/scripts/verify-newsletter-campaign.sh --expect=staged --expected-revision="$EXPECTED_REVISION"
```

Installation must not enable or start the service or timer. The timer is intentionally disabled by default and staged verification requires `disabled` plus `inactive`. A clean, empty, mode-0700 newsletter log directory is valid. On macOS, `systemd-analyze` is unavailable; Linux verification remains outstanding until it runs on the staged target.

## Dry-run and controlled ledgered test

Dry-run first and prove no campaign, CRM, or provider counts change:

```bash
cd /opt/smartprop/app/smartprop
/root/.bun/bin/bun scripts/run-whatsapp-newsletter-campaign.ts run --dry-run --json
```

For the controlled test, use one approved source lead and only the configured operator destination. Capture the CRM state and activity count before the send:

```bash
(
set -euo pipefail
umask 0077
WORK_DIR="$(mktemp -d /tmp/newsletter-controlled-test.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM
: "${SMARTPROP_NEWSLETTER_TEST_SOURCE_LEAD_ID:?set this to the approved source lead UUID}"
SOURCE_LEAD_ID="$SMARTPROP_NEWSLETTER_TEST_SOURCE_LEAD_ID"
TEST_TO="$SMARTPROP_NEWSLETTER_TEST_TO"
DB_URL="$(sudo sed -n 's/^SMARTPROP_NEWSLETTER_DATABASE_URL=//p' /etc/smartprop/newsletter-db.env)"
BEFORE="$WORK_DIR/before.txt"
AFTER="$WORK_DIR/after.txt"
psql "$DB_URL" -XqAt -v ON_ERROR_STOP=1 -v lead_id="$SOURCE_LEAD_ID" -c "BEGIN READ ONLY; SELECT status,last_activity_at FROM crm_leads WHERE id = :'lead_id'::uuid; SELECT count(*) FROM crm_lead_activities WHERE lead_id = :'lead_id'::uuid; COMMIT;" > "$BEFORE"
/root/.bun/bin/bun scripts/run-whatsapp-newsletter-campaign.ts test-send --to "$TEST_TO" --lead-id "$SOURCE_LEAD_ID" --json
psql "$DB_URL" -XqAt -v ON_ERROR_STOP=1 -v lead_id="$SOURCE_LEAD_ID" -c "BEGIN READ ONLY; SELECT status,last_activity_at FROM crm_leads WHERE id = :'lead_id'::uuid; SELECT count(*) FROM crm_lead_activities WHERE lead_id = :'lead_id'::uuid; COMMIT;" > "$AFTER"
diff -u "$BEFORE" "$AFTER"
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -v lead_id="$SOURCE_LEAD_ID" -v test_to="$TEST_TO" -c "BEGIN READ ONLY; SELECT id,is_test,override_phone,provider_outcome,(waha_message_id IS NOT NULL) AS provider_id_recorded FROM newsletter_sends WHERE lead_id = :'lead_id'::uuid AND is_test = true ORDER BY created_at DESC LIMIT 1; SELECT count(*) AS operator_crm_rows FROM crm_leads WHERE phone_e164 = :'test_to'; COMMIT;"
)
```

Required result: the test ledger row has `is_test=true`, the configured override, `provider_outcome='sent'`, and a provider ID; the CRM snapshot diff is empty; `operator_crm_rows` is zero.

## STOP disposable-fixture proof

Use only a provisioned disposable Singapore test number owned by the operator. Set it explicitly through `SMARTPROP_NEWSLETTER_STOP_FIXTURE_PHONE`; never invent a plausible fixed number, use a real lead, or reuse the operator-report number. This proof also requires a separately issued owner/migration-level connection in `SMARTPROP_NEWSLETTER_FIXTURE_OWNER_DATABASE_URL`. The command verifies that its connected `current_user` owns (or is a member of the owner role for) every required relation and RPC, or has the exact required table and function privileges, before creating anything.

`SMARTPROP_NEWSLETTER_DATABASE_URL` remains the read-only verifier/query connection. Never use that read-only URL or assume the application `service_role` can insert fixture rows. Do not point the fixture-owner variable at either role unless the privilege check below independently passes. The rollback-only SQL checks every campaign/CRM collision, creates a CRM lead plus a queued attempt, calls the production `record_newsletter_opt_out` RPC twice with the same provider message ID, asserts idempotency and cancellation, and rolls the entire proof back. It sends no WhatsApp message and leaves no ledger row.

```bash
(
set -euo pipefail
umask 0077
STOP_WORK_DIR="$(mktemp -d /tmp/newsletter-stop-proof.XXXXXX)"
trap 'unset FIXTURE_DB_URL; rm -rf "$STOP_WORK_DIR"' EXIT HUP INT TERM
: "${SMARTPROP_NEWSLETTER_STOP_FIXTURE_PHONE:?set this to an owned disposable +65 test number}"
: "${SMARTPROP_NEWSLETTER_FIXTURE_OWNER_DATABASE_URL:?set this to a separately issued owner/migration-level fixture database URL}"
FIXTURE_PHONE="$SMARTPROP_NEWSLETTER_STOP_FIXTURE_PHONE"
FIXTURE_DB_URL="$SMARTPROP_NEWSLETTER_FIXTURE_OWNER_DATABASE_URL"
TEST_TO="$SMARTPROP_NEWSLETTER_TEST_TO"
[[ "$FIXTURE_PHONE" =~ ^\+65[689][0-9]{7}$ ]]
[[ "$FIXTURE_PHONE" != "$TEST_TO" ]]
[[ "$FIXTURE_DB_URL" =~ ^postgres(ql)?://[^[:space:]]+$ ]]
FIXTURE_MESSAGE_ID="stop-fixture-$(date +%s)-$$"
STOP_SQL="$(mktemp "$STOP_WORK_DIR/proof.XXXXXX.sql")"
cat >"$STOP_SQL" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('app.stop_fixture_phone', :'fixture_phone', true);
SELECT set_config('app.stop_fixture_message_id', :'message_id', true);
SELECT set_config('app.stop_fixture_test_to', :'test_to', true);

DO $$
DECLARE
  missing_privileges text;
  opt_out_function oid := to_regprocedure('public.record_newsletter_opt_out(text,text,text)');
BEGIN
  WITH required_relations(relation_name, needs_insert) AS (
    VALUES
      ('crm_projects', true),
      ('newsletter_issues', true),
      ('crm_leads', true),
      ('newsletter_sends', true),
      ('newsletter_suppressions', false),
      ('newsletter_suppression_events', false)
  )
  SELECT string_agg(required_relations.relation_name, ', ' ORDER BY required_relations.relation_name)
  INTO missing_privileges
  FROM required_relations
  LEFT JOIN pg_class AS relation
    ON relation.oid = to_regclass('public.' || required_relations.relation_name)
  WHERE relation.oid IS NULL
     OR NOT (
       pg_has_role(current_user, relation.relowner, 'USAGE')
       OR (
         has_table_privilege(current_user, relation.oid, 'SELECT')
         AND (
           NOT required_relations.needs_insert
           OR has_table_privilege(current_user, relation.oid, 'INSERT')
         )
       )
     );

  IF missing_privileges IS NOT NULL THEN
    RAISE EXCEPTION 'fixture DB role lacks ownership or required table privileges: %', missing_privileges;
  END IF;

  IF opt_out_function IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc AS proc
       WHERE proc.oid = opt_out_function
         AND (
           pg_has_role(current_user, proc.proowner, 'USAGE')
           OR has_function_privilege(current_user, proc.oid, 'EXECUTE')
         )
     ) THEN
    RAISE EXCEPTION 'fixture DB role lacks ownership or EXECUTE on record_newsletter_opt_out';
  END IF;
END;
$$;

DO $$
DECLARE
  fixture_phone text := current_setting('app.stop_fixture_phone');
  test_to text := current_setting('app.stop_fixture_test_to');
BEGIN
  IF fixture_phone = test_to
     OR EXISTS (SELECT 1 FROM crm_leads WHERE phone_e164 = fixture_phone OR regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(fixture_phone, '[^0-9]', '', 'g'))
     OR EXISTS (SELECT 1 FROM newsletter_sends WHERE recipient_key = fixture_phone OR phone = fixture_phone OR override_phone = fixture_phone)
     OR EXISTS (SELECT 1 FROM newsletter_suppressions WHERE recipient_key = fixture_phone)
     OR EXISTS (SELECT 1 FROM newsletter_suppression_events WHERE recipient_key = fixture_phone) THEN
    RAISE EXCEPTION 'STOP fixture collision; choose another provisioned disposable number';
  END IF;
END;
$$;

WITH fixture_project AS (
  INSERT INTO crm_projects (slug, title, source, is_active)
  VALUES ('newsletter-stop-fixture-' || gen_random_uuid(), 'Disposable STOP proof', 'manual-stop-proof', true)
  RETURNING id, slug
), fixture_issue AS (
  INSERT INTO newsletter_issues (slug, status, audience_project_slug, featured_projects, copy_template, created_by, approved_by, approved_at)
  SELECT 'newsletter-stop-issue-' || gen_random_uuid(), 'approved', slug, '[]'::jsonb, 'Disposable STOP proof', 'stop-proof', 'stop-proof', clock_timestamp()
  FROM fixture_project
  RETURNING id
), fixture_lead AS (
  INSERT INTO crm_leads (project_id, name, phone, phone_e164, email, message, property_title, source_path)
  SELECT id, 'Disposable STOP proof', current_setting('app.stop_fixture_phone'), current_setting('app.stop_fixture_phone'),
         'stop-proof@example.invalid', 'Disposable rollback-only fixture', 'Disposable STOP proof', '/ops/stop-proof'
  FROM fixture_project
  RETURNING id
), queued_attempt AS (
  INSERT INTO newsletter_sends (
    issue_id, lead_id, recipient_name, recipient_key, phone, rendered_body,
    valuation_snapshot, status, retryable, is_test
  )
  SELECT fixture_issue.id, fixture_lead.id, 'Disposable STOP proof', current_setting('app.stop_fixture_phone'),
         current_setting('app.stop_fixture_phone'), 'Disposable STOP proof', '{"fixture":true}'::jsonb,
         'queued', true, false
  FROM fixture_issue CROSS JOIN fixture_lead
  RETURNING id
)
SELECT count(*) AS queued_fixture_created FROM queued_attempt;

SELECT (record_newsletter_opt_out(
  current_setting('app.stop_fixture_phone'),
  current_setting('app.stop_fixture_message_id'),
  'STOP'
)).recipient_key AS first_delivery;
SELECT (record_newsletter_opt_out(
  current_setting('app.stop_fixture_phone'),
  current_setting('app.stop_fixture_message_id'),
  'STOP'
)).recipient_key AS repeated_delivery;

DO $$
DECLARE
  fixture_phone text := current_setting('app.stop_fixture_phone');
  message_id text := current_setting('app.stop_fixture_message_id');
BEGIN
  IF (SELECT count(*) FROM newsletter_suppressions WHERE recipient_key = fixture_phone) <> 1
     OR (SELECT count(*) FROM newsletter_suppression_events WHERE recipient_key = fixture_phone AND provider_message_id = message_id) <> 1
     OR (SELECT count(*) FROM newsletter_sends WHERE recipient_key = fixture_phone AND status = 'opted_out') <> 1
     OR (SELECT count(*) FROM newsletter_sends WHERE recipient_key = fixture_phone AND status = 'queued') <> 0
     OR (SELECT count(*) FROM crm_leads WHERE phone_e164 = fixture_phone AND opt_out_at IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'STOP fixture proof failed';
  END IF;
END;
$$;
ROLLBACK;
SQL
psql "$FIXTURE_DB_URL" -X -v ON_ERROR_STOP=1 \
  -v fixture_phone="$FIXTURE_PHONE" \
  -v message_id="$FIXTURE_MESSAGE_ID" \
  -v test_to="$TEST_TO" \
  -f "$STOP_SQL"
)
```

Required result: one queued fixture is created inside the transaction; both RPC calls return the fixture recipient; all assertions pass; and the final command is `ROLLBACK`. The transaction is the deterministic database cleanup. The shell trap removes the private SQL file. Do not replace this with a committed fixture: suppression and attempt ledgers are intentionally immutable.

## Resolve an unknown outcome

Do not automatically retry an unknown recipient. Reconcile provider evidence, then run the complete audited command:

```bash
SEND_ID=<newsletter-send-uuid>
OPERATOR_ID=<operator-identity>
RESOLUTION=sent
REASON='provider dashboard confirms the message was accepted'
/root/.bun/bin/bun scripts/run-whatsapp-newsletter-campaign.ts resolve-unknown --send-id "$SEND_ID" --resolver "$OPERATOR_ID" --resolution "$RESOLUTION" --reason "$REASON" --json
```

`RESOLUTION` must be `sent` or `failed`. Preserve the evidence supporting the choice.

## Enable, verify, and test absence alerting

Only after all staged gates pass:

```bash
SGT_HHMM="$(TZ=Asia/Singapore date +%H%M)"
if (( 10#$SGT_HHMM < 930 )); then
  echo 'before the 09:30 SGT window: leave the timer disabled and rerun this gate at or after 09:30 SGT' >&2
  exit 64
fi
sudo systemctl enable --now smartprop-whatsapp-newsletter.timer
if ! timeout 20m bash -c '
  DB_URL="$1"
  while true; do
    service_state="$(sudo systemctl is-active smartprop-whatsapp-newsletter.service 2>/dev/null || true)"
    service_result="$(sudo systemctl show smartprop-whatsapp-newsletter.service --property=Result --value)"
    terminal="$(psql "$DB_URL" -XqAt -v ON_ERROR_STOP=1 -c "
      BEGIN READ ONLY;
      WITH current_run AS (
        SELECT * FROM newsletter_runs
        WHERE run_date = (clock_timestamp() AT TIME ZONE '\''Asia/Singapore'\'')::date
        ORDER BY created_at DESC LIMIT 1
      ), reports AS (
        SELECT count(*) AS total, count(*) FILTER (WHERE status = '\''sent'\'') AS accepted
        FROM newsletter_operator_reports WHERE run_id = (SELECT id FROM current_run)
      )
      SELECT EXISTS (
        SELECT 1 FROM current_run, reports
        WHERE current_run.status = '\''completed'\''
          AND current_run.unknown_count = 0
          AND reports.total > 0
          AND reports.accepted = reports.total
      );
      COMMIT;")"
    if [[ "$service_state" == inactive && "$service_result" == success && "$terminal" == t ]]; then
      exit 0
    fi
    if [[ "$service_state" == failed || "$service_result" =~ ^(exit-code|signal|timeout|watchdog|resources)$ ]]; then
      exit 1
    fi
    sleep 5
  done
' _ "$DB_URL"; then
  echo 'oneshot or current run/report terminal-state gate did not complete within 20 minutes' >&2
  exit 1
fi
sudo /opt/smartprop/app/smartprop/scripts/verify-newsletter-campaign.sh --expect=live --expected-revision="$EXPECTED_REVISION"
```

The oneshot service may be inactive after completion; the timer must be enabled and active. Live verification requires the current SGT run, coherent counts, zero unknown outcomes, accepted terminal operator reports, and nonzero all-time accepted sends and success rate.

Test the independent absence-alert delivery without changing campaign state:

```bash
curl --fail --show-error --silent -X POST "$SMARTPROP_NEWSLETTER_ALERT_TEST_URL" \
  -H "Authorization: Bearer $SMARTPROP_NEWSLETTER_ALERT_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"check":"smartprop-whatsapp-newsletter-heartbeat","test":true,"reason":"scheduled absence-alert delivery test"}'
```

Record the receiving alert ID and timestamp. A successful HTTP request without a received alert is a failed test.

## Kill switch and rollback

The immediate kill switch is exact and does not delete campaign evidence:

```bash
sudo systemctl disable --now smartprop-whatsapp-newsletter.timer
sudo systemctl is-enabled smartprop-whatsapp-newsletter.timer
sudo systemctl is-active smartprop-whatsapp-newsletter.timer
```

Also set `SMARTPROP_NEWSLETTER_ENABLED=0` in the managed application environment before any manual service invocation. Confirm `/api/health` reports `enabled=false` and `quiet`.

Rollback procedure:

```bash
sudo systemctl disable --now smartprop-whatsapp-newsletter.timer
PREVIOUS_REVISION=<previous-reviewed-commit-sha>
# Restore the reviewed application/unit files from the recorded backup or deploy PREVIOUS_REVISION.
printf '%s\n' "$PREVIOUS_REVISION" | sudo tee /opt/smartprop/app/smartprop/.deploy-source-revision >/dev/null
sudo chmod 0600 /opt/smartprop/app/smartprop/.deploy-source-revision
sudo systemctl daemon-reload
sudo /opt/smartprop/app/smartprop/scripts/verify-newsletter-campaign.sh --expect=staged --expected-revision="$PREVIOUS_REVISION"
```

Preserve immutable run, send, report, suppression, and local status artifacts. Restore database state only from the tested backup under an explicitly approved recovery plan.

The verifier is read-only and pinned to `root@109.123.239.107:2222`, hostname `vmi3201429`. It accepts no target override and performs no send, database write, unit mutation, or install operation.
