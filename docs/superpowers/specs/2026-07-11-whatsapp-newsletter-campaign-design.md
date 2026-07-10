# Automatic WhatsApp Newsletter Campaign Design

## Status

Approved for implementation by the user on 2026-07-11. The campaign itself is approved and does not require daily human approval.

## Goal

Have Chloe's SmartProp workflow automatically send five personalized ViewProperty.ai WhatsApp newsletter messages per Singapore calendar day, update the CRM after every attempt, respect STOP opt-outs, and report the exact recipient-to-message mapping to approved operators.

## Existing System

- SmartProp is a Next.js/Bun application backed by Supabase.
- CRM import and lead management already exist under `/admin/crm`.
- `newsletter_issues`, `newsletter_sends`, and `propnex_valuations` already provide campaign, delivery-ledger, and valuation-cache scaffolding.
- `composeNewsletter()` produces the approved BUY, SELL, REFI, CALL, COFFEE, and STOP copy.
- Production uses WAHA when `SMARTPROP_WHATSAPP_PROVIDER=waha`.
- Exact-match STOP handling has been deployed but is not committed to `main`; this implementation must bring it into durable source with tests.
- Production currently has one approved Cliften campaign, 36 leads in that audience, one failed send from the earlier blocked attempt, and five project-matching valuation rows. WAHA remains at `SCAN_QR_CODE`, so live delivery cannot start until an authorized phone relinks it.

## Decisions

### Campaign ownership

SmartProp and Supabase own campaign truth. Chloe operates the existing CRM, but lead selection, delivery state, opt-out enforcement, and daily limits are deterministic code rather than free-form agent decisions.

The active campaign is the oldest `approved` or `sending` newsletter issue. Its `audience_project_slug` is the approved audience boundary. Leads are not copied into a second contact store.

### Daily operation

A systemd timer starts one runner daily at 10:30 SGT. The runner:

1. Resolves the approved campaign and verifies WAHA is `WORKING` before any lead send.
2. Creates or resumes one unique run for the Singapore date.
3. Selects at most five unique recipients for that run.
4. Sends sequentially with a 60-second gap.
5. Updates the newsletter ledger and CRM immediately after each attempt.
6. Sends an operator summary and the exact content for each selected recipient.

The daily cap is five unique lead recipients. Operator report messages do not count toward that cap. A repeated timer or manual rerun resumes the same run and cannot select a second set of five.

### Eligibility

A lead is eligible only when all conditions hold:

- the issue is `approved` or `sending`;
- the lead belongs to the issue's active audience project;
- `opt_out_at IS NULL`;
- CRM status is not `lost`;
- the phone normalizes to a valid Singapore E.164 number;
- no `sent` or `unknown` row exists for the same issue and normalized recipient;
- a fresh valuation can be resolved for the lead's project;
- the lead has not already been selected in another run for the issue.

Selection order is deterministic: failed recipients that are safe to retry first, then priority `high`, `normal`, `low`, followed by `created_at ASC` and `id ASC`.

### Valuation resolution

The current CRM records identify the project but do not contain a reliable unit-to-valuation key. The runner must not pretend it has a unit-specific match.

For an audience project, it resolves fresh `propnex_valuations` rows whose `project_name` matches the CRM project title. It creates a project-level snapshot using the minimum supported low value, median supported midpoint, maximum supported high value, total comparable count, and newest `as_of` date. The rendered copy remains an indicative project/property update. The exact snapshot used is stored on `newsletter_sends`.

If no supported current valuation exists, the lead is skipped and no WhatsApp message is sent.

### Idempotency and delivery certainty

Add `newsletter_runs` with a unique `(issue_id, run_date)` constraint. Each send row snapshots recipient name, normalized recipient key, phone, exact body, valuation, run, and attempt metadata.

Allowed send states are:

- `queued -> sending -> sent`
- `queued -> opted_out | skipped`
- `sending -> failed` for a definite provider rejection
- `sending -> unknown` for a timeout, process loss, or ambiguous network result

`unknown` is never retried automatically because the provider may have accepted the message. Definite `failed` rows may be retried on a later day, up to three attempts. The unique issue/recipient constraint prevents duplicate CRM rows with the same phone from receiving the same campaign.

The runner uses an atomic database claim function and a process lock. This prevents concurrent systemd/manual executions from exceeding the daily cap.

### CRM updates

For every accepted send:

- write `sent`, provider message ID, and timestamp to `newsletter_sends`;
- change CRM status from `new` to `contacted` without overwriting later-stage statuses;
- update `last_activity_at`;
- insert a CRM activity with campaign/run metadata and the send-ledger ID.

Failures and ambiguous results also receive CRM activities without changing the lead's sales status.

Incoming exact STOP keywords update `crm_leads.opt_out_at`, `opt_out_reason`, and CRM activity history before the conversational engine runs. Queued future rows for that lead are marked `opted_out`.

### Operator report

Report recipients come from `SMARTPROP_NEWSLETTER_REPORT_TO`, a comma-separated server environment value. Vincent's number is stored there, not in `crm_leads`.

After processing, the runner sends:

1. A summary containing campaign, SGT date, selected/sent/failed/unknown/skipped counts, and any blocker.
2. One report message per selected lead containing the send-time recipient name, masked phone, final status, and exact `rendered_body` verbatim.

The full phone remains in Supabase. Operator reports preserve the country code and final four digits only. Report-delivery failure is recorded on the run and does not change lead-send states.

### Controls and observability

The runner supports `--dry-run`, `--date yyyy-mm-dd`, and `--json`. Dry-run performs selection and rendering without creating sends, updating CRM, or calling WAHA.

The service writes structured logs and a text report artifact under `/opt/smartprop/logs/newsletter/`. Health verification must expose the latest run date/status, counts, and WAHA readiness. A `verify-newsletter-campaign.sh` script probes the timer, service, database run freshness, and WAHA state without sending messages.

The timer is installed but remains disabled until WAHA is relinked and a controlled send to the previously approved test number succeeds.

## Alternatives Considered

### Chloe sends manually through chat or CLI

Rejected. CRM training covers operator behavior but does not enforce five-per-day, idempotency, opt-outs, delivery certainty, or audit records.

### OpenClaw agent chooses and sends leads directly

Rejected. It would split campaign truth across OpenClaw state and SmartProp CRM, recreating the allowlist/preflight problem and making duplicate prevention unreliable.

### SmartProp automatic runner with CRM as source of truth

Selected. It uses the existing database and composer, keeps Chloe's workflow intact, and makes every daily run reproducible and auditable.

## Error Handling

- WAHA not ready: record a blocked run, select/send no leads, and allow the same date to resume after relink.
- No approved issue: exit nonzero with a clear operator error and no writes except a local log.
- No eligible leads: complete the run with zero selected and mark the issue `sent` only when no queued, failed-retryable, or unknown rows remain.
- Provider definite rejection: mark `failed`, continue with the already selected batch, and report it.
- Provider ambiguous timeout: mark `unknown`, continue, and never auto-retry that recipient.
- CRM activity failure after an accepted send: retain `sent` as delivery truth, record the activity error on the send/run, and surface it in the report.
- Operator report failure: retain campaign results and record/report the notification error in logs and run state.

## Security and Privacy

- Service-role credentials remain server-side.
- The campaign runner is a local systemd/CLI path, not a public unauthenticated endpoint.
- Report recipients live in a root-readable environment file, not the lead database.
- Operator reports mask phone numbers.
- Logs do not print complete lead lists, credentials, or raw database dumps.

## Resource Scaling Review

| Scarce resource | Scales with | Hard limit | At 10x current campaign | Failure mode |
| --- | --- | --- | --- | --- |
| WhatsApp sends | Fixed daily cap | 5 lead recipients/day | Still 5/day unless explicitly changed | Queue duration grows; no provider burst |
| Runner concurrency | Systemd process plus DB run claim | 1 effective run/day | Unchanged | Duplicate process exits/resumes same run |
| Supabase rows | One run/day plus one send/recipient | Database capacity | About 50 sends per ten campaign days | Negligible; indexes bound lookups |
| Process memory | One batch of at most 5 | PM2/systemd host limits | Unchanged | Runner exits and systemd records failure |
| WAHA session | One linked session | 1 current session | Unchanged | Preflight blocks all delivery and surfaces status |

The first binding constraint is the single WAHA linked session, not database or CPU capacity. The design applies back-pressure through the five-recipient cap and sequential pacing.

## Test Strategy

- Unit tests for phone normalization, project valuation aggregation, eligibility ordering, report masking/formatting, and send-state classification.
- Store tests using a fake Supabase adapter for daily-run idempotency, failed retry, STOP exclusion, CRM activity updates, and ambiguous-send behavior.
- Runner tests with injected WAHA sender, clock, sleep, and report sender.
- Migration assertions for constraints, states, indexes, and atomic claim behavior.
- Focused Bun tests, full TypeScript typecheck, Next.js production build, shell syntax checks, and a dry-run against production data.
- Controlled live test to the approved operator number only after WAHA reaches `WORKING`; no real lead send before that proof.

## Deployment Boundary

Production target is `root@109.123.239.107:2222`, hostname `vmi3201429`, application `/opt/smartprop/app/smartprop`, PM2 process `smartprop`, and WAHA at `127.0.0.1:3030`. Deployment must back up changed runtime files and environment/unit files before modification.

The OpenClaw gateway at `194.233.94.3` is a separate system and is not modified by this implementation.
