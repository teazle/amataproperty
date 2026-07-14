# Chloe Valuation Refresh Operations

This runbook covers the valuation-preparation stage for the approved daily
ViewProperty WhatsApp newsletter. Chloe researches project-level evidence; she
does not choose recipients, call WAHA, update send state, or send messages.

## Protected targets

- SmartProp: Contabo `vmi3201429`, `109.123.239.107:2222`, Singapore,
  `/opt/smartprop/app/smartprop`.
- Chloe/OpenClaw: Contabo Asia Singapore `vmi3136623`, `194.233.94.3`,
  `/root/.openclaw/workspace`.
- Expected staging impact: additive migration `020`, restricted SSH files,
  disabled Chloe cron, disabled send timer, and disabled monitor timer. No real
  or test WhatsApp send is part of staging.

Before every state-changing command, re-check hostname, public IP, port,
resource ID, region, and the expected impact above.

## Backup and restore gate

1. Back up the SmartProp runtime, `.env.local`, `/etc/smartprop`, existing
   systemd units, SSH configuration, and the current database schema/data.
2. Back up Chloe's OpenClaw config, cron store, workspace skill, SSH config,
   private key, and `known_hosts` entry without printing key material.
3. Restore the database backup into an isolated disposable PostgreSQL instance.
   Apply a read-only row/schema check there. A backup that has not passed this
   restore test does not satisfy the deployment gate.
4. Record backup paths, hashes, UTC timestamps, and restore-test evidence in the
   deployment record. Do not place secrets in that record.

## Staged installation

1. Deploy the reviewed source revision to SmartProp with both
   `smartprop-whatsapp-newsletter.timer` and
   `smartprop-newsletter-monitor.timer` disabled and inactive.
2. Apply `migrations/020_add_chloe_valuation_refresh.sql`, then run
   `scripts/valuation-refresh-schema-assertions.sql` in a transaction. Stop on
   any assertion failure.
3. Populate the active CRM project's server-owned valuation location, property
   type, tenure, and area distribution with the local-only
   `set-project-profile` command. This command is never available over SSH.
4. Generate a dedicated Ed25519 key on Chloe. Transfer only its public key to
   SmartProp and run `scripts/install-smartprop-valuation-ssh.sh PUBLIC_KEY_FILE`.
   The installer creates a locked-password account, root-owned forced key,
   source-IP restriction `194.233.94.3`, exact sudo rule, and independently
   validating launcher.
5. On Chloe, pin the reviewed SmartProp host key for
   `[109.123.239.107]:2222`. Configure SSH alias `smartprop-valuation` with
   `HostName 109.123.239.107`, `Port 2222`, `User smartprop-valuation`, the
   dedicated identity, `IdentitiesOnly yes`, `StrictHostKeyChecking yes`,
   `BatchMode yes`, and no forwarding. Compare the fingerprint out of band
   before accepting it.
6. Deploy `openclaw-skills/smartprop-crm` to Chloe. Set
   `CHLOE_VALUATION_ALERT_TO` in the operator environment and run
   `scripts/install-chloe-valuation-job.sh`. Confirm exactly one job exists and
   remains disabled with one-failure WhatsApp alerts.
7. Run `verify-chloe-valuation-job.sh --expect=staged
   --expected-prompt-sha256=HASH`. Retain only its redacted job ID, enabled
   state, prompt hash, and last-run status.

## No-send controlled proof

Capture database counts for all `newsletter_sends`, real sends, test sends, and
rows with `attempt_started_at` before the proof. Then:

1. Run restricted `queue --json`; verify at most five redacted candidates and
   no name, phone, email, note, or address data.
2. Research one controlled project with two independent registered sources,
   heartbeat during work, import the evidence over standard input, and run
   `complete`. Verify the item is accepted and linked to exactly one current
   contract cache row for the exact project slug.
3. Run the campaign `run --dry-run --json`. Confirm the rendered valuation and
   STOP wording. Do not run the real campaign command.
4. Re-read all captured send counts. Every real/test ledger count and every
   `attempt_started_at` count must be unchanged. A dry run that changes any
   counter fails staging.
5. Run `verify-newsletter-campaign.sh --expect=staged
   --expected-revision=REVISION` and the staged Chloe verifier. Both must pass.

The separately approved controlled `test-send` to `+6591051399` is the only real
provider submission allowed before go-live. Run it only after the no-send proof.
Verify its test ledger row, WAHA provider ID, unchanged source-lead CRM state,
STOP persistence, and the exact operator report. Do not add the operator number
to CRM.

## Go-live gate

1. Configure and prove the external receiver using
   `test-newsletter-absence-alert.sh`. Retain its exact `checkId`, `alertId`, and
   parseable `receivedAt`; HTTP 2xx without receiver confirmation fails.
2. Install the monitor units. The receiver must expect check name
   `smartprop-whatsapp-newsletter-heartbeat` at 01:22, 01:37, 01:52, 02:07, and
   02:22 UTC with a 20-minute missing-check policy, and must independently alert
   the same operator when a check is absent.
3. Enable the Chloe valuation job first. Verify exact schedule, isolated
   session, tools, timeout, prompt hash, enabled state, one-failure alert, and a
   successful run.
4. Enable the WhatsApp send timer and monitor timer. Prove exact next elapse.
   Run the monitor service once against a fixture verifier failure and confirm
   the matching receiver alert, then restore the fixed verifier and confirm a
   success check-in. Disable the monitor only inside an approved receiver test
   window and prove the missing-check alert before re-enabling it.
5. Verify the live health surfaces, current terminal valuation run, item/cache
   linkage, WAHA `WORKING`, STOP handling, operator reports, and nonzero rolling
   accepted-import and production-send success rates.
6. Reboot survival requires a separately approved maintenance reboot of each
   exact host. Afterward, prove the SmartProp timers enabled/active, OpenClaw
   gateway healthy, Chloe cron enabled with the same ID and prompt revision, and
   both read-only verifiers passing. Without reboot evidence, report deployed
   but not production-ready.

## Rollback

1. Disable the Chloe valuation job, send timer, and monitor timer. Confirm they
   are disabled/inactive before changing files.
2. Preserve all valuation run/item/cache rows, send history, suppressions,
   provider IDs, and operator reports. Never delete or rewrite audit history.
3. Restore backed-up runtime, environment, SSH, skill, cron, and unit files.
   Remove the dedicated key only after both schedulers are disabled and the
   rollback path has been verified.
4. Migration `020` is additive. Do not drop its tables or columns during an
   incident rollback. Keep the send gate closed and reconcile schema separately.
5. Run both staged verifiers and record remaining unverified items explicitly.
