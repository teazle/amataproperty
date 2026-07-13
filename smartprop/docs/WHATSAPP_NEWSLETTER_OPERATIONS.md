# WhatsApp Newsletter Operations

This is a controlled, five-recipient daily WhatsApp campaign. It is not live merely because these files are deployed. Do not send real leads until every prerequisite and the controlled test gate below have passed.

## Schedule and safety boundary

The timer starts at **01:30 UTC (09:30 SGT)** every Singapore calendar day. It is persistent, so an overdue start can run when the timer is later enabled. Exit 10 is retryable only before **10:30 SGT**; after that cutoff the wrapper records a blocked artifact and returns service success. Exit 20 and exit 30 require manual attention. A lock-contended run is intentionally a non-error because the existing run owns the day.

`SMARTPROP_NEWSLETTER_ENABLED=1` is the kill-switch-controlled production enablement flag. Set it to any other value to disable sending; the service will report a quiet/blocked condition rather than bypassing campaign controls.

## Required prerequisites

Before installation or go-live, explicitly verify and record all of the following. This runbook does **not** claim any are currently satisfied.

- A current DB backup and tested restore, with timestamp, location, and restore evidence.
- Migration `019_add_whatsapp_newsletter_campaign.sql` applied with its tables and RPCs present.
- Server-side campaign secrets and a root-only read-only DB URL at `/etc/smartprop/newsletter-readonly-db.env` as `SMARTPROP_NEWSLETTER_READONLY_DATABASE_URL`.
- WAHA has been relinked and its configured `default` session reports exactly `WORKING`.
- `SMARTPROP_NEWSLETTER_REPORT_TO` and `SMARTPROP_NEWSLETTER_TEST_TO` are configured; the test number is the approved operator number and is not a CRM lead.
- alerts on absence are independently monitored: alert when the scheduled heartbeat or meaningful work is missing after the window, and test the alert delivery.

## Install without activation

Copy the two unit files and wrapper to the exact app path, then run:

```bash
sudo systemd-analyze verify /etc/systemd/system/smartprop-whatsapp-newsletter.service /etc/systemd/system/smartprop-whatsapp-newsletter.timer
sudo systemctl daemon-reload
sudo systemctl is-enabled smartprop-whatsapp-newsletter.timer
sudo systemctl is-active smartprop-whatsapp-newsletter.timer
```

Installation must not enable or start the timer or service. The service has no install section; the timer is intentionally disabled by default. Confirm it is `disabled` and `inactive` with:

```bash
sudo /opt/smartprop/app/smartprop/scripts/verify-newsletter-campaign.sh --expect=staged
```

On macOS, `systemd-analyze` is unavailable; perform that command only on the Linux target.

## Staged proof

First run a production-data dry-run. It must not create a send, alter CRM activity, or contact WAHA:

```bash
cd /opt/smartprop/app/smartprop
/root/.bun/bin/bun scripts/run-whatsapp-newsletter-campaign.ts run --dry-run --json
```

Then perform one controlled ledgered test to the configured operator number, prove its provider ID and `is_test=true`, and prove the source lead and CRM activity did not change:

```bash
/root/.bun/bin/bun scripts/run-whatsapp-newsletter-campaign.ts test-send --to "$SMARTPROP_NEWSLETTER_TEST_TO" --lead-id <approved-source-lead-id> --json
```

Prove STOP separately with a disposable fixture. Send an exact `STOP`, verify the suppression ledger and queued cancellation, and prove no operator number was inserted into CRM. Never use a real lead or the operator number as this fixture.

## Go live, observe, and verify

Only after the prerequisites and staged proof are recorded may an explicitly approved operator run the one go-live command:

```bash
sudo systemctl enable --now smartprop-whatsapp-newsletter.timer
```

Immediately verify timer state, latest run/report counts, heartbeat and meaningful-work freshness, exact WAHA `WORKING`, source revision, migration objects, log mode/retention, and non-test accepted count:

```bash
sudo /opt/smartprop/app/smartprop/scripts/verify-newsletter-campaign.sh --expect=live
```

The oneshot service need not remain active after completion. The timer must be enabled and active. Its resource limits (`MemoryHigh`, `MemoryMax`, CPU quota, task limit, timeout) are part of the operating boundary, not optional tuning.

## Incidents and rollback

- `unknown` or a recovery-required run: do not retry a recipient. Reconcile provider evidence, then use `resolve-unknown` with the operator identity and reason.
- `blocked`: inspect WAHA session state and campaign configuration. Restore `WORKING` before allowing the next retry.
- `stale`: treat a missing current-day heartbeat after 09:30 SGT as an absence incident; verify timer state, journal output, lock contention, and alert delivery.
- Kill switch: set `SMARTPROP_NEWSLETTER_ENABLED` away from `1`, then verify the next health response reports disabled/quiet. Do not delete ledger data.
- Rollback: disable the timer, preserve the immutable run/send/report artifacts and logs, restore only from a verified backup if data recovery is required, and rerun staged verification before another go-live approval.

The verifier is read-only. It is pinned to `root@109.123.239.107:2222` / `vmi3201429`, rejects alternate targets, and never sends messages, enables units, or changes database state.
