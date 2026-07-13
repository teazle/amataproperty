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
SOURCE_LEAD_ID=<approved-source-lead-uuid>
TEST_TO="$SMARTPROP_NEWSLETTER_TEST_TO"
DB_URL="$(sudo sed -n 's/^SMARTPROP_NEWSLETTER_DATABASE_URL=//p' /etc/smartprop/newsletter-db.env)"
install -m 0600 /dev/null /tmp/newsletter-test-before.txt
psql "$DB_URL" -XqAt -v ON_ERROR_STOP=1 -v lead_id="$SOURCE_LEAD_ID" -c "BEGIN READ ONLY; SELECT status,last_activity_at FROM crm_leads WHERE id = :'lead_id'::uuid; SELECT count(*) FROM crm_lead_activities WHERE lead_id = :'lead_id'::uuid; COMMIT;" > /tmp/newsletter-test-before.txt
/root/.bun/bin/bun scripts/run-whatsapp-newsletter-campaign.ts test-send --to "$TEST_TO" --lead-id "$SOURCE_LEAD_ID" --json
psql "$DB_URL" -XqAt -v ON_ERROR_STOP=1 -v lead_id="$SOURCE_LEAD_ID" -c "BEGIN READ ONLY; SELECT status,last_activity_at FROM crm_leads WHERE id = :'lead_id'::uuid; SELECT count(*) FROM crm_lead_activities WHERE lead_id = :'lead_id'::uuid; COMMIT;" > /tmp/newsletter-test-after.txt
diff -u /tmp/newsletter-test-before.txt /tmp/newsletter-test-after.txt
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -v lead_id="$SOURCE_LEAD_ID" -v test_to="$TEST_TO" -c "BEGIN READ ONLY; SELECT id,is_test,override_phone,provider_outcome,(waha_message_id IS NOT NULL) AS provider_id_recorded FROM newsletter_sends WHERE lead_id = :'lead_id'::uuid AND is_test = true ORDER BY created_at DESC LIMIT 1; SELECT count(*) AS operator_crm_rows FROM crm_leads WHERE phone_e164 = :'test_to'; COMMIT;"
rm -f /tmp/newsletter-test-before.txt /tmp/newsletter-test-after.txt
```

Required result: the test ledger row has `is_test=true`, the configured override, `provider_outcome='sent'`, and a provider ID; the CRM snapshot diff is empty; `operator_crm_rows` is zero.

## STOP disposable-fixture proof

Use a disposable non-operator CRM fixture and a unique provider message ID. Never use a real lead or the operator number.

```bash
FIXTURE_PHONE=6590000001
FIXTURE_MESSAGE_ID="stop-fixture-$(date +%s)"
test "+$FIXTURE_PHONE" != "$TEST_TO"
curl --fail --show-error --silent http://127.0.0.1:3000/api/wa/webhook \
  -H 'Content-Type: application/json' \
  -H "X-WAHA-Webhook-Secret: $WAHA_WEBHOOK_SECRET" \
  --data "{\"from\":\"${FIXTURE_PHONE}@c.us\",\"to\":\"6599999999@c.us\",\"body\":\"STOP\",\"id\":{\"_serialized\":\"${FIXTURE_MESSAGE_ID}\"},\"fromMe\":false}"
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -v phone="+$FIXTURE_PHONE" -v message_id="$FIXTURE_MESSAGE_ID" -v test_to="$TEST_TO" -c "BEGIN READ ONLY; SELECT recipient_key,reason FROM newsletter_suppressions WHERE recipient_key = :'phone'; SELECT count(*) AS event_rows FROM newsletter_suppression_events WHERE recipient_key = :'phone' AND provider_message_id = :'message_id'; SELECT count(*) AS still_queued FROM newsletter_sends WHERE recipient_key = :'phone' AND status = 'queued'; SELECT count(*) AS operator_crm_rows FROM crm_leads WHERE phone_e164 = :'test_to'; COMMIT;"
```

Required result: one suppression, one deduplicated event, zero still-queued sends, and zero operator CRM rows. Remove the disposable CRM fixture only through the approved cleanup workflow after preserving proof.

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
sudo systemctl enable --now smartprop-whatsapp-newsletter.timer
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
