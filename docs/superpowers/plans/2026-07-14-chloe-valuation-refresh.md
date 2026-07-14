# Chloe Newsletter Valuation Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Chloe's daily source-backed project valuation research and cache population before the deterministic five-per-day WhatsApp campaign, without giving Chloe recipient-selection, CRM-write, database-shell, or direct-send authority.

**Architecture:** PostgreSQL atomically chooses the same oldest active newsletter issue for valuation preparation and sending, snapshots a PII-redacted project research item, and owns run/item/cache state transitions. A pure TypeScript evidence validator applies a source-controlled registry and current-evidence contract before a restricted CLI calls secured RPCs. The send runner admits only a terminal healthy current-day preparation run and one exact project-slug/current-contract valuation. A forced-command SSH account lets Chloe invoke only queue, heartbeat, import, and complete; the existing WAHA runner remains the only sender.

**Tech Stack:** PostgreSQL/Supabase migrations and security-definer RPCs, TypeScript/Bun, Next.js health route, Bash forced-command wrappers, OpenSSH, OpenClaw cron, systemd, WAHA.

## Global Constraints

- Work only in `/Users/vincent/propertydemo-valuation-refresh` on `codex/chloe-valuation-refresh`; do not alter the dirty checkout at `/Users/vincent/propertydemo`.
- Use additive migration `020_add_chloe_valuation_refresh.sql`; never rewrite migrations `017` or `019`.
- `crm_projects.slug`, `newsletter_issues.audience_project_slug`, and `propnex_valuations.project_slug` are the same exact identity. Fuzzy title matching is forbidden.
- Current evidence contract is `chloe-valuation-v1`; only `accepted` rows with `medium` or `high` confidence and `expires_at > now()` are send-eligible. Legacy rows are never grandfathered.
- PostgreSQL owns Singapore-calendar time, lease issuance, agent identity, source revision, cache expiry, item counts, and terminal run status. Chloe can submit evidence or blockers but cannot supply or override those fields.
- Every queue claim returns a server-issued UUID lease token. Heartbeat, import, and completion require that exact token; the token is never logged or included in Chloe's final report.
- `newsletter_valuation_runs.issue_id` is nullable. One `NULL` issue row per SGT date represents the required no-approved-issue `quiet` result.
- The active cache has at most one accepted `chloe-valuation-v1` row per exact project slug because `address_key = 'project:' || project_slug` is unique. The campaign keeps the approved min/median/max aggregation contract; current workflow input therefore contains zero or one supported row.
- Chloe receives no lead name, phone, email, notes, or arbitrary SQL/DB access. She cannot choose recipients or call WAHA.
- A research item requires two HTTPS sources from different registry ownership groups. At least one must be transaction or official-valuation evidence dated within twelve months; `asOf` must be no more than seven days old.
- Valuation runs start at 08:30 SGT, must finish by 09:20, and gate the existing 09:30 send runner. `blocked`, `failed`, missing, stale, or running preparation prevents every provider POST.
- Current-day candidate-present runs with zero accepted imports are `blocked`; partial success is `completed` with explicit rejected/blocked counts; zero candidates is `quiet`.
- The existing campaign timer stays at `01:30 UTC` and retries recoverable exit `10` until the 10:30 SGT cutoff.
- The OpenClaw valuation job and SmartProp send timer remain disabled through deployment and dry-run verification. The controlled `test-send` to `+6591051399` is a separate real-send gate.
- SmartProp target for later approved deployment: Contabo `vmi3201429`, `109.123.239.107:2222`, Singapore, `/opt/smartprop/app/smartprop`.
- Chloe target for later approved deployment: Contabo Asia Singapore `vmi3136623`, `194.233.94.3`, `/root/.openclaw/workspace`.
- Never put Supabase or WAHA credentials on the Chloe host.
- Every behavior change follows RED -> GREEN -> REFACTOR, with the named focused test run before each task commit.

---

### Task 1: Add The Atomic Valuation Preparation State Machine

**Files:**
- Create: `smartprop/migrations/020_add_chloe_valuation_refresh.sql`
- Create: `smartprop/scripts/valuation-refresh-migration.test.ts`
- Create: `smartprop/scripts/valuation-refresh-schema-assertions.sql`

**Interfaces:**
- Produces tables `newsletter_valuation_runs` and `newsletter_valuation_items`.
- Extends `crm_projects` with `valuation_location`, `valuation_property_type`, `valuation_tenure`, `valuation_area_distribution`, and `valuation_profile_updated_at`.
- Extends `propnex_valuations` with `project_slug`, `evidence_status`, `evidence_contract_version`, `evidence_item_id`, and `validated_confidence`.
- Produces RPCs:
  - `claim_newsletter_valuation_run(p_worker_id text, p_source_revision text) RETURNS jsonb`
  - `heartbeat_newsletter_valuation_run(p_run_id uuid, p_lease_token uuid) RETURNS jsonb`
  - `record_newsletter_valuation_item(p_run_id uuid, p_item_id uuid, p_lease_token uuid, p_outcome jsonb) RETURNS jsonb`
  - `complete_newsletter_valuation_run(p_run_id uuid, p_lease_token uuid) RETURNS jsonb`
  - `get_newsletter_valuation_gate(p_issue_id uuid) RETURNS jsonb`
  - `claim_newsletter_run(text,uuid)` for an explicit prepared issue.
- Produces internal `resolve_active_newsletter_issue()` used by preparation. The
  send runner passes the already resolved/prepared issue ID to the two-argument
  claim RPC, which rechecks that issue is still active. Migration `020` also
  replaces the legacy one-argument RPC with a forward-compatible shim that uses
  the same oldest-active ordering, calls the same database-owned current-day
  valuation gate, and retains `service_role` execute permission. Thus restoring
  the previous application revision cannot bypass preparation even through a
  manual invocation.

- [ ] **Step 1: Write migration contract tests**

Create tests that read migration `020` and assert the exact tables, statuses, unique keys, immutable item trigger, RPC signatures, `SECURITY DEFINER`, `SET search_path = public, pg_temp`, role revocations, exact project-slug index, accepted-contract predicates, and replacement `claim_newsletter_run` ordering.

```ts
test('binds preparation and sending to the same oldest active issue', () => {
  expect(sql).toMatch(/ORDER BY approved_at ASC NULLS LAST, created_at ASC, id ASC/is);
  expect(sql).toContain('FUNCTION claim_newsletter_run(p_claim_token text, p_issue_id uuid)');
  expect(sql).toMatch(/claim_newsletter_run[\s\S]+WHERE issue\.id = p_issue_id[\s\S]+status IN \('approved', 'sending'\)/i);
});

test('keeps one no-issue run per SGT day and preserves rollback compatibility', () => {
  expect(sql).toMatch(/UNIQUE NULLS NOT DISTINCT\s*\(run_date, issue_id\)/i);
  expect(sql).toContain('FUNCTION claim_newsletter_run(p_claim_token text)');
  expect(sql).toMatch(/claim_newsletter_run[\s\S]+ORDER BY approved_at ASC NULLS LAST, created_at ASC, id ASC/i);
  expect(sql).toMatch(/claim_newsletter_run[\s\S]+get_newsletter_valuation_gate/i);
});

test('requires the server-issued lease for every mutating follow-up RPC', () => {
  expect(sql).toContain('heartbeat_newsletter_valuation_run(p_run_id uuid, p_lease_token uuid)');
  expect(sql).toContain('record_newsletter_valuation_item(p_run_id uuid, p_item_id uuid, p_lease_token uuid, p_outcome jsonb)');
  expect(sql).toContain('complete_newsletter_valuation_run(p_run_id uuid, p_lease_token uuid)');
});

test('blocks candidate-present zero-acceptance completion atomically', () => {
  expect(sql).toMatch(/candidate_count > 0[\s\S]+accepted_count = 0[\s\S]+'blocked'/i);
});

test('never grants direct cache or audit writes to service_role', () => {
  expect(sql).toMatch(/REVOKE ALL ON (TABLE )?newsletter_valuation_runs FROM anon, authenticated, service_role/i);
  expect(sql).toMatch(/REVOKE ALL ON (TABLE )?newsletter_valuation_items FROM anon, authenticated, service_role/i);
});
```

- [ ] **Step 2: Run the migration test and verify RED**

Run: `cd smartprop && bun test scripts/valuation-refresh-migration.test.ts`

Expected: FAIL because migration `020` does not exist.

- [ ] **Step 3: Write executable PostgreSQL assertions and verify behavior RED**

Create `scripts/valuation-refresh-schema-assertions.sql` before production SQL.
The transaction must prove no-issue quiet uniqueness, claim idempotency, lease
rotation only on stale reclaim, immutable identity/profile snapshots, cross-run
and wrong-lease record rejection, accepted/rejected/blocked/failed persistence,
identical replay, conflicting replay rejection, later-run changed-evidence audit
retention, zero-accepted blocking, partial completion, exact project key,
direct-role denial, both campaign-claim signatures, database-owned gate
enforcement on both signatures, and index use for the accepted exact-slug lookup.

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/valuation-refresh-schema-assertions.sql`

Expected RED: exits nonzero with `relation "newsletter_valuation_runs" does not exist` or `function claim_newsletter_valuation_run(text,text) does not exist`.

- [ ] **Step 4: Implement the additive schema and state transitions**

Use these status and identity contracts:

```sql
status TEXT NOT NULL CHECK (status IN ('running','completed','quiet','blocked','failed'));
UNIQUE NULLS NOT DISTINCT (run_date, issue_id);
UNIQUE (run_id, project_slug);
CHECK (project_slug = lower(project_slug));
```

`newsletter_valuation_runs.issue_id` is `UUID NULL REFERENCES newsletter_issues(id)`. `lease_token UUID NOT NULL DEFAULT gen_random_uuid()` is rotated only on initial claim or stale reclaim. `claim_newsletter_valuation_run` takes a transaction-scoped advisory lock, resolves the oldest `approved|sending` issue, and creates a terminal `quiet` no-item run when none exists. Otherwise it snapshots issue/project/profile, selects at most five otherwise-eligible leads without returning PII, creates one item per exact project slug, and stale-reclaims only `running` claims older than fifteen minutes. It stores both lead candidate count and distinct project item count. Its JSON result contains `leaseToken`, nullable `issueId`/`issueSlug`, run metadata, and the redacted items.

`record_newsletter_valuation_item` locks run then item, verifies the lease, and accepts exactly one normalized outcome shape: `{kind:'accepted', evidence: ValidatedValuationEvidence}`, `{kind:'rejected', errorCode:string, errorDetail:string, evidenceHash:string|null}`, `{kind:'blocked', reason:string, attemptedSources:string[]}`, or `{kind:'failed', reason:string, retryable:boolean}`. Accepted outcomes atomically upsert one cache row using `address_key='project:' || project_slug`, `project_slug` from the immutable item snapshot, and server-owned expiry, then link the item/cache IDs. Replaying the same terminal outcome is idempotent; a different second outcome is rejected. Changed evidence on a later SGT run creates a new immutable item record before replacing the one active cache row. Rejected, blocked, and failed outcomes remain queryable and never alter the cache.

`complete_newsletter_valuation_run` derives counts from items and sets: zero candidates -> `quiet`; at least one accepted -> `completed`; zero accepted with any failed item -> `failed`; zero accepted with only rejected/blocked items -> `blocked`.

Both campaign-claim signatures must call an internal
`assert_newsletter_valuation_gate(p_issue_id uuid)` after issue resolution and
before inserting/reclaiming a send run. It uses database SGT time and raises
SQLSTATE `55000` unless the exact current-day issue has terminal healthy
`completed|quiet` preparation with a non-stale heartbeat. This is defense in
depth beneath both current and rolled-back application code.

Revoke all direct privileges on the new run/item tables and direct cache writes
from client roles, then grant `service_role` only the `SELECT` privileges needed
by health/read paths. Grant execute only on the five valuation RPCs plus both
campaign-claim signatures. Revoke execute on every internal helper. Both
campaign-claim signatures resolve `approved|sending` issues in ascending
`approved_at NULLS LAST, created_at, id` order; the two-argument form additionally
requires that its explicit issue remains active.

- [ ] **Step 5: Apply migration to the disposable test database and rerun assertions**

Run:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/020_add_chloe_valuation_refresh.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/valuation-refresh-schema-assertions.sql
```

Expected: transaction rolls back after printing `valuation refresh schema assertions passed`.

- [ ] **Step 6: Run focused tests and commit**

Run: `cd smartprop && bun test scripts/valuation-refresh-migration.test.ts scripts/newsletter-migration.test.ts`

Expected: all tests pass.

```bash
git add smartprop/migrations/020_add_chloe_valuation_refresh.sql smartprop/scripts/valuation-refresh-migration.test.ts smartprop/scripts/valuation-refresh-schema-assertions.sql
git commit -m "feat: add valuation preparation state machine"
```

---

### Task 2: Implement The Source Registry And Evidence Contract

**Files:**
- Create: `smartprop/src/lib/newsletter/valuation-source-registry.ts`
- Create: `smartprop/src/lib/newsletter/valuation-evidence.ts`
- Create: `smartprop/scripts/valuation-evidence.test.ts`
- Modify: `smartprop/src/lib/newsletter/campaign-types.ts`
- Modify: `smartprop/src/lib/newsletter/valuation.ts`
- Modify: `smartprop/scripts/newsletter-rules.test.ts`

**Interfaces:**
- Produces `VALUATION_EVIDENCE_CONTRACT = 'chloe-valuation-v1'`.
- Produces `resolveValuationSource(url: string): RegisteredValuationSource | null`.
- Produces `validateValuationEvidence(input: unknown, context: ValuationEvidenceContext): ValidatedValuationEvidence`.
- Preserves `aggregateProjectValuation(projectSlug, rows, now)` and changes only its support predicate to exact slug/current contract.
- Extends `NewsletterValuationSnapshot` with `evidenceItemId`, `valuationId`, `projectSlug`, `evidenceContractVersion`, and `confidence` for immutable send audit propagation.

Use these exact contracts:

```ts
type AcquisitionMethod = 'propnex' | 'ura' | 'public-comparables';
type EvidenceConfidence = 'medium' | 'high';

interface ValuationEvidenceContext {
  projectSlug: string;
  projectTitle: string;
  location: string;
  propertyType: string;
  tenure: string;
  areaDistribution: Array<{ areaSqft: number; count: number }>;
  runDate: string;
  now: Date;
  agentIdentity: string;
  sourceRevision: string;
}

interface NewsletterValuationSnapshot {
  basis: 'project-level';
  lowSgd: number | null;
  midSgd: number | null;
  highSgd: number | null;
  comparablesCount: number;
  asOf: string | null;
  evidenceItemId: string;
  valuationId: string;
  projectSlug: string;
  evidenceContractVersion: 'chloe-valuation-v1';
  confidence: EvidenceConfidence;
}
```

- [ ] **Step 1: Write failing registry and evidence tests**

Cover canonical HTTPS parsing, URL credentials, ports, redirects supplied as URLs, look-alike suffixes, unregistered domains, caller-supplied ownership/classification overrides, same-owner duplicate sources, stale/future dates, no recent transaction source, low confidence, inverted ranges, missing midpoint/range, unit/address identity, source detail/content hash, and deterministic evidence hashing.

```ts
test('rejects two hostnames owned by the same source group', () => {
  expect(() => validateValuationEvidence(inputWithSources(
    'https://eservice.ura.gov.sg/a',
    'https://data.gov.sg/b',
  ), context)).toThrow('two independent source ownership groups');
});

test('rejects a fresh legacy cache row without the current evidence contract', () => {
  expect(aggregateProjectValuation('cliften', [legacyRow], now)).toBeNull();
});

test('carries the accepted evidence item into the immutable send snapshot', () => {
  expect(aggregateProjectValuation('cliften', [acceptedRow], now)).toMatchObject({
    evidenceItemId: acceptedRow.evidence_item_id,
    valuationId: acceptedRow.id,
    projectSlug: 'cliften',
    evidenceContractVersion: 'chloe-valuation-v1',
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd smartprop && bun test scripts/valuation-evidence.test.ts scripts/newsletter-rules.test.ts`

Expected: FAIL because the source registry, validator, and strict selector do not exist.

- [ ] **Step 3: Implement the reviewed initial registry**

The registry derives name, ownership group, and allowed evidence classes from the canonical hostname. Initial reviewed groups are:

```ts
export const VALUATION_SOURCES = [
  { hostname: 'eservice.ura.gov.sg', group: 'singapore-government', classes: ['official-valuation', 'transaction'] },
  { hostname: 'data.gov.sg', group: 'singapore-government', classes: ['transaction'] },
  { hostname: 'edgeprop.sg', group: 'edgeprop', classes: ['transaction', 'market-analysis'] },
  { hostname: '99.co', group: '99co', classes: ['transaction', 'market-analysis'] },
  { hostname: 'srx.com.sg', group: 'srx', classes: ['transaction', 'market-analysis'] },
  { hostname: 'propertyguru.com.sg', group: 'propertyguru', classes: ['transaction', 'market-analysis', 'listing'] },
  { hostname: 'homejourney.sg', group: 'homejourney', classes: ['transaction', 'market-analysis'] },
  { hostname: 'nexthome.sg', group: 'nexthome', classes: ['transaction', 'market-analysis'] },
  { hostname: 'propnex.com', group: 'propnex', classes: ['official-valuation', 'transaction', 'market-analysis'] },
] as const;
```

Exact host or subdomain matching is permitted only by parsing `URL.hostname` and checking `hostname === registered || hostname.endsWith('.' + registered)`. Reject credentials, non-default ports, fragments, and non-HTTPS URLs.

- [ ] **Step 4: Implement pure evidence validation and strict cache selection**

`validateValuationEvidence` receives the complete server-owned
`ValuationEvidenceContext` above; caller input cannot replace project identity,
property profile, agent identity, source revision, run date, or clock. It checks
that evidence describes the same project/property type and that any area used is
represented by the server-owned area distribution. It returns normalized
numbers, one exact `AcquisitionMethod`, source metadata derived from the
registry, SHA-256 evidence hash, `asOf`, server-side `expiresAt = now + 30 days`,
registry revision, agent identity/source revision from context, and content-hash
algorithm `sha256-utf8-v1`.

Preserve the approved valuation composition: minimum supported low, median
supported midpoint, maximum supported high, total comparables, and newest
`asOf`. Replace only fuzzy title matching with exact `project_slug` plus current
contract/status/confidence/expiry predicates. Migration `020`'s unique
`address_key='project:' || project_slug` active-cache key means the new workflow
normally supplies exactly one supported row, while the aggregation function
remains backward-compatible and deterministic for typed test fixtures.

- [ ] **Step 5: Run focused tests and commit**

Run: `cd smartprop && bun test scripts/valuation-evidence.test.ts scripts/newsletter-rules.test.ts`

Expected: all tests pass.

```bash
git add smartprop/src/lib/newsletter/valuation-source-registry.ts smartprop/src/lib/newsletter/valuation-evidence.ts smartprop/src/lib/newsletter/campaign-types.ts smartprop/src/lib/newsletter/valuation.ts smartprop/scripts/valuation-evidence.test.ts smartprop/scripts/newsletter-rules.test.ts
git commit -m "feat: validate newsletter valuation evidence"
```

---

### Task 3: Build The PII-Redacted Research Queue And Restricted CLI

**Files:**
- Create: `smartprop/src/lib/newsletter/valuation-store.ts`
- Create: `smartprop/src/lib/newsletter/valuation-local-status.ts`
- Create: `smartprop/scripts/run-chloe-valuation-refresh.ts`
- Create: `smartprop/scripts/valuation-refresh-cli.test.ts`
- Modify: `smartprop/package.json`
- Modify: `smartprop/scripts/newsletter-campaign-runner.test.ts`

**Interfaces:**
- Produces `ValuationStore.claimQueue()`, `heartbeat()`, `importItem()`, `complete()`, `loadGate()`, and local-only `setProjectProfile()`.
- Produces atomic root-owned local status at `/var/lib/smartprop/newsletter-valuation-status.json` so a database/RPC failure that cannot be recorded in PostgreSQL still leaves a redacted failure artifact for health and recovery.
- Produces CLI commands:
  - `queue --json`
  - `heartbeat --run-id UUID --lease-token UUID --json`
  - `import --run-id UUID --item-id UUID --lease-token UUID --json` with one submission union on stdin
  - `complete --run-id UUID --lease-token UUID --json`
  - local operator-only `set-project-profile --project-slug SLUG --input FILE --json`

Exact store signatures are:

```ts
interface ValuationStore {
  claimQueue(): Promise<ValuationQueue>;
  heartbeat(runId: string, leaseToken: string): Promise<ValuationRunResult>;
  importItem(runId: string, itemId: string, leaseToken: string, outcome: RecordedValuationOutcome): Promise<ValuationItemResult>;
  complete(runId: string, leaseToken: string): Promise<ValuationRunResult>;
  loadGate(issueId: string): Promise<ValuationGate>;
  setProjectProfile(projectSlug: string, profile: ValuationProjectProfile): Promise<void>;
}

type ValuationSubmission =
  | { kind: 'evidence'; evidence: unknown }
  | { kind: 'blocked'; reason: string; attemptedSources: string[] }
  | { kind: 'failed'; reason: string; retryable: boolean };

type RecordedValuationOutcome =
  | { kind: 'accepted'; evidence: ValidatedValuationEvidence }
  | { kind: 'rejected'; errorCode: string; errorDetail: string; evidenceHash: string | null }
  | { kind: 'blocked'; reason: string; attemptedSources: string[] }
  | { kind: 'failed'; reason: string; retryable: boolean };
```

- [ ] **Step 1: Write failing store/CLI tests**

Use injected fake Supabase, environment, clock, stdin, and local-status adapters. Assert stable queue order, five-lead cap, one project item, nullable no-issue quiet output, no `name|phone|email|notes`, incomplete project profile blocker, exact RPC names/arguments, lease required on every follow-up command, bounded 256 KiB import stdin, UUID validation, JSON-only stdout, no lease/secret logging, idempotent replay, and no caller-controlled project/profile/agent/revision/clock fields. Prove malformed/weak evidence is converted to a persisted `rejected` outcome, source outage can be persisted as `blocked`, unexpected research failure can be persisted as `failed`, and an RPC/database error atomically writes a redacted local `failed` artifact before nonzero exit.

```ts
test('queue output contains no recipient PII fields', async () => {
  const result = await runCli(['queue', '--json'], fixtures);
  const text = JSON.stringify(result);
  for (const forbidden of ['phone', 'email', 'leadName', 'notes']) expect(text).not.toContain(forbidden);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd smartprop && bun test scripts/valuation-refresh-cli.test.ts scripts/newsletter-campaign-runner.test.ts`

Expected: FAIL because the valuation store and CLI do not exist.

- [ ] **Step 3: Implement the store and CLI**

Use the same dotenv/Supabase initialization pattern as `run-whatsapp-newsletter-campaign.ts`. Keep all DB writes inside Task 1 RPCs. `VALUATION_WORKER_ID` and `VALUATION_SOURCE_REVISION` are mandatory SmartProp-host environment variables consumed only by `queue`; they are passed to `claim_newsletter_valuation_run` and cannot be supplied as CLI flags or stdin. `set-project-profile` is rejected when `SSH_ORIGINAL_COMMAND` is present and is never exposed by the forced-command wrapper.

For `import`, parse one `ValuationSubmission`. Evidence submissions are
validated against the immutable queue item context. On validation error, map
the validator's stable code/detail and canonical-input hash to a `rejected`
`RecordedValuationOutcome`, call `record_newsletter_valuation_item`, and return a
JSON rejected result instead of dropping the audit. Blocked/failed submissions
are bounded and normalized before the same RPC. Supabase/database errors
atomically write local JSON with `status:'failed'`, command, run/item IDs when
known, timestamp, stable error code, and redacted message, then exit nonzero
without claiming that the database outcome was recorded. The artifact excludes
stdin, lease, URLs, keys, and recipient data; the stale database lease keeps
sending fail-closed until recovery.

Queue JSON shape:

```ts
{
  runId: string;
  leaseToken: string;
  issueId: string | null;
  issueSlug: string | null;
  runDate: string;
  deadlineSgt: '09:20';
  candidates: Array<{
    itemId: string;
    projectSlug: string;
    projectTitle: string;
    location: string;
    propertyType: string;
    tenure: string;
    areaDistribution: Array<{ areaSqft: number; count: number }>;
    candidateCount: number;
    reason: 'missing' | 'expired' | 'unsupported';
  }>;
}
```

Stdout may contain the lease token only in the `queue` machine response used by
the next restricted commands. Heartbeat/import/complete responses and Chloe's
human report omit it. Logs redact UUID arguments and stdin entirely.

- [ ] **Step 4: Run focused tests and commit**

Run: `cd smartprop && bun test scripts/valuation-refresh-cli.test.ts scripts/newsletter-campaign-runner.test.ts`

Expected: all tests pass.

```bash
git add smartprop/src/lib/newsletter/valuation-store.ts smartprop/src/lib/newsletter/valuation-local-status.ts smartprop/scripts/run-chloe-valuation-refresh.ts smartprop/scripts/valuation-refresh-cli.test.ts smartprop/scripts/newsletter-campaign-runner.test.ts smartprop/package.json
git commit -m "feat: add Chloe valuation research CLI"
```

---

### Task 4: Gate Campaign Sending On Current Accepted Valuation Preparation

**Files:**
- Modify: `smartprop/src/lib/newsletter/campaign-store.ts`
- Modify: `smartprop/src/lib/newsletter/campaign-runner.ts`
- Modify: `smartprop/src/lib/newsletter/campaign-types.ts`
- Modify: `smartprop/scripts/newsletter-campaign-runner.test.ts`
- Modify: `smartprop/scripts/newsletter-rules.test.ts`

**Interfaces:**
- Extends `CampaignStore` with `claimToday(claimToken, issueId)`,
  `loadValuationGate(issueId)`, and
  `countValuationBlockedLeads(issueId)`.
- Adds `ValuationPreparationBlockedError` mapped to recoverable exit `10`.
- Candidate valuation query is exact, index-backed, current-contract-only, and fails closed if the one-active-row invariant is broken.
- Candidate, queue/test-send RPC input, `newsletter_sends.valuation_snapshot`, and operator report all retain the exact evidence item/cache identifiers from `NewsletterValuationSnapshot`.

- [ ] **Step 1: Write failing campaign integration tests**

Cover no run, wrong issue, yesterday run, stale heartbeat, running, blocked, failed, quiet, completed partial success, issue change from 08:30 to 09:30, database-owned SGT gates at 09:29/09:30/10:29/10:30, no WAHA readiness call before gate, no run claim/finish/provider POST on gate failure, exact slug, legacy/fuzzy rejection, duplicate-active-row invariant failure, evidence item propagation through real/test queue snapshots, and issue non-completion while otherwise eligible leads lack valuation.

```ts
test('blocked preparation exits recoverably before WAHA or campaign claim', async () => {
  const result = await runNewsletterCampaign(depsWithGate('blocked'));
  expect(result.status).toBe('blocked');
  expect(calls).toEqual(['resolveIssue', 'loadValuationGate']);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd smartprop && bun test scripts/newsletter-campaign-runner.test.ts scripts/newsletter-rules.test.ts`

Expected: FAIL because the preparation gate and exact cache query are absent.

- [ ] **Step 3: Implement the pre-claim gate and exact candidate query**

Execution order becomes: resolve oldest issue -> load current-day valuation gate
for exact issue -> return blocked if unhealthy -> WAHA readiness -> claim send
run by passing that exact `issue.id` -> verify the returned run retains the same
issue -> select exact accepted valuation -> queue/send. Dry-run must still
evaluate and report the gate but perform no writes or provider calls.

`get_newsletter_valuation_gate(p_issue_id uuid)` computes current SGT date,
cutoffs, freshness, and status inside PostgreSQL; production TypeScript passes
no caller clock. Unit tests inject the RPC response, not a production reference
time.

Replace the paginated full-cache query with the following index-backed query.
Use `.limit(2)` deliberately: zero rows means unsupported and two rows is an
invariant violation that must fail closed. Pass the resulting zero-or-one row
to the preserved `aggregateProjectValuation` contract.

```ts
client.from('propnex_valuations')
  .select('id,project_slug,low_sgd,mid_sgd,high_sgd,comparables_count,as_of,expires_at,evidence_item_id,validated_confidence,evidence_contract_version,evidence_status,fetched_at')
  .eq('project_slug', issue.audienceProjectSlug)
  .eq('evidence_status', 'accepted')
  .eq('evidence_contract_version', VALUATION_EVIDENCE_CONTRACT)
  .in('validated_confidence', ['medium', 'high'])
  .gt('expires_at', referenceTime.toISOString())
  .order('fetched_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(2);
```

Select `id` and `evidence_item_id`, construct the extended
`NewsletterValuationSnapshot`, and pass it unchanged as
`p_valuation_snapshot` in both `queue_newsletter_attempt` and
`queue_newsletter_test_send`. Existing append-only protections on
`newsletter_sends.valuation_snapshot` make the evidence link immutable.

- [ ] **Step 4: Run focused tests and commit**

Run: `cd smartprop && bun test scripts/newsletter-campaign-runner.test.ts scripts/newsletter-rules.test.ts scripts/newsletter-waha.test.ts`

Expected: all tests pass and every blocked-gate case records zero provider calls.

```bash
git add smartprop/src/lib/newsletter/campaign-store.ts smartprop/src/lib/newsletter/campaign-runner.ts smartprop/src/lib/newsletter/campaign-types.ts smartprop/scripts/newsletter-campaign-runner.test.ts smartprop/scripts/newsletter-rules.test.ts
git commit -m "feat: gate newsletter sends on valuation preparation"
```

---

### Task 5: Add The Forced-Command SSH Boundary And Chloe Job

**Files:**
- Create: `smartprop/scripts/smartprop-valuation-ssh-wrapper.sh`
- Create: `smartprop/scripts/smartprop-valuation-launcher.sh`
- Create: `smartprop/scripts/install-smartprop-valuation-ssh.sh`
- Create: `smartprop/scripts/valuation-ssh-wrapper.test.ts`
- Create: `openclaw-skills/smartprop-crm/jobs/chloe-valuation-refresh.md`
- Create: `openclaw-skills/smartprop-crm/scripts/install-chloe-valuation-job.sh`
- Modify: `openclaw-skills/smartprop-crm/SKILL.md`
- Modify: `smartprop/scripts/chloe-newsletter-skill.test.ts`

**Interfaces:**
- Forced SSH grammar accepts only `queue --json` and the three exact lease-bearing command forms from Task 3.
- OpenClaw job name is `smartprop-chloe-valuation-refresh`, schedule `30 8 * * *`, timezone `Asia/Singapore`, exact/isolated/no-deliver, timeout 2700 seconds, disabled by default.
- Job installation requires `CHLOE_VALUATION_ALERT_TO`; OpenClaw failure alerts trigger after one consecutive failure through the configured operator channel while the job remains disabled until go-live.

- [ ] **Step 1: Write failing wrapper, job, and skill tests**

Test every allowed command plus missing/wrong lease, blank command, shell separators, substitutions, redirections, extra flags, malformed UUIDs, newline injection, 256 KiB+ stdin, `set-project-profile`, environment override, and arbitrary command rejection. Assert installer text creates `smartprop-valuation` as non-login, installs root-owned mode-0755 wrappers, writes `/etc/sudoers.d/smartprop-valuation` as root mode 0440 with only `smartprop-valuation ALL=(root) NOPASSWD: /usr/local/libexec/smartprop-valuation-launcher *`, validates it with `visudo -cf`, pins source IP `194.233.94.3`, uses `restrict,no-pty,no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-user-rc`, and never prints keys/secrets. Assert job installation refuses an empty alert destination and configures one-failure alerts.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd smartprop && bun test scripts/valuation-ssh-wrapper.test.ts scripts/chloe-newsletter-skill.test.ts`

Expected: FAIL because wrappers, job artifact, installer, and teaching are absent.

- [ ] **Step 3: Implement the no-shell command boundary**

The wrapper accepts only these anchored forms (UUID is lowercase/uppercase hex
`8-4-4-4-12`) and constructs an argument array from regex capture groups:

```text
queue --json
heartbeat --run-id UUID --lease-token UUID --json
import --run-id UUID --item-id UUID --lease-token UUID --json
complete --run-id UUID --lease-token UUID --json
```

It invokes:

```bash
exec /usr/bin/sudo -n /usr/local/libexec/smartprop-valuation-launcher "$command" "${validated_args[@]}"
```

It must never use `eval`, `bash -c`, `sh -c`, word-split the original string, or accept environment assignments. The launcher independently revalidates arguments, sets `PATH=/usr/local/bin:/usr/bin:/bin`, `HOME=/var/lib/smartprop-valuation`, and working directory `/opt/smartprop/app/smartprop`, loads `/etc/smartprop/smartprop.env` as root, and executes `/root/.bun/bin/bun scripts/run-chloe-valuation-refresh.ts`. Because OpenSSH invokes forced commands through the account shell, the installer creates a locked-password account with `/bin/bash`, a root-owned forced-command-only `authorized_keys`, and no unrestricted key. It installs both root-owned wrappers mode 0755, installs the exact sudoers rule above, pins source IP `194.233.94.3`, and never prints key material.

- [ ] **Step 4: Implement Chloe's immutable prompt, disabled installer, and skill workflow**

The prompt instructs Chloe to queue, heartbeat during research, use two independent registered sources, submit JSON evidence over stdin, complete the run, and report only counts/blockers. It explicitly forbids direct WhatsApp, recipient selection, SQL, manual cache updates, invented values, expiry extension, and printing PII.

The installer uses the verified OpenClaw 2026.6.11 syntax:

```bash
openclaw cron add \
  --name smartprop-chloe-valuation-refresh \
  --cron '30 8 * * *' --tz Asia/Singapore --exact \
  --agent main --session isolated --no-deliver \
  --timeout-seconds 2700 --tools 'exec web_search web_fetch browser read' \
  --message "$(cat "$prompt_path")" \
  --disabled --json

openclaw cron edit "$job_id" \
  --name smartprop-chloe-valuation-refresh \
  --cron '30 8 * * *' --tz Asia/Singapore --exact \
  --agent main --session isolated --no-deliver \
  --timeout-seconds 2700 --tools 'exec web_search web_fetch browser read' \
  --message "$(cat "$prompt_path")" \
  --failure-alert --failure-alert-after 1 \
  --failure-alert-channel whatsapp --failure-alert-to "$CHLOE_VALUATION_ALERT_TO" \
  --disable
```

OpenClaw 2026.6.11 exposes `--disabled --json` on `cron add`, while failure-alert
flags and `--disable` are available on `cron edit`. The installer therefore
creates a missing job disabled, obtains its exact ID from `openclaw cron list
--json`, and then edits that same job with the schedule, prompt, tools, disabled
state, and failure alerts. Existing jobs go directly through the edit path. The
installer fails if zero or multiple exact-name jobs are returned after
reconciliation. No scheduled execution occurs while disabled.

- [ ] **Step 5: Run focused tests, shell syntax, and commit**

Run:

```bash
cd smartprop
bun test scripts/valuation-ssh-wrapper.test.ts scripts/chloe-newsletter-skill.test.ts
bash -n scripts/smartprop-valuation-ssh-wrapper.sh scripts/smartprop-valuation-launcher.sh scripts/install-smartprop-valuation-ssh.sh ../openclaw-skills/smartprop-crm/scripts/install-chloe-valuation-job.sh
```

Expected: all tests and shell syntax checks pass.

```bash
git add smartprop/scripts/smartprop-valuation-ssh-wrapper.sh smartprop/scripts/smartprop-valuation-launcher.sh smartprop/scripts/install-smartprop-valuation-ssh.sh smartprop/scripts/valuation-ssh-wrapper.test.ts openclaw-skills/smartprop-crm/jobs/chloe-valuation-refresh.md openclaw-skills/smartprop-crm/scripts/install-chloe-valuation-job.sh openclaw-skills/smartprop-crm/SKILL.md smartprop/scripts/chloe-newsletter-skill.test.ts
git commit -m "feat: teach Chloe restricted valuation research"
```

---

### Task 6: Make Valuation Preparation Self-Verifiable

**Files:**
- Modify: `smartprop/src/lib/newsletter/newsletter-health.ts`
- Modify: `smartprop/src/app/api/health/route.ts`
- Modify: `smartprop/scripts/verify-newsletter-campaign.sh`
- Modify: `smartprop/scripts/newsletter-ops.test.ts`
- Create: `smartprop/scripts/monitor-newsletter-campaign.sh`
- Create: `smartprop/scripts/test-newsletter-absence-alert.sh`
- Create: `smartprop/systemd/smartprop-newsletter-monitor.service`
- Create: `smartprop/systemd/smartprop-newsletter-monitor.timer`
- Create: `openclaw-skills/smartprop-crm/scripts/verify-chloe-valuation-job.sh`
- Modify: `smartprop/docs/WHATSAPP_NEWSLETTER_OPERATIONS.md`
- Create: `smartprop/docs/CHLOE_VALUATION_REFRESH.md`

**Interfaces:**
- Health exposes valuation source revision, current SGT run date/status, heartbeat, last meaningful work, candidate/project/accepted/rejected/blocked/failed counts, newest accepted cache timestamp, latest redacted local RPC-failure artifact, rolling accepted-import rate, and `quiet|healthy|blocked|dead|disabled` state.
- Verifier checks schema, revision, job/timer coupling, cache/item linkage, current-run truth, rolling nonzero production, and no-send staging evidence.
- Alert test posts a unique check ID to the existing external alert receiver and polls its independent status endpoint until the same check has a received alert ID/timestamp; HTTP acceptance alone is failure.
- Monitor timer runs a fixed read-only verifier at 09:22, 09:37, 09:52, 10:07, and 10:22 SGT, posts signed success/failure check-ins to the independent receiver, and relies on that receiver's 20-minute missing-check policy to alert when the timer/host itself is absent.
- Chloe job verifier asserts exact schedule/tools/timeout/disabled-or-live state, one-failure alert configuration, last run outcome, and deployed prompt revision.

- [ ] **Step 1: Write failing health/verifier/operations tests**

Cover disabled, pre-08:30, no current run after 08:30, running fresh, heartbeat-fresh but output-stale, running stale, missing heartbeat, quiet zero-candidate terminal, blocked zero-accepted, completed partial success, accepted item without cache row, legacy row admission, next-day rollover, job enabled while sender disabled, sender enabled while valuation job disabled, absent/misconfigured job failure alert, exact monitor schedule, verifier success/failure check-ins, receiver missing-check contract, alert POST without receiver confirmation, and unchanged ledger/provider-attempt counts in staged verification.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd smartprop && bun test scripts/newsletter-ops.test.ts`

Expected: FAIL because valuation health and verifier probes are absent.

- [ ] **Step 3: Implement separate preparation health and verifier probes**

`quiet` requires a current-date terminal zero-candidate run. A missing run after 08:30, stale heartbeat, or incomplete run after 09:20 is never quiet. A current candidate-present zero-accepted run is blocked or failed according to its terminal item outcomes. `lastMeaningfulWorkAt` advances only on queue snapshot creation, any persisted item outcome, and terminal completion. Heartbeat updates only `lastHeartbeatAt`; a heartbeat-fresh but output-stale run is visibly wedged and never reported as productive. A newer local RPC-failure artifact overrides a superficially fresh database heartbeat and reports `dead` until a later successful database action clears it atomically.

The verifier's staged mode requires both the OpenClaw job and send timer disabled and proves real/test send-ledger and provider-attempt counts did not increase during dry-run deployment checks. Live mode requires both enabled, exact source revisions on both hosts, current terminal valuation state, accepted cache linkage when candidates existed, STOP proof, operator reports, and nonzero rolling success.

`test-newsletter-absence-alert.sh` requires
`SMARTPROP_NEWSLETTER_ALERT_TEST_URL`, `SMARTPROP_NEWSLETTER_ALERT_STATUS_URL`,
and `SMARTPROP_NEWSLETTER_ALERT_TOKEN`. It generates `checkId`, POSTs the test
event, then polls `GET $SMARTPROP_NEWSLETTER_ALERT_STATUS_URL?checkId=...` for
up to 120 seconds. Success requires JSON `received=true`, non-empty `alertId`,
and parseable `receivedAt` for that exact check. This proves both alert delivery
and monitor observability. `verify-chloe-valuation-job.sh` reads
`openclaw cron list --json` and `openclaw cron runs --id "$job_id" --json`; it
never edits or runs the job.

`monitor-newsletter-campaign.sh` executes the absolute
`/opt/smartprop/app/smartprop/scripts/verify-newsletter-campaign.sh
--expect=live --expected-revision="$EXPECTED_REVISION"` under `timeout 120`,
captures only exit code and a redacted 1 KiB tail, and POSTs a unique check-in to
`SMARTPROP_NEWSLETTER_MONITOR_URL` with bearer token
`SMARTPROP_NEWSLETTER_ALERT_TOKEN`. It exits nonzero when either verification or
check-in fails. The receiver is configured for expected check name
`smartprop-whatsapp-newsletter-heartbeat`, the five UTC schedule points, and a
20-minute grace window; missing check-ins alert the same operator independently
of this host. Unit hardening includes `Type=oneshot`, `User=root`,
`NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`,
`ProtectHome=true`, `MemoryMax=128M`, and `TimeoutStartSec=180`. The timer uses
`OnCalendar=*-*-* 01:22,01:37,01:52,02:07,02:22:00 UTC`, `Persistent=true`, and
`RandomizedDelaySec=0`; it remains disabled in staging.

- [ ] **Step 4: Write the operator runbook and rollback sequence**

Document:

1. Back up source/runtime/env/unit/SSH files and take a database backup.
2. Restore-test the backup before migration.
3. Apply migration `020` and run SQL assertions.
4. Populate the active project's server-owned valuation profile.
5. Install restricted SSH and pin `[109.123.239.107]:2222` host key on Chloe.
6. Install the disabled Chloe job and leave send timer disabled.
7. Run queue/import/complete and campaign dry-runs; prove no send/test ledger or provider counters moved.
8. Run the separately approved controlled `test-send` to `+6591051399`.
9. Verify STOP and operator report.
10. Enable Chloe job first, then send timer; verify alert delivery and reboot survival.
11. Roll back by disabling both jobs, preserving audit/cache rows, restoring runtime files, and never deleting send history.

The go-live proof assigns ownership explicitly:

- SmartProp absence monitoring: run `test-newsletter-absence-alert.sh` and retain
  returned `checkId`, `alertId`, and `receivedAt`.
- Scheduled detection: enable `smartprop-newsletter-monitor.timer` with the send
  timer, prove its exact next elapse, invoke the service once against a fixture
  failure, and confirm the receiver emits the matching alert. Then restore the
  fixed real verifier and prove a success check-in. Disabling the timer in the
  receiver's test window must produce a missing-check alert before re-enabling.
- Chloe job failures: `verify-chloe-valuation-job.sh --expect=live` must show
  `failureAlert.after=1` and the configured operator destination.
- Monitor-of-monitor: the external status endpoint must confirm the alert; a
  2xx POST without that confirmation fails the gate.
- Reboot survival: after a separately approved maintenance reboot of each exact
  host, prove the SmartProp timer is enabled/active, the OpenClaw gateway is
  healthy, the Chloe cron remains enabled with the same ID/revision, and both
  read-only verifiers pass. Without reboot evidence, report deployed but not
  production-ready.

- [ ] **Step 5: Run focused tests and commit**

Run: `cd smartprop && bun test scripts/newsletter-ops.test.ts scripts/chloe-newsletter-skill.test.ts`

Expected: all tests pass.

```bash
git add smartprop/src/lib/newsletter/newsletter-health.ts smartprop/src/app/api/health/route.ts smartprop/scripts/verify-newsletter-campaign.sh smartprop/scripts/monitor-newsletter-campaign.sh smartprop/scripts/test-newsletter-absence-alert.sh smartprop/systemd/smartprop-newsletter-monitor.service smartprop/systemd/smartprop-newsletter-monitor.timer openclaw-skills/smartprop-crm/scripts/verify-chloe-valuation-job.sh smartprop/scripts/newsletter-ops.test.ts smartprop/docs/WHATSAPP_NEWSLETTER_OPERATIONS.md smartprop/docs/CHLOE_VALUATION_REFRESH.md
git commit -m "feat: verify Chloe valuation preparation"
```

---

### Task 7: Run The Full Branch Gate And Prepare A No-Send Deployment

**Files:**
- Modify only files required by failures directly caused by Tasks 1-6.
- Do not create a second campaign verifier; Tasks 5-6 extend `verify-newsletter-campaign.sh` and add the Chloe-local read-only verifier.

**Interfaces:**
- Produces one local verification record and one deployment claim file for the live gate.

- [ ] **Step 1: Run the complete local newsletter suite**

Run:

```bash
cd smartprop
bun test \
  scripts/valuation-refresh-migration.test.ts \
  scripts/valuation-evidence.test.ts \
  scripts/valuation-refresh-cli.test.ts \
  scripts/valuation-ssh-wrapper.test.ts \
  scripts/chloe-newsletter-skill.test.ts \
  scripts/newsletter-campaign-runner.test.ts \
  scripts/newsletter-compose.test.ts \
  scripts/newsletter-migration.test.ts \
  scripts/newsletter-operator-report.test.ts \
  scripts/newsletter-ops.test.ts \
  scripts/newsletter-rules.test.ts \
  scripts/newsletter-waha.test.ts \
  scripts/newsletter-webhook.test.ts \
  scripts/newsletter-whatsapp-opt-out.test.ts
```

Expected: zero failures.

- [ ] **Step 2: Run static, shell, build, and diff checks**

Run:

```bash
cd smartprop
bun run typecheck
bunx eslint src/lib/newsletter scripts/run-chloe-valuation-refresh.ts scripts/valuation-*.test.ts src/app/api/health/route.ts
bash -n scripts/smartprop-valuation-ssh-wrapper.sh scripts/smartprop-valuation-launcher.sh scripts/install-smartprop-valuation-ssh.sh scripts/monitor-newsletter-campaign.sh scripts/test-newsletter-absence-alert.sh ../openclaw-skills/smartprop-crm/scripts/install-chloe-valuation-job.sh ../openclaw-skills/smartprop-crm/scripts/verify-chloe-valuation-job.sh scripts/verify-newsletter-campaign.sh
systemd-analyze verify systemd/smartprop-newsletter-monitor.service systemd/smartprop-newsletter-monitor.timer
bun run build
cd .. && git diff --check origin/main...HEAD
```

Expected: all commands exit 0.

- [ ] **Step 3: Run broad diff and production-readiness review**

Run:

```bash
~/.codex/bin/ultracode audit "Chloe valuation refresh and WhatsApp send gate" --cwd /Users/vincent/propertydemo-valuation-refresh --scope diff --base origin/main
```

For each verified critical/important finding, append a numbered remediation to
`.superpowers/sdd/progress.md`, write the smallest focused regression test and
run it to the expected RED failure, implement only that remediation, rerun the
focused test GREEN, and rerun Steps 1-2. One fresh reviewer then rechecks the
updated full diff. Minor findings are either fixed through the same RED/GREEN
cycle or recorded with an explicit reason they do not block this request.

- [ ] **Step 4: Commit integration fixes**

```bash
git add smartprop openclaw-skills
git commit -m "fix: close valuation refresh review findings"
```

Skip this commit when no files changed.

- [ ] **Step 5: Prepare deployment evidence without changing live state**

Record current exact identities and intended impact before any later deployment:

- SmartProp: Contabo `vmi3201429`, `109.123.239.107:2222`, Singapore; additive migration, app/wrapper/verifier files, no timer enable, no send.
- Chloe: Contabo Asia Singapore `vmi3136623`, `194.233.94.3`; skill/prompt/disabled cron/known-host key, no job execution.

Capture pre-deploy real sends, test sends, attempted provider posts, WAHA state, current timer/job states, source revisions, backup file metadata, and restore-test evidence. The no-send deployment must end with the same send/provider counters and both jobs disabled.

- [ ] **Step 6: Stop at the controlled-send boundary if external approval is not current**

Deployment/dry-run verification never implies permission for a real `test-send`. Execute the controlled message only under the user's explicit existing approval for `+6591051399`, then verify the provider message ID, test ledger row, unchanged CRM source lead, STOP handling, and operator report before enabling jobs.

---

## Completion Evidence

Do not claim the workflow fixed or production-ready until all local gates pass and a fresh-context live verifier proves:

- exact SmartProp and Chloe host identities;
- deployed revisions equal reviewed source;
- migration/RPC/schema assertions pass;
- backup exists and restore was test-verified;
- restricted SSH allows only four commands and no secret is present on Chloe;
- valuation job produces a current heartbeat and accepted cache row or truthful quiet state;
- campaign dry-run consumes only exact accepted current-contract valuation;
- controlled `test-send` reaches `+6591051399` with a provider ID and no CRM mutation;
- STOP persistence and operator reporting work;
- both jobs survive restart and alerts fire on absence;
- the real critical path has a tracked nonzero success rate.

If backup restore, independent received-alert confirmation, an approved host
reboot, or a nonzero real success rate has not been evidenced, report the exact
verified stage and state that production readiness remains unverified; never
turn the missing invariant into a warning-only success.
