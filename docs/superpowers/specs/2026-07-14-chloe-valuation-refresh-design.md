# Chloe Newsletter Valuation Refresh Design

## Status

Approved by the user on 2026-07-14.

## Goal

Restore Chloe's proven ability to research a current, source-backed property
valuation before the daily ViewProperty.ai WhatsApp newsletter run, while
keeping recipient selection, the five-attempt daily cap, delivery, STOP
handling, CRM updates, and operator reporting inside the deterministic
SmartProp campaign pipeline.

## Confirmed Prior Behavior

The former `viewproperty_daily_valuation_followup_batch` agent job researched
public property transaction evidence, inserted supported rows into
`propnex_valuations`, and prepared five personalized messages. On 2026-06-05 it
cached five Cliften unit rows from two public sources because an authenticated
PropNex portal was unavailable. That run prepared an approval packet, but its
recipient delivery was blocked by the old WhatsApp allowlist.

The current repository contains the valuation cache and a campaign runner that
reads fresh rows. It does not contain a valuation acquisition workflow. The
former OpenClaw job is also absent from the current live cron list. The current
Chloe skill therefore has an incorrect gap: it escalates a missing or expired
valuation instead of teaching Chloe how to research and populate one.

## Boundaries

### SmartProp owns campaign truth

SmartProp and Supabase continue to own eligibility, recipient order, daily
limits, send state, STOP suppression, CRM mutation, and reports. Chloe must not
choose phone numbers or send newsletter messages directly.

### Chloe owns evidence gathering

Chloe receives a deterministic, read-only research queue containing only the
property fields needed for valuation research. She searches current transaction
and comparable evidence, records the evidence in a structured JSON artifact,
and submits it through a validation command. She does not write arbitrary SQL.

### Validation bridges the two

Only a validated valuation import may write `propnex_valuations`. The existing
campaign runner remains unchanged in principle: it can select a lead only when
the cache contains a fresh supported valuation.

## Daily Data Flow

1. At 08:30 SGT, the Chloe valuation-preparation job starts one research run.
2. SmartProp returns up to five deterministic lead candidates from the
   oldest approved or sending issue. Candidate selection applies all campaign
   eligibility rules except the fresh-valuation requirement and returns no
   recipient phone number.
3. Candidates are deduplicated by normalized project. Chloe researches one
   project-level valuation range and never creates a unit-specific value.
4. Chloe searches PropNex or URA evidence when an authenticated path is
   available and corroborates it with a second independent source. Otherwise,
   she uses at least two independent public comparable sources. Sources must
   support the same project/property type and the stated range; listing-only
   evidence is not sufficient by itself.
5. Chloe submits structured evidence to SmartProp. SmartProp validates and
   upserts the cache, records accepted and rejected items, and completes the
   research run.
6. The preparation job has a 09:20 SGT completion deadline. At 09:30 SGT, the
   campaign runner requires today's preparation run to be terminal `completed`
   or healthy `quiet`. A missing, running, failed, stale, or blocked preparation
   run is a recoverable send blocker. The runner retries every 15 minutes until
   its existing 10:30 SGT cutoff but never sends before the preparation gate.
7. After the gate passes, the runner selects at most five leads backed by fresh
   valuations, sends sequentially through WAHA, updates CRM, honors STOP, and
   reports the exact content and recipients to the configured operator.

The valuation job never calls WAHA. The campaign job never performs open-ended
web research.

## Research Queue

Add a local CLI command that uses the existing campaign store and eligibility
rules to return a JSON queue. Each item contains:

- opaque candidate and lead identifiers;
- audience/project identifier and display project name;
- project-level location, property type, tenure, and area distribution fields
  needed to choose comparable transactions;
- the reason research is required: `missing`, `expired`, or `unsupported`;
- the current SGT research date.

It does not return the lead's name, phone, email, notes, or unrelated CRM data.
The queue is stable for a research run and is capped at five lead candidates.
All valuation identity and cache writes use the audience project's existing
`crm_projects.slug`; the same value is stored as
`propnex_valuations.project_slug` and compared directly with
`newsletter_issues.audience_project_slug`. Unit, stack, floor,
address-specific keys, and fuzzy project-title matching are not accepted by
this workflow. This matches the campaign runner's project-level aggregation
boundary.

## Evidence Contract

Each submitted valuation item must contain:

- the research-run item identifier;
- normalized project and property identity;
- `lowSgd`, `midSgd`, or `highSgd`, with a valid midpoint or non-inverted range;
- `asOf`, representing when the valuation analysis was performed;
- area and PSF values when used in the calculation;
- comparable count and confidence (`high` or `medium`);
- a plain-language basis explaining the calculation;
- at least two independent HTTPS source domains;
- source name, URL, mandatory evidence date, evidence type, ownership group,
  and a concise supporting
  detail for each source;
- acquisition method: `propnex`, `ura`, or `public-comparables`;
- the agent identity and source revision.

`asOf` must not be in the future or more than seven calendar days old at import.
At least one source must be transaction or official-valuation evidence dated
within the previous twelve months. Source domains must be present in a
source-controlled registry of approved Singapore property-data sources, and
two sources must have different ownership groups rather than merely different
hostnames.
Cache expiry is set server-side to 30 days after import; Chloe cannot extend an
existing expiry manually. Re-importing an identical supported item is
idempotent. A changed valuation creates new audit evidence before replacing the
active cache value.

The importer rejects malformed prices, `low` confidence, duplicate ownership
groups, unregistered or non-HTTPS sources, unsupported acquisition methods,
missing or stale source evidence dates, weak project identity, unit-specific
identity, and evidence that cannot support a range or midpoint. Rejected items
remain visible in the research-run ledger but never become send-eligible.

## Source Policy

Preferred evidence order:

1. Authenticated PropNex valuation or transaction evidence, corroborated by a
   second independent source.
2. URA transaction evidence, corroborated by a second independent source.
3. At least two independent public transaction/comparable sources such as
   project transaction pages from established Singapore property portals.

Public-source fallback matches Chloe's prior successful research behavior. The
approved-source registry records ownership groups and evidence classes so a
copied feed cannot satisfy the independence rule twice. Chloe must capture the
source date, evidence class, concise supporting facts, and a content hash of the
tool output used for each source. Structural validation cannot independently
prove every market statement, so accepted evidence remains an auditable Chloe
research decision rather than an official appraisal. The recipient copy must
continue to call it an indicative market valuation. A single listing, asking
price, generic district average, AI-generated estimate, or source that merely
copies another source is insufficient. When evidence is weak or conflicting,
Chloe records the blocker and SmartProp skips that candidate. She must never
invent, average, or extend a valuation just to fill five slots.

## Persistence

Add an additive migration containing:

- `newsletter_valuation_runs`: one preparation run with start, heartbeat,
  completion, status, counts, blocker, agent identity, and source revision;
- `newsletter_valuation_items`: the immutable candidate snapshot, research
  status, accepted valuation snapshot, source evidence, validation error, and
  cache-row link;
- secured RPCs for claiming a run, recording a heartbeat, importing one item,
  and completing the run.

Extend `propnex_valuations` with `project_slug`, `evidence_status`,
`evidence_contract_version`, `evidence_item_id`, and validated confidence. Only
rows with the current contract version, `evidence_status='accepted'`, confidence
`medium` or `high`, and an exact audience-project slug match are send-eligible.
Legacy rows are not grandfathered and must be refreshed through this workflow.

Research-run states are `running`, `completed`, `quiet`, `blocked`, and
`failed`. Candidate-present runs with at least one accepted item are
`completed`, with rejected/blocked item counts retained as partial-success
evidence. Candidate-present runs with zero accepted items are `blocked`.
`blocked` and `failed` are always hard send gates.

The SmartProp process invokes only the required security-definer RPCs; direct
client-role writes to the run, item, and valuation tables are denied. Existing
`propnex_valuations.raw_response` retains the accepted evidence snapshot for
compatibility with the campaign runner and operator audit.

## Scheduling And Ownership

The source repository ships the exact OpenClaw job prompt and an installation
script, but installation is explicit and idempotent. The job runs as Chloe on
the OpenClaw host and invokes only the SmartProp valuation queue/import
commands over a dedicated SSH trust boundary:

- a non-root `smartprop-valuation` account on the SmartProp host;
- a dedicated key whose `authorized_keys` entry uses a forced-command wrapper;
- no PTY, agent forwarding, TCP forwarding, X11 forwarding, or user rc files;
- a pinned SmartProp host key on the Chloe host;
- an allowlist of queue, heartbeat, import, and completion subcommands only;
- no Supabase or WAHA credential copied to the Chloe host.

The OpenClaw job timeout is bounded so it must complete or record failure before
09:20 SGT. The SmartProp send runner treats every non-terminal or unhealthy
current-day preparation state as exit-10 recoverable until 10:30 SGT; it cannot
mark the issue complete while valuation-blocked audience leads remain.

The send timer stays disabled until all of these pass:

- WAHA session `default` is `WORKING`;
- the valuation preparation dry run produces a valid queue;
- one controlled valuation is researched, imported, and visible as fresh;
- the campaign dry run renders the expected message from that valuation;
- a ledgered `test-send` to `+6591051399` succeeds;
- STOP persistence and the operator report are verified.

After that gate, the valuation job and send timer may be enabled. The campaign
is already approved and does not need daily approval.

## Health And Observability

Extend the existing newsletter health surface and verifier with:

- deployed source revision for the research workflow;
- latest research-run status and heartbeat;
- last meaningful work timestamp;
- queued, accepted, rejected, and blocked counts;
- age of the newest accepted valuation;
- distinction between `quiet` (no eligible research candidates) and `dead`
  (missing/stale heartbeat after the scheduled window);
- current-run accepted count and rolling accepted-import success rate once
  controlled testing begins.

The verifier exits nonzero for a stale/missing research heartbeat, an incomplete
run after the cutoff, accepted evidence without a cache row, an enabled send
timer without a current valuation path, or a deployed revision mismatch. A run
with zero queue candidates is healthy `quiet`. A run with one or more queue
candidates and zero accepted imports is unhealthy `blocked`, including fully
rejected runs. Historical success never makes a failed current run healthy.

## Error Handling

- No approved issue: complete the preparation run as `quiet`; do not research
  or send.
- No candidates: complete as `quiet` with a fresh heartbeat.
- Preparation incomplete at 09:30: the send runner records a recoverable blocker
  and makes no provider POST; later retries may proceed only after preparation
  completes before the 10:30 cutoff.
- Search unavailable: mark each affected item blocked. If no item was accepted,
  complete the run as `blocked` and prevent all sending. If at least one item
  was accepted, complete as partial-success `completed`; the runner may use
  only projects backed by those accepted current-contract rows.
- Weak/conflicting or `low`-confidence evidence: reject the item without
  changing the cache.
- Import/database failure: stop the preparation run, preserve the artifact and
  error, and leave the send timer fail-closed if no other fresh valuation exists.
- Agent timeout: the heartbeat becomes stale and the verifier alerts; a later
  run may reclaim only after the configured stale threshold.
- Partial success: accepted items remain usable; failed items remain auditable
  and are not silently retried in the same run.

## Security And Privacy

- No lead phone, email, or unrelated CRM notes enter Chloe's research prompt.
- Service-role credentials remain on the SmartProp host.
- Chloe uses a restricted local command surface instead of arbitrary database
  writes.
- Source artifacts and logs contain property evidence but no complete recipient
  list or credentials.
- Operator reports retain the existing masked-phone policy.

## Resource Scaling Review

| Scarce resource | Scales with | Hard limit | At 10x current CRM size | Failure mode |
| --- | --- | --- | --- | --- |
| Web research | distinct queued property profiles | 5 lead candidates/day | still at most 5/day | later leads wait; no burst |
| Source requests | evidence sources per candidate | bounded by job timeout and 2-source minimum | unchanged daily bound | item becomes blocked |
| Database writes | research runs/items plus accepted cache rows | at most 1 run and 5 items/day | unchanged daily bound | run fails closed |
| OpenClaw agent concurrency | one isolated scheduled job | 1 active valuation job | unchanged | stale claim/heartbeat alert |
| WhatsApp submissions | existing campaign slots | 5 attempts/day | unchanged | queue duration grows |

The first binding constraints are source availability and the single OpenClaw
research job. They are bounded and outside the WhatsApp delivery transaction;
no network research occurs while a database transaction or send slot is held.

## Alternatives Considered

### Let Chloe write SQL and send directly

Rejected. This recreates the missing audit boundary and bypasses deterministic
selection, STOP, idempotency, and the daily cap.

### Build a fully authenticated PropNex scraper first

Deferred. No stable authenticated PropNex browser/API path is currently
available, and Chloe's former workflow already demonstrated a source-backed
public-comparable fallback. The evidence contract allows a future official
adapter without changing campaign delivery.

### Keep escalating expired valuations

Rejected. It removes an existing Chloe capability and leaves the approved daily
campaign unable to make meaningful progress.

## Test Strategy

- Unit tests for queue redaction/deduplication, evidence validation, freshness,
  independent-source checks, range checks, and idempotency.
- Migration contract and executable SQL assertions for claims, immutable audit
  rows, RPC permissions, import/cache atomicity, and heartbeat transitions.
- Campaign-store tests proving exact project-slug matching, accepted evidence
  contract admission, rejection of every legacy cache row, the current-day
  preparation gate, and non-completion while valuation-blocked leads remain.
- CLI tests proving dry-run and import never expose recipient contact data and
  that the forced-command wrapper rejects every non-allowlisted SSH command.
- Chloe skill tests requiring the research, import, dry-run, send-ownership,
  STOP, and reporting workflow.
- Operations tests for schedule ordering, kill switches, timeout/resource
  bounds, quiet-vs-dead health, and verifier failure on an absent valuation path.
- Full newsletter test suite, TypeScript typecheck, changed-file lint, shell
  syntax, production build, and `git diff --check`.
- Live controlled proof on the named hosts before either timer is enabled.

## Deployment Boundary

State-changing deployment applies only after source review and local tests.

- SmartProp target: Contabo resource `vmi3201429`, `109.123.239.107:2222`,
  Singapore, app `/opt/smartprop/app/smartprop`, WAHA `127.0.0.1:3030`.
- Chloe/OpenClaw target: Contabo Asia Singapore resource `vmi3136623`,
  `194.233.94.3`, workspace `/root/.openclaw/workspace`.
- Expected impact: additive database schema, restricted valuation preparation
  commands, Chloe skill/job installation, and health/verifier expansion. No
  recipient send occurs during deployment or dry-run verification.

Back up changed runtime files and database schema state before deployment. Do
not enable either timer until the controlled-test gate passes.
