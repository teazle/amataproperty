# Automatic WhatsApp Newsletter Campaign Design

## Status

Approved for implementation by the user on 2026-07-11. The campaign itself is approved and does not require daily human approval.

## Goal

Have Chloe's SmartProp workflow automatically attempt up to five personalized ViewProperty.ai WhatsApp newsletter messages per Singapore calendar day, update the CRM after every attempt, respect STOP opt-outs, and report the exact recipient-to-message mapping to approved operators. Five accepted or delivered messages cannot be guaranteed when an external provider rejects or ambiguously handles a request; the enforceable invariant is at most five distinct lead-recipient POST attempts per SGT day.

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
2. Creates or resumes the one global run for the Singapore date.
3. Selects at most five unique recipients for that run.
4. Sends sequentially with a 60-second gap.
5. Updates the newsletter ledger and CRM immediately after each attempt.
6. Sends an operator summary and the exact content for each selected recipient.

The daily cap is five unique lead-recipient POST attempts across all campaigns. Each run has five numbered slots. A slot is consumed when a provider POST begins, including rejected and ambiguous attempts. A queued recipient who opts out before POST may release an unused slot for a replacement. Operator report messages do not count toward the lead cap, but are independently capped and ledgered. A repeated timer or manual rerun resumes the same global SGT-day run and cannot select a second set of five.

Production write mode derives the SGT date from the database and rejects `--date`. The date override is dry-run-only so backdating cannot bypass the physical-day cap.

### Eligibility

A lead is eligible only when all conditions hold:

- the issue is `approved` or `sending`;
- the lead belongs to the issue's active audience project;
- `opt_out_at IS NULL`;
- CRM status is not `lost`;
- the phone normalizes to a valid Singapore E.164 number;
- no active or terminal non-retryable attempt exists for the same issue and normalized recipient;
- a fresh valuation can be resolved for the lead's project;
- the recipient has fewer than three total provider submissions for the issue.

Selection order is deterministic: failed recipients that are safe to retry first, then priority `high`, `normal`, `low`, followed by `created_at ASC` and `id ASC`.

### Valuation resolution

The current CRM records identify the project but do not contain a reliable unit-to-valuation key. The runner must not pretend it has a unit-specific match.

For an audience project, it resolves fresh `propnex_valuations` rows whose `project_name` matches the CRM project title. It creates a project-level snapshot using the minimum supported low value, median supported midpoint, maximum supported high value, total comparable count, and newest `as_of` date. The rendered copy remains an indicative project/property update. The exact snapshot used is stored on `newsletter_sends`.

Fresh means `expires_at > now()` and at least a valid range or midpoint exists. If no supported current valuation exists, the lead is skipped and no WhatsApp message is sent.

### Idempotency and delivery certainty

Add `newsletter_runs` with a globally unique `run_date`. Use `newsletter_sends` as an append-only attempt ledger. Each attempt snapshots recipient name, normalized recipient key, phone, exact body, valuation, run, slot, attempt number, and CRM-sync outcome.

Add a normalized recipient key to CRM leads, a small `newsletter_suppressions` registry, and the `newsletter_operator_reports` ledger. Campaign evidence must survive CRM cleanup: send rows retain their snapshots and use `SET NULL` rather than cascading deletion when a lead is removed.

Allowed send states are:

- `queued -> sending -> sent`
- `queued -> opted_out | skipped`
- `sending -> failed` for a definite provider rejection
- `sending -> unknown` for a timeout, process loss, or ambiguous network result

`unknown` is never retried automatically because the provider may have accepted the message. Definite retryable `failed` attempts may produce a new attempt on a later day, with at most three total provider submissions per issue and recipient. A partial unique index prevents a second `queued`, `sending`, `sent`, or `unknown` attempt for the same issue and normalized recipient. Unique `(issue_id, recipient_key, attempt_no)` and `(run_id, slot_no)` constraints retain complete retry history while preventing duplicate active delivery.

On runner restart, any abandoned `sending` attempt is moved to `unknown`. Unknown attempts may be resolved only by unambiguous outbound-webhook evidence or an authenticated local operator command that records who resolved it and why.

The runner uses atomic database claim/start/finalize functions, a database advisory lock, and a process lock. The start-attempt function rechecks suppression immediately before `queued -> sending` and consumes the numbered slot atomically. This prevents concurrent systemd/manual executions from exceeding the daily cap.

### CRM updates

For every accepted send:

- write `sent`, provider message ID, and timestamp to `newsletter_sends`;
- change CRM status from `new` to `contacted` without overwriting later-stage statuses;
- update `last_activity_at`;
- insert a CRM activity with campaign/run metadata and the send-ledger ID.

Failures and ambiguous results also receive CRM activities without changing the lead's sales status.

Incoming exact `STOP`, `UNSUBSCRIBE`, `CANCEL`, `OPTOUT`, or `OPT OUT` messages call one idempotent database function before the conversational engine runs. The function writes a normalized-recipient suppression row even when no CRM lead currently matches, updates every matching CRM lead, inserts deduplicated activities, and marks every queued future attempt for that recipient `opted_out`. In production, a webhook secret is mandatory and transient persistence failures return non-2xx so WAHA can retry.

### Operator report

Report recipients come from `SMARTPROP_NEWSLETTER_REPORT_TO`, a comma-separated server environment value capped at two valid Singapore numbers. Vincent's number is stored there, not in `crm_leads`. Production lead sending is blocked when the operator list is empty or invalid.

After processing, the runner sends:

1. A summary containing campaign, SGT date, selected/sent/failed/unknown/skipped counts, and any blocker.
2. One report message per selected lead containing the send-time recipient name, masked phone, final status, and exact `rendered_body` verbatim.

The full phone remains in Supabase. Operator reports preserve the country code and final four digits only. Every summary/detail report is stored in `newsletter_operator_reports` with `queued`, `sending`, `sent`, `failed`, or `unknown` state and a unique run/operator/kind/attempt key. A restart resumes only unsent report rows and cannot duplicate a confirmed report. Report-delivery failure is recorded on the run and does not change lead-send states.

### Controls and observability

The runner supports `--dry-run`, dry-run-only `--date yyyy-mm-dd`, `--json`, and an authenticated local `resolve-unknown` command. Dry-run performs selection and rendering without creating sends, updating CRM, or calling WAHA.

The service writes structured logs and a text report artifact under `/opt/smartprop/logs/newsletter/`. Health verification must expose the latest run date/status, counts, and WAHA readiness. A `verify-newsletter-campaign.sh` script probes the timer, service, database run freshness, and WAHA state without sending messages.

The timer starts at 02:30 UTC and the oneshot service retries recoverable blockers every 15 minutes until the SGT-day cutoff. It uses `flock`, bounded memory/runtime, `UMask=0077`, persistent logs, and a kill switch `SMARTPROP_NEWSLETTER_ENABLED=1`. The timer is installed but remains disabled until WAHA is relinked and a controlled ledgered send to the previously approved test number succeeds.

## Alternatives Considered

### Chloe sends manually through chat or CLI

Rejected. CRM training covers operator behavior but does not enforce five-per-day, idempotency, opt-outs, delivery certainty, or audit records.

### OpenClaw agent chooses and sends leads directly

Rejected. It would split campaign truth across OpenClaw state and SmartProp CRM, recreating the allowlist/preflight problem and making duplicate prevention unreliable.

### SmartProp automatic runner with CRM as source of truth

Selected. It uses the existing database and composer, keeps Chloe's workflow intact, and makes every daily run reproducible and auditable.

## Error Handling

- WAHA not ready: record a blocked run, select/send no leads, return a recoverable failure, and allow the same date to resume after relink.
- No approved issue: exit nonzero with a clear operator error and no writes except a local log.
- No eligible leads: complete the run with zero selected and mark the issue `sent` only when no queued, failed-retryable, or unknown rows remain.
- Provider definite rejection: mark `failed`, continue with the already selected batch, and report it.
- Provider ambiguous timeout: mark `unknown`, continue, and never auto-retry that recipient.
- CRM finalization after an accepted send is one atomic function that records provider acceptance, conditionally changes `new -> contacted`, updates `last_activity_at`, and inserts the CRM activity. If it fails, write a root-only recovery record and stop the batch so CRM drift cannot compound.
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
| WhatsApp lead sends | Fixed global daily cap | 5 provider POST attempts/day | Still 5/day unless explicitly changed | Queue duration grows; no provider burst |
| Operator reports | Selected attempts x approved operators | 2 operators; at most 6 report messages/operator/run | At most 12 report messages/run | Report queue fails closed and resumes idempotently |
| Runner concurrency | Systemd process plus DB run claim | 1 effective run/day | Unchanged | Duplicate process exits/resumes same run |
| Supabase rows | One run/day plus one send/recipient | Database capacity | About 50 sends per ten campaign days | Negligible; indexes bound lookups |
| Process memory | One batch of at most 5 | PM2/systemd host limits | Unchanged | Runner exits and systemd records failure |
| WAHA session | One linked session | 1 current session | Unchanged | Preflight blocks all delivery and surfaces status |

The first binding constraint is the single WAHA linked session, not database or CPU capacity. The design applies back-pressure through the five-recipient cap and sequential pacing.

## Test Strategy

- Unit tests for phone normalization, project valuation aggregation, eligibility ordering, report masking/formatting, and send-state classification.
- PostgreSQL integration assertions for global five-slot enforcement, concurrent claims, partial uniqueness, three-attempt limits, STOP suppression, and atomic CRM finalization.
- Store tests using a fake Supabase adapter for daily-run idempotency, failed retry, STOP exclusion, CRM activity updates, and ambiguous-send behavior.
- Runner tests with injected WAHA sender, clock, sleep, and report sender.
- Migration assertions for constraints, states, indexes, and atomic claim behavior.
- Focused Bun tests, full TypeScript typecheck, Next.js production build, shell syntax checks, and a dry-run against production data.
- Controlled ledgered live test to the approved operator number only after WAHA reaches `WORKING`; no real lead send before that proof.

## Deployment Boundary

Production target is `root@109.123.239.107:2222`, hostname `vmi3201429`, application `/opt/smartprop/app/smartprop`, PM2 process `smartprop`, and WAHA at `127.0.0.1:3030`. Deployment must back up changed runtime files and environment/unit files before modification.

The OpenClaw gateway at `194.233.94.3` is a separate system and is not modified by this implementation.
