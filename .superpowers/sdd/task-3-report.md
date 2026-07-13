# Task 3 Report: Five-Slot Campaign Store, Runner, CRM Finalization And Reports

## Status

Implemented and locally verified. The six owned Task 3 files are committed separately from this coordination report.

Commit: `b5bcf6a` (`feat: run five-slot WhatsApp newsletter campaigns`)

## Files

- `smartprop/src/lib/newsletter/campaign-store.ts`
- `smartprop/src/lib/newsletter/campaign-runner.ts`
- `smartprop/src/lib/newsletter/operator-report.ts`
- `smartprop/scripts/run-whatsapp-newsletter-campaign.ts`
- `smartprop/scripts/newsletter-campaign-runner.test.ts`
- `smartprop/scripts/newsletter-operator-report.test.ts`

## Implementation

- Added a narrow Supabase campaign store using the exact Task 1 RPC signatures for claim, attempt start, attempt finalization, and unknown resolution.
- Added paginated CRM, attempt, suppression, and valuation reads with normalized-recipient eligibility, deterministic retry/priority/created/id ordering, active/terminal exclusion, and the three-attempt cap.
- Added a sequential five-slot runner with WAHA preflight before database work, atomic attempt starts, 60-second pacing, definite/unknown outcome handling, abandoned-send recovery, and same-day resume behavior.
- Added persistent recovery-required run state plus a root-only JSON recovery artifact path for accepted provider sends whose atomic CRM finalization fails.
- Added masked, exact-body operator summary/detail reports with one-or-two-recipient validation, stable ledger identities, idempotent resume, and no retry of ambiguous report outcomes.
- Added dry-run, JSON output, production-date rejection, ledgered override-only `test-send`, and authenticated `resolve-unknown` CLI paths with exit codes 0/10/20/30.
- `test-send` uses a dedicated source-lead lookup, creates only an `is_test=true` row with `override_phone`, does not claim a run/slot, and relies on the test-row path that does not mutate CRM.

## TDD Evidence

### Initial RED

Command:

```text
bun test scripts/newsletter-campaign-runner.test.ts scripts/newsletter-operator-report.test.ts
```

Result: exit 1.

```text
Cannot find module '../src/lib/newsletter/operator-report'
Cannot find module '../src/lib/newsletter/campaign-runner'
0 pass
2 fail
2 errors
```

### Orchestration RED

First implementation run: exit 1, `14 pass`, `2 fail`, `54 assertions`.

- Preflight blocker still called `resolveIssue`, violating zero database work.
- Abandoned recovery ordering assertion exposed selection-limit coupling and was narrowed to the required recovery-before-selection behavior.

### Restart-Safety RED

Command:

```text
bun test scripts/newsletter-campaign-runner.test.ts
```

Result: exit 1, `12 pass`, `2 fail`, `41 assertions`.

- Completed same-day runs did not resume queued operator reports.
- Accepted-send CRM finalization failure did not persist recovery-required run state.

### Test-Send RED

Command:

```text
bun test scripts/newsletter-campaign-runner.test.ts
```

Result: exit 1, `13 pass`, `1 fail`, `37 assertions`.

```text
error: test-send source lead is not eligible.
```

The sixth eligible source lead failed because test-send incorrectly searched only the five production candidates.

## Final GREEN

Command:

```text
bun test scripts/newsletter-campaign-runner.test.ts scripts/newsletter-operator-report.test.ts scripts/newsletter-rules.test.ts scripts/newsletter-waha.test.ts scripts/newsletter-compose.test.ts
```

Result: exit 0.

```text
41 pass
0 fail
115 expect() calls
Ran 41 tests across 5 files.
```

Command:

```text
bun run typecheck
```

Result: exit 0.

```text
$ bun x tsc --noEmit
```

Command:

```text
bun x eslint src/lib/newsletter/campaign-store.ts src/lib/newsletter/campaign-runner.ts src/lib/newsletter/operator-report.ts scripts/run-whatsapp-newsletter-campaign.ts scripts/newsletter-campaign-runner.test.ts scripts/newsletter-operator-report.test.ts && git diff --check
```

Result: exit 0, empty output.

## Self-Review

- Confirmed production `--date` is rejected by side-effect-free CLI parsing before environment, Supabase, or WAHA setup.
- Confirmed blocked preflight performs no store calls and no provider POST.
- Confirmed only Task 1 `start_newsletter_attempt` consumes a real slot; test and operator sends bypass real run state.
- Confirmed failed and unknown attempts consume slots, unknown is non-retryable, and STOP suppression can reuse only an unconsumed slot.
- Confirmed the runner never sleeps after the final lead POST.
- Confirmed accepted-send CRM finalization failure writes recovery evidence, marks the run failed, stops immediately, and blocks later lead processing.
- Confirmed operator detail reports mask lead phones and include the snapshotted rendered body verbatim.
- Confirmed completed-run re-entry performs report recovery only and cannot select a second lead set.
- Confirmed dry-run reads/renders only and CLI output contains aggregate counts, not lead lists.
- Confirmed no migration or non-owned product file was changed.

## Concerns

- No live Supabase/PostgreSQL or WAHA operation was run. Store query/RPC behavior is typechecked and orchestration is covered with an in-memory fake, but database integration remains for the controller/deployment tasks.
- Migration `019` owns the authoritative issue choice in `claim_newsletter_run`; the runner resolves that claimed issue by ID even though the design prose describes oldest approved/sending selection. The migration was not modified per ownership constraints.
- Superseded by the review fix below: migration `019` now provides a separate queue RPC that persists the valuation snapshot before start.

## Review Fix Round At `d230451`

### Fixes

- Switched selection persistence to `queue_newsletter_attempt(p_run_id,p_lead_id,p_claim_token,p_rendered_body,p_valuation_snapshot)` before any provider POST.
- Switched slot consumption to `start_newsletter_attempt(p_send_id,p_slot_no,p_claim_token)` and resume persisted queued rows in stable order without reselection.
- Added suppression-only replacement queueing while preserving the same-day selected batch for normal resumes.
- Changed accepted-send CRM recovery to call `record_accepted_newsletter_recovery` before the root-only filesystem artifact; filesystem failure no longer loses authoritative recovery state or continues the batch.
- Changed test-send create/finalize to the secured RPCs; the store no longer writes `newsletter_sends` directly.
- Added 15-minute stale `sending` filtering and random UUID claim tokens per process invocation.
- Added explicit stable ordering before every paginated range query.
- Propagated failed/unknown operator reports into `newsletter_runs.report_error`, returned `recovery-required`, mapped it to exit 30, and excluded unknown/failed reports from automatic resend.
- Wrapped invalid operator configuration as `CampaignConfigurationError` for exit 20.
- Ensured zero-attempt runs still queue and send the summary report.
- Added strict real-calendar validation and made dry-run date the valuation freshness/reference time at SGT midnight.
- Added concrete recording-Supabase adapter tests for exact RPC arguments, pagination order, stale-age filtering, report-error updates, and secured test-send RPCs.

### RED Evidence

Initial review-fix command:

```text
bun test scripts/newsletter-campaign-runner.test.ts
```

Result: exit 1.

```text
6 pass
18 fail
28 expect() calls
```

Failures included missing `queueAttempt`, old start RPC arguments, no accepted-recovery RPC, no report-error update, no 15-minute filter, unordered pagination, ignored dry-run reference date, invalid calendar acceptance, wrong operator error class, and report recovery returning completed.

Random-claim/CLI-classification RED:

```text
bun test scripts/newsletter-campaign-runner.test.ts --test-name-pattern "claim token|maps configuration"
```

Result: exit 1 with `Export named 'exitCodeForResult' not found`, proving the new CLI classification/token contract was not yet implemented.

### GREEN Evidence

```text
bun test scripts/newsletter-campaign-runner.test.ts scripts/newsletter-operator-report.test.ts scripts/newsletter-rules.test.ts scripts/newsletter-waha.test.ts scripts/newsletter-compose.test.ts
```

Result: exit 0.

```text
53 pass
0 fail
142 expect() calls
Ran 53 tests across 5 files.
```

```text
bun run typecheck
```

Result: exit 0 (`bun x tsc --noEmit`).

```text
bun x eslint src/lib/newsletter/campaign-store.ts src/lib/newsletter/campaign-runner.ts src/lib/newsletter/operator-report.ts scripts/run-whatsapp-newsletter-campaign.ts scripts/newsletter-campaign-runner.test.ts scripts/newsletter-operator-report.test.ts && git diff --check
```

Result: exit 0, empty output.

### Fix-Round Self-Review

- Confirmed every real selected recipient is queued with body and valuation snapshot before the first provider call.
- Confirmed existing queued rows are processed without candidate reselection; only a start-time suppression can append one replacement.
- Confirmed database accepted-recovery is authoritative and precedes best-effort root-only file evidence.
- Confirmed report ambiguity is ledgered, blocks completion at exit 30, and is not automatically resent.
- Confirmed stale recovery uses an exact 15-minute cutoff supplied by the runner.
- Confirmed direct test-send table writes were removed.
- Confirmed no migration or non-owned product file changed.

### Fix-Round Concerns

- No live Supabase/PostgreSQL or WAHA operation was run. Exact RPC arguments and query construction are covered by the recording adapter; runtime database integration remains unverified in this task.

## Task 3 Review Findings Fix At `c81e5c5`

### Fixes

- Made `start_newsletter_attempt` return an explicit `opted_out` ledger row when STOP cancellation already occurred, and atomically transition a still-queued row when CRM opt-out or suppression is discovered at start. These paths run before slot assignment and provider-start counting, so one replacement can use the released capacity while started attempts remain capped at five.
- Added secured `recover_stale_newsletter_operator_reports(UUID, TIMESTAMPTZ)`, which atomically transitions stale `sending` reports to `unknown` and persists `newsletter_runs.report_error`.
- Mapped `report_error` into `CampaignRun`; completed and running reruns now return `recovery-required` without queueing or resending reports. The existing CLI maps this status to exit 30.
- Added stable `id` tie-breakers after the prior-send and valuation order chains, with `id` included in both selections.
- Updated executable schema assertions, secured-RPC checks, and focused runner/store regression coverage.

### RED Evidence

Initial focused command:

```text
bun test scripts/newsletter-migration.test.ts scripts/newsletter-campaign-runner.test.ts
```

Result: exit 1.

```text
47 pass
11 fail
246 expect() calls
```

The failures covered missing atomic STOP start outcomes, missing stale-report recovery RPC and schema markers, persisted `report_error` being ignored, stale reports being silently resumed, no replacement after an opt-out RPC cancellation, explicit `opted_out` rows not being classified as suppressed, and missing unique pagination tie-breakers.

### GREEN Evidence

Focused migration and runner tests:

```text
bun test scripts/newsletter-migration.test.ts scripts/newsletter-campaign-runner.test.ts
```

Result: exit 0, `58 pass`, `0 fail`, `267 expect() calls`.

Required focused suite:

```text
bun test scripts/newsletter-migration.test.ts scripts/newsletter-campaign-runner.test.ts scripts/newsletter-operator-report.test.ts scripts/newsletter-rules.test.ts scripts/newsletter-waha.test.ts scripts/newsletter-compose.test.ts
```

Result: exit 0, `85 pass`, `0 fail`, `340 expect() calls` across 6 files.

```text
bun run typecheck
```

Result: exit 0 (`bun x tsc --noEmit`).

```text
bun x eslint src/lib/newsletter/campaign-store.ts src/lib/newsletter/campaign-runner.ts scripts/newsletter-campaign-runner.test.ts scripts/newsletter-migration.test.ts
```

Result: exit 0, empty output.

```text
git diff --check -- migrations/019_add_whatsapp_newsletter_campaign.sql scripts/newsletter-migration.test.ts scripts/newsletter-schema-assertions.sql src/lib/newsletter/campaign-store.ts src/lib/newsletter/campaign-runner.ts scripts/newsletter-campaign-runner.test.ts
```

Result: exit 0, empty output.

### Files

- `smartprop/migrations/019_add_whatsapp_newsletter_campaign.sql`
- `smartprop/scripts/newsletter-migration.test.ts`
- `smartprop/scripts/newsletter-schema-assertions.sql`
- `smartprop/src/lib/newsletter/campaign-store.ts`
- `smartprop/src/lib/newsletter/campaign-runner.ts`
- `smartprop/scripts/newsletter-campaign-runner.test.ts`
- `.superpowers/sdd/task-3-report.md`

### Self-Review

- Confirmed every real provider POST still requires a non-null `attempt_started_at` created by the secured start RPC, and the authoritative SGT-day count remains limited to five.
- Confirmed queued STOP transitions remain append-only audit rows and no slot or attempt number is assigned before suppression exits.
- Confirmed both pre-cancelled rows and start-time suppression select exactly one replacement in runner tests.
- Confirmed persisted or newly recovered report ambiguity exits recovery-required and does not automatically resend failed or unknown reports.
- Confirmed every paginated query has a deterministic unique final order key before `range`.
- Confirmed concurrent Task4 and Task5 files were not staged or modified by this fix.

### Concerns

- PostgreSQL runtime execution was unavailable and was not claimed. Migration behavior is covered by static contract tests and executable SQL assertions intended for the deployment environment.
- No live Supabase or WAHA operations were run, per scope.
