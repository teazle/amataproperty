# Automatic WhatsApp Newsletter Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically attempt at most five approved CRM newsletter recipients per Singapore day, persist every delivery and CRM outcome, honor durable STOP suppression, and send idempotent operator reports.

**Architecture:** Supabase owns the global daily run, five numbered attempt slots, suppression registry, append-only attempt ledger, and operator-report ledger. A local Bun runner claims one SGT-day run, renders deterministic project-level valuation messages, sends through a fail-closed typed WAHA adapter, and uses SQL RPCs for atomic attempt start/finalization and CRM updates. A bounded systemd service retries recoverable blockers while a health surface and verifier expose version, heartbeat, latest meaningful work, dependency state, and campaign freshness.

**Tech Stack:** PostgreSQL/Supabase, Bun 1.2+, TypeScript, Next.js 15, WAHA HTTP API, systemd.

## Global Constraints

- The approved campaign does not require daily human approval.
- Enforce at most five distinct lead-recipient provider POST attempts globally per SGT day; failed and unknown POSTs consume slots.
- Production write mode derives the SGT date from PostgreSQL and rejects `--date`; `--date` is dry-run-only.
- Require an approved or sending issue, active audience project, valid Singapore E.164 phone, no suppression/opt-out, non-lost CRM status, and fresh supported valuation before selection.
- Use exact STOP keywords only: `STOP`, `UNSUBSCRIBE`, `CANCEL`, `OPTOUT`, `OPT OUT`.
- Never automatically retry an `unknown` provider outcome.
- Allow at most three total provider submissions per issue and normalized recipient.
- Store Vincent/operator report numbers in root-readable server configuration, never as CRM leads; cap operators at two and mask lead phones in reports.
- Bring the previously deployed STOP behavior into durable source without copying its duplicate-phone and transaction weaknesses.
- Use migration number `019`; do not touch the unrelated uncommitted migration `018` in the original checkout.
- Do not modify the separate OpenClaw VPS at `194.233.94.3`.
- Production target, when deployment begins: Supabase project `pfdsmpfgwbbeijdzevpu`; `root@109.123.239.107:2222`; hostname `vmi3201429`; app `/opt/smartprop/app/smartprop`; PM2 `smartprop`; WAHA `127.0.0.1:3030` session `default`.

---

### Task 1: Database State Machine And Atomic CRM Boundaries

**Files:**
- Create: `smartprop/migrations/019_add_whatsapp_newsletter_campaign.sql`
- Create: `smartprop/scripts/newsletter-schema-assertions.sql`
- Create: `smartprop/scripts/newsletter-migration.test.ts`

**Interfaces:**
- Produces RPCs: `claim_newsletter_run(text)`, `start_newsletter_attempt(uuid,uuid,integer,text)`, `finalize_newsletter_attempt(uuid,text,text,text,boolean)`, `record_newsletter_opt_out(text,text,text)`, and `resolve_newsletter_unknown(uuid,text,text,text)`.
- Produces tables: `newsletter_runs`, `newsletter_suppressions`, `newsletter_operator_reports`.
- Extends `crm_leads` with `phone_e164` and `newsletter_sends` into an append-only attempt ledger.

- [ ] **Step 1: Write migration contract tests first**

Create Bun tests that read the SQL and assert the required invariants are present:

```ts
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/019_add_whatsapp_newsletter_campaign.sql', import.meta.url), 'utf8');

describe('newsletter migration contract', () => {
  test('creates one global SGT-day run and five numbered slots', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS newsletter_runs');
    expect(sql).toMatch(/UNIQUE\s*\(run_date\)/i);
    expect(sql).toMatch(/slot_no[^;]+CHECK\s*\(slot_no BETWEEN 1 AND 5\)/is);
  });

  test('models unknown outcomes and partial recipient uniqueness', () => {
    expect(sql).toContain("'unknown'");
    expect(sql).toMatch(/WHERE status IN \('queued', 'sending', 'sent', 'unknown'\)/i);
    expect(sql).toMatch(/issue_id, recipient_key, attempt_no/i);
  });

  test('defines atomic run, attempt, STOP, finalization and resolution RPCs', () => {
    for (const name of ['claim_newsletter_run', 'start_newsletter_attempt', 'finalize_newsletter_attempt', 'record_newsletter_opt_out', 'resolve_newsletter_unknown']) {
      expect(sql).toContain(`FUNCTION ${name}`);
    }
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `bun test scripts/newsletter-migration.test.ts`

Expected: FAIL because migration `019` does not exist.

- [ ] **Step 3: Implement the additive migration**

The migration must:

```sql
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS phone_e164 TEXT;

CREATE TABLE IF NOT EXISTS newsletter_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL UNIQUE,
  issue_id UUID REFERENCES newsletter_issues(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('blocked','running','completed','failed')),
  claim_token TEXT,
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count BETWEEN 0 AND 5),
  attempted_count INTEGER NOT NULL DEFAULT 0 CHECK (attempted_count BETWEEN 0 AND 5),
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  unknown_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  blocker TEXT,
  report_error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_suppressions (
  recipient_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  first_message_id TEXT,
  last_message_id TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_operator_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES newsletter_runs(id) ON DELETE RESTRICT,
  operator_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('summary','recipient')),
  send_id UUID REFERENCES newsletter_sends(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sending','sent','failed','unknown')),
  provider_message_id TEXT,
  error TEXT,
  attempt_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, operator_key, kind, send_id)
);
```

Extend `newsletter_sends` with `run_id`, `slot_no`, `recipient_name`, `recipient_key`, `attempt_no`, `attempt_started_at`, `completed_at`, `retryable`, `provider_outcome`, `error_code`, `crm_sync_error`, and unknown-resolution audit fields. Replace the old `(issue_id, lead_id)` uniqueness with:

```sql
CREATE UNIQUE INDEX uniq_newsletter_attempt_number
  ON newsletter_sends(issue_id, recipient_key, attempt_no)
  WHERE recipient_key IS NOT NULL AND is_test = FALSE;

CREATE UNIQUE INDEX uniq_newsletter_active_recipient
  ON newsletter_sends(issue_id, recipient_key)
  WHERE recipient_key IS NOT NULL
    AND is_test = FALSE
    AND status IN ('queued', 'sending', 'sent', 'unknown');

CREATE UNIQUE INDEX uniq_newsletter_run_slot
  ON newsletter_sends(run_id, slot_no)
  WHERE run_id IS NOT NULL AND slot_no IS NOT NULL;
```

Change the lead foreign key to nullable `ON DELETE SET NULL`, preserving send-time snapshots. Backfill normalized keys before creating indexes.

Implement all five RPCs as `SECURITY DEFINER` functions with fixed `search_path = public`, advisory transaction locks, input validation, and revoked public execution followed by service-role grants. `start_newsletter_attempt` must atomically recheck suppression, enforce `attempted_count < 5`, consume a unique slot, and set `attempt_started_at` before returning permission to POST. `finalize_newsletter_attempt` must atomically finalize the attempt, conditionally update `new -> contacted`, update `last_activity_at`, insert a CRM activity, and update run counters. `record_newsletter_opt_out` must suppress even an unmatched number, update every matching CRM row, deduplicate repeated webhook delivery, and cancel queued attempts. `resolve_newsletter_unknown` must require a resolver and reason.

- [ ] **Step 4: Add executable PostgreSQL assertions**

`newsletter-schema-assertions.sql` must run in a transaction and fail on missing constraints/functions. It must create disposable fixtures, prove a sixth slot is rejected, prove the same SGT date cannot have a second run, prove repeated STOP is idempotent, and roll back.

- [ ] **Step 5: Run tests and optional scratch PostgreSQL verification**

Run:

```bash
bun test scripts/newsletter-migration.test.ts
if [ -n "${SMARTPROP_TEST_DATABASE_URL:-}" ]; then
  psql "$SMARTPROP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/019_add_whatsapp_newsletter_campaign.sql
  psql "$SMARTPROP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/newsletter-schema-assertions.sql
fi
```

Expected: Bun PASS. PostgreSQL assertions PASS when a scratch URL is available; otherwise report that integration gate as unrun, not passed.

- [ ] **Step 6: Commit**

```bash
git add smartprop/migrations/019_add_whatsapp_newsletter_campaign.sql smartprop/scripts/newsletter-schema-assertions.sql smartprop/scripts/newsletter-migration.test.ts
git commit -m "feat: add newsletter campaign state machine"
```

---

### Task 2: Pure Campaign Rules And Fail-Closed WAHA Outcomes

**Files:**
- Create: `smartprop/src/lib/newsletter/recipient.ts`
- Create: `smartprop/src/lib/newsletter/valuation.ts`
- Create: `smartprop/src/lib/newsletter/campaign-types.ts`
- Create: `smartprop/scripts/newsletter-rules.test.ts`
- Create: `smartprop/scripts/newsletter-waha.test.ts`
- Modify: `smartprop/src/lib/wa/waha.ts`

**Interfaces:**
- Produces `normalizeSingaporeRecipient(value): string | null`.
- Produces `aggregateProjectValuation(projectTitle, rows, now): NewsletterValuationSnapshot | null`.
- Produces `sendCampaignWhatsApp(to, text): Promise<CampaignTransportResult>` with outcomes `accepted | rejected | unknown | blocked`.

- [ ] **Step 1: Write failing recipient and valuation tests**

```ts
test('normalizes only Singapore mobile recipients', () => {
  expect(normalizeSingaporeRecipient('9105 1399')).toBe('+6591051399');
  expect(normalizeSingaporeRecipient('6591051399@c.us')).toBe('+6591051399');
  expect(normalizeSingaporeRecipient('123')).toBeNull();
});

test('aggregates only fresh project-matching supported valuations', () => {
  const result = aggregateProjectValuation('Cliften', valuationRows, new Date('2026-07-13T00:00:00Z'));
  expect(result).toMatchObject({ basis: 'project-level', lowSgd: 1_000_000, highSgd: 1_300_000 });
});
```

- [ ] **Step 2: Run rules tests and verify RED**

Run: `bun test scripts/newsletter-rules.test.ts`

Expected: FAIL on missing modules.

- [ ] **Step 3: Implement minimal pure rules**

Use strict Singapore `+65` normalization with eight-digit local numbers beginning 8 or 9. Project matching is normalized containment, not raw SQL interpolation. Ignore expired rows and rows lacking both range and midpoint. Aggregate minimum low, median midpoint, maximum high, summed comparables, and newest `asOf`; label it `basis: 'project-level'`.

- [ ] **Step 4: Write the WAHA outcome matrix tests**

Test these exact cases using injected `fetch`:

```ts
blocked: preflight timeout, non-2xx, or status !== 'WORKING'; no send POST observed
accepted: send POST returns 2xx JSON containing provider id
rejected: send POST returns explicit 4xx/5xx response; retryable classified from status
unknown: send POST begins then aborts, resets, times out, or returns malformed success
```

- [ ] **Step 5: Run WAHA tests and verify RED**

Run: `bun test scripts/newsletter-waha.test.ts`

Expected: FAIL because the typed campaign transport does not exist.

- [ ] **Step 6: Implement the typed fail-closed adapter**

```ts
export type CampaignTransportResult =
  | { outcome: 'accepted'; messageId: string }
  | { outcome: 'rejected'; retryable: boolean; error: string; statusCode?: number }
  | { outcome: 'unknown'; error: string }
  | { outcome: 'blocked'; error: string };
```

Preflight must prove the configured WAHA session status is exactly `WORKING`. Once the send POST begins, any outcome that cannot disprove acceptance is `unknown`. Preserve existing co-broking behavior; add the campaign-specific entry point instead of changing unrelated callers to the stricter result type.

- [ ] **Step 7: Run focused tests and commit**

```bash
bun test scripts/newsletter-rules.test.ts scripts/newsletter-waha.test.ts scripts/newsletter-compose.test.ts
git add smartprop/src/lib/newsletter/recipient.ts smartprop/src/lib/newsletter/valuation.ts smartprop/src/lib/newsletter/campaign-types.ts smartprop/src/lib/wa/waha.ts smartprop/scripts/newsletter-rules.test.ts smartprop/scripts/newsletter-waha.test.ts
git commit -m "feat: add deterministic campaign rules and WAHA outcomes"
```

---

### Task 3: Five-Slot Campaign Store, Runner, CRM Finalization And Reports

**Files:**
- Create: `smartprop/src/lib/newsletter/campaign-store.ts`
- Create: `smartprop/src/lib/newsletter/campaign-runner.ts`
- Create: `smartprop/src/lib/newsletter/operator-report.ts`
- Create: `smartprop/scripts/run-whatsapp-newsletter-campaign.ts`
- Create: `smartprop/scripts/newsletter-campaign-runner.test.ts`
- Create: `smartprop/scripts/newsletter-operator-report.test.ts`

**Interfaces:**
- Consumes Task 1 RPCs and Task 2 rule/transport interfaces.
- Produces `runNewsletterCampaign(deps, options): Promise<CampaignRunResult>`.
- CLI supports write mode, `--dry-run`, dry-run-only `--date`, `--json`, `test-send`, and `resolve-unknown`.

- [ ] **Step 1: Write failing orchestration tests**

Use an in-memory fake store and injected clock/sleep/transport. Cover:

```ts
- preflight blocked => zero provider POSTs and recoverable result
- six eligible leads => exactly five provider POST starts and slots 1..5
- second same-day invocation => resumes without a second selection
- failed attempt consumes its slot and a replacement is not selected that day
- queued STOP before POST releases the unused slot and selects one replacement
- unknown outcome persists and is never retried
- abandoned sending is recovered as unknown
- definite failed recipient can retry on a later day but total attempts stop at 3
- CRM finalization failure after accepted => recovery record and batch stops
- production --date => rejected before any DB/provider operation
- test-send uses override_phone, creates no CRM lead, performs no source-lead CRM mutation, and consumes no real daily slot
```

- [ ] **Step 2: Run runner tests and verify RED**

Run: `bun test scripts/newsletter-campaign-runner.test.ts`

Expected: FAIL on missing runner/store.

- [ ] **Step 3: Implement the store boundary**

The store must expose narrow methods rather than leaking query-builder chains:

```ts
interface CampaignStore {
  claimToday(issueId: string, claimToken: string): Promise<CampaignRun>;
  selectCandidates(issue: NewsletterIssue, limit: number): Promise<Candidate[]>;
  queueAttempt(run: CampaignRun, candidate: Candidate, body: string, snapshot: NewsletterValuationSnapshot): Promise<NewsletterAttempt>;
  startAttempt(attemptId: string, runId: string, slotNo: number, claimToken: string): Promise<'started' | 'suppressed'>;
  finalizeAttempt(input: FinalizeAttemptInput): Promise<void>;
  queueOperatorReports(runId: string, operators: string[]): Promise<OperatorReport[]>;
  startReport(id: string): Promise<boolean>;
  finalizeReport(id: string, result: CampaignTransportResult): Promise<void>;
  heartbeat(runId: string): Promise<void>;
}
```

Paginate CRM reads, normalize recipient keys, exclude active/sent/unknown attempts, and use stable priority/created/id ordering. Retryable failures come first but are represented by a new append-only attempt row.

- [ ] **Step 4: Implement the runner**

Write-mode sequence:

```ts
validate enabled flag and 1..2 operator recipients
resolve oldest approved/sending issue and fresh project valuation snapshot
preflight WAHA
claim database-derived SGT day
recover abandoned sending as unknown
queue/resume no more than five slots
for each due queued attempt:
  atomically start (suppression + slot recheck)
  POST through typed WAHA adapter
  atomically finalize attempt + CRM
  heartbeat
  sleep 60 seconds before next lead POST
queue and send idempotent summary/detail operator reports
complete or block run with exact counts
```

Do not sleep after the last lead. Do not count operator reports as lead slots. If CRM finalization fails after provider acceptance, write a root-only JSON recovery record and throw so the service retries only reporting/recovery, never that recipient.

- [ ] **Step 5: Write failing report tests**

Assert a maximum of two operators, masked lead phones (`+65 **** 1399`), exact rendered body inclusion, one summary plus one detail row per selected attempt, and stable report idempotency keys.

- [ ] **Step 6: Implement report formatting and ledger delivery**

The summary includes campaign slug, SGT date, selected/attempted/accepted/rejected/unknown/skipped counts and blocker. Detail reports include snapshotted name, masked phone, final status, and exact body. A report send timeout is `unknown` and is not resent automatically.

- [ ] **Step 7: Add CLI parsing and tests**

The CLI loads `.env.local`, never prints full lead lists, writes JSON only when requested, and exits with distinct codes: `0 completed`, `10 recoverable blocker`, `20 permanent configuration/data error`, `30 unresolved recovery required`. `test-send` requires the destination to equal `SMARTPROP_NEWSLETTER_TEST_TO`, writes `is_test=true` plus `override_phone`, bypasses real run/slot state, and never mutates the source lead's CRM status or activities.

- [ ] **Step 8: Run focused tests and commit**

```bash
bun test scripts/newsletter-campaign-runner.test.ts scripts/newsletter-operator-report.test.ts scripts/newsletter-rules.test.ts scripts/newsletter-waha.test.ts scripts/newsletter-compose.test.ts
git add smartprop/src/lib/newsletter/campaign-store.ts smartprop/src/lib/newsletter/campaign-runner.ts smartprop/src/lib/newsletter/operator-report.ts smartprop/scripts/run-whatsapp-newsletter-campaign.ts smartprop/scripts/newsletter-campaign-runner.test.ts smartprop/scripts/newsletter-operator-report.test.ts
git commit -m "feat: run five-slot WhatsApp newsletter campaigns"
```

---

### Task 4: Durable STOP Webhook And Unknown Reconciliation

**Files:**
- Create: `smartprop/src/lib/newsletter/whatsapp-opt-out.ts`
- Create: `smartprop/scripts/newsletter-whatsapp-opt-out.test.ts`
- Create: `smartprop/scripts/newsletter-webhook.test.ts`
- Modify: `smartprop/src/app/api/wa/webhook/route.ts`

**Interfaces:**
- Consumes Task 1 `record_newsletter_opt_out` and `resolve_newsletter_unknown` RPCs.
- Produces exact-match STOP handling before the conversation engine and outbound webhook reconciliation for unambiguous message IDs.

- [ ] **Step 1: Write failing exact STOP and duplicate-phone tests**

Test all five exact keywords, reject prose such as `please stop`, normalize WhatsApp IDs, persist unmatched suppression, update duplicate CRM phone rows, cancel queued attempts, and make repeated message IDs idempotent.

- [ ] **Step 2: Write failing webhook security/retry tests**

Test:

```ts
production with no WAHA_WEBHOOK_SECRET => 503 configuration error
wrong secret => 401
STOP RPC transient failure => non-2xx
successful STOP => conversation engine not invoked
outbound fromMe with unambiguous provider id => reconcile matching unknown attempt once
unmatched outbound event => log normally without guessing a reconciliation
```

- [ ] **Step 3: Run tests and verify RED**

Run: `bun test scripts/newsletter-whatsapp-opt-out.test.ts scripts/newsletter-webhook.test.ts`

Expected: FAIL because durable helper and route behavior are absent.

- [ ] **Step 4: Implement helper and route changes**

The helper normalizes the recipient and calls one RPC; it never performs separate lead/activity writes. Inbound STOP is processed before the AI engine. Production requires a secret. Errors return 500/503 so WAHA can retry. Outbound reconciliation occurs only when provider message ID uniquely identifies one `unknown` attempt.

- [ ] **Step 5: Run focused tests and commit**

```bash
bun test scripts/newsletter-whatsapp-opt-out.test.ts scripts/newsletter-webhook.test.ts scripts/newsletter-campaign-runner.test.ts
git add smartprop/src/lib/newsletter/whatsapp-opt-out.ts smartprop/src/app/api/wa/webhook/route.ts smartprop/scripts/newsletter-whatsapp-opt-out.test.ts smartprop/scripts/newsletter-webhook.test.ts
git commit -m "feat: persist WhatsApp newsletter suppression"
```

---

### Task 5: Scheduling, Health, Verification And Operations Runbook

**Files:**
- Create: `smartprop/scripts/run-whatsapp-newsletter-campaign.sh`
- Create: `smartprop/scripts/verify-newsletter-campaign.sh`
- Create: `smartprop/scripts/newsletter-ops.test.ts`
- Create: `smartprop/systemd/smartprop-whatsapp-newsletter.service`
- Create: `smartprop/systemd/smartprop-whatsapp-newsletter.timer`
- Create: `smartprop/docs/WHATSAPP_NEWSLETTER_OPERATIONS.md`
- Modify: `smartprop/src/app/api/health/route.ts`
- Modify: `smartprop/package.json`

**Interfaces:**
- Produces `bun run newsletter:campaign`, a bounded systemd service/timer, `/api/health` newsletter status, and one-command verifier.

- [ ] **Step 1: Write failing operations contract tests**

Assert service/timer contain: exact app path, `flock`, `Restart=on-failure`, `RestartSec=15m`, `MemoryHigh`, `MemoryMax`, `TimeoutStartSec`, `UMask=0077`, `Persistent=true`, `OnCalendar=*-*-* 02:30:00 UTC`, disabled-by-default documentation, and no legacy `ec2-user`/port-22 deploy assumptions.

- [ ] **Step 2: Run operations tests and verify RED**

Run: `bun test scripts/newsletter-ops.test.ts`

Expected: FAIL because files are absent.

- [ ] **Step 3: Implement service, timer and wrapper**

The wrapper uses `/usr/bin/flock`, writes a heartbeat/report under `/opt/smartprop/logs/newsletter/`, maps exit `10` to retryable service failure, and stops retries after the configured SGT cutoff. The unit is bounded and does not enable itself.

- [ ] **Step 4: Add health fields and package script**

Extend `/api/health` without PII:

```json
{
  "checks": {
    "newsletter": {
      "status": "healthy|quiet|blocked|stale|unknown",
      "enabled": false,
      "sourceRevision": "...",
      "latestRunDate": "yyyy-mm-dd|null",
      "latestRunStatus": "...|null",
      "lastHeartbeatAt": "ISO|null",
      "lastMeaningfulWorkAt": "ISO|null",
      "attempted": 0,
      "accepted": 0,
      "unknown": 0,
      "wahaReady": false
    }
  }
}
```

`quiet` is valid only when disabled or the SGT send window has not arrived. Missing/old heartbeat after the window is `stale`, not healthy.

- [ ] **Step 5: Implement the verifier and runbook**

The verifier checks exact hostname argument/default, deployed revision marker, app health, WAHA session, migration objects, timer/service states, last heartbeat freshness, nonzero all-time accepted count after go-live, log directory permissions/retention, and latest run/report counts. It exits nonzero on absence. The runbook documents install-disabled, dry-run, controlled test, enable, unknown resolution, kill switch, rollback, and backup/restore prerequisites.

- [ ] **Step 6: Run local operations checks and commit**

```bash
bun test scripts/newsletter-ops.test.ts
bash -n scripts/run-whatsapp-newsletter-campaign.sh
bash -n scripts/verify-newsletter-campaign.sh
systemd-analyze verify systemd/smartprop-whatsapp-newsletter.service systemd/smartprop-whatsapp-newsletter.timer || test "$(uname -s)" = Darwin
git add smartprop/scripts/run-whatsapp-newsletter-campaign.sh smartprop/scripts/verify-newsletter-campaign.sh smartprop/scripts/newsletter-ops.test.ts smartprop/systemd/smartprop-whatsapp-newsletter.service smartprop/systemd/smartprop-whatsapp-newsletter.timer smartprop/docs/WHATSAPP_NEWSLETTER_OPERATIONS.md smartprop/src/app/api/health/route.ts smartprop/package.json
git commit -m "feat: operate and verify WhatsApp newsletter runner"
```

---

### Task 6: Branch Integration, Review And Staged Production Rollout

**Files:**
- Modify only files required by reviewer findings.
- Create deployment claim evidence outside git under `.superpowers/`.

**Interfaces:**
- Consumes all prior tasks.
- Produces a reviewed branch and a staged production deployment with timer disabled until the controlled test gate passes.

- [ ] **Step 1: Run full local verification**

```bash
bun test scripts/newsletter-compose.test.ts scripts/newsletter-*.test.ts
bun run typecheck
bun run lint
bun run build
git diff --check main...HEAD
```

Expected: all commands exit 0. If repository-wide lint has pre-existing failures, record exact files and run focused lint for every changed TS/TSX file; do not call full lint passing.

- [ ] **Step 2: Run final diff review and fix all Critical/Important findings**

Use a fresh maximum-judgment reviewer with the complete `main...HEAD` package. Re-run focused tests after fixes and then repeat the full local gate.

- [ ] **Step 3: Run deterministic production-readiness audit before mutation**

```bash
~/.codex/bin/ultracode audit "SmartProp automatic WhatsApp newsletter campaign" --scope diff --base main --cwd /Users/vincent/propertydemo-whatsapp-campaign
```

Resolve confirmed Critical/Important findings before deployment.

- [ ] **Step 4: Verify exact production target and backup state**

Read-only checks must confirm:

```text
Provider/project: Supabase pfdsmpfgwbbeijdzevpu
Host: root@109.123.239.107:2222
Hostname: vmi3201429
Region: current provider region recorded from host/provider metadata
App: /opt/smartprop/app/smartprop
Process: PM2 smartprop
WAHA: 127.0.0.1:3030/default
Impact: additive DB migration, application restart, install disabled systemd units; no lead send yet
```

Create timestamped source/env/unit backups. Verify a database backup exists and perform a scratch restore or explicitly downgrade the deployment claim and keep the timer disabled.

- [ ] **Step 5: Apply migration with proof, deploy exact commit, build and restart**

Do not use legacy hard-reset deploy scripts. Apply `019` through a connection that returns SQL errors; then run schema assertions against production fixtures inside a rollback transaction. Rsync only reviewed files or deploy the exact pushed commit. Write `.deploy-source-revision`, build with Bun, reload PM2, install units disabled, and verify file hashes/source revision.

- [ ] **Step 6: Run production-data dry-run with no writes/sends**

Prove the approved issue resolves, five candidates render, operator config validates, project-level valuation is labeled correctly, and CRM/ledger row counts do not change.

- [ ] **Step 7: Relink and controlled test gate**

Require WAHA `WORKING`. Run the ledgered `test-send` override to the approved test number `+6591051399`; confirm provider message ID, `is_test=true`, `override_phone`, no CRM lead exists for the operator number, and the source lead's CRM status/activity did not change. Then validate STOP separately against a disposable non-operator CRM fixture and confirm suppression/queued cancellation without placing the operator number in CRM.

- [ ] **Step 8: Enable only after all go-live gates pass**

Set `SMARTPROP_NEWSLETTER_ENABLED=1`, enable/start the timer, verify reboot persistence without triggering an extra run, test absence alert delivery, and run `verify-newsletter-campaign.sh`. If it is after 10:30 SGT, account for `Persistent=true` immediate execution before enabling.

- [ ] **Step 9: Fresh-context live gate**

Write a claim file with exact host, revision, migration, service/timer state, WAHA state, controlled-send evidence, STOP evidence, report evidence, backup/restore status, alert test, resource caps, and negative evidence. Run:

```bash
~/.codex/bin/ultracode gate --task "Deploy SmartProp automatic WhatsApp newsletter campaign" --claim-file <claim-file>
```

Exit nonzero means sendback. Do not claim live completion. If backups/restore, independent alerting, QR relink, or controlled send remain unverified, leave the timer disabled and report the system as staged, not live.
