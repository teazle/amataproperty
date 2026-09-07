# Recovery release implementation plan

**Goal:** move accepted SmartProp repairs from local proof to an isolated runnable release with preserved state and measurable business-function acceptance.

**Architecture:** retain the one controller and exact existing Contabo target. Build a frozen source tree away from serving state, validate runtime payload contents, attach inventoried state only for an authorized release, then cut over with rollback and bounded smoke. Customer delivery must claim a durable attempt before external submission; unknown outcomes never resend automatically.

**Tech stack:** Bun/TypeScript, Next.js, PM2, systemd, PostgreSQL/Supabase, existing selected customer transport.

**Spec:** user-approved whole-system recovery; prior layout report and latest Current State. Disabled subagent-driven skill is not invoked; native owned lanes execute this plan under the global risk/approval contract. No extra execution-choice approval.

## Evidence ledger and owned slices

| Failure/evidence | Change | Acceptance/owner |
| --- | --- | --- |
| manual-only release; build bytes opaque | validate a runtime ZIP containing a built Next app and exact source inputs, reject traversal/state/duplicates | real archive fixtures, exact hashes; isolated payload worker |
| baseline embeds writable state | define exact state-link/pointer preservation checks and recoverable fixture cutover contract | real temp-filesystem round trip and failed smoke restores prior pointer/state; controller integration |
| match/viewing bypass selected transport; sent-before-send | local durable-attempt interface and selected-provider job paths; migration activation awaits explicit user permission | concurrent real job invocations issue one transport call; unknown/accepted-finalize-failure cannot resend |
| daily report built but send failed; WAHA401 | no-send live report generation, selected provider diagnosis; retain channel | controller actual generation passed; real operator test needs explicit approval |
| production source/deps mixed | compare frozen source and public runtime source hashes; preserve unmatched changes before release | exact changed-path provenance ledger; controller |

## Steps

- [ ] Payload worker owns `smartprop/deploy/runtime-payload.ts`, `smartprop/scripts/runtime-payload.test.ts`, and manifest integration/tests only. RED fixtures: opaque build rejected, missing BUILD_ID rejected, traversal/state/symlink/duplicate rejected. GREEN inspect valid fixture and hash each required artifact. Never package live state or build in serving cwd.
- [ ] Controller owns release executor and preservation policy. Record actual source/runtime differences before changing central route admission. Reject missing target identity, state mapping, baseline digest or rollback smoke rather than assert qualification.
- [ ] Customer worker owns `src/jobs/match.ts`, `src/jobs/viewing-request.ts`, focused tests and narrow `src/lib/wa/customer-delivery.ts`; controller owns SQL/schema. Inject repository attempt boundary for tests; production insert/claim is a unique business key. Missing ledger fails before send. Existing queued/pending status never pretends that unknown means failed or sent.
- [ ] Controller receives integrated diffs, runs affected Smart Verify once on exact changed paths, then no-write real runtime probes; isolated preview must not start schedulers, send or write production state.
- [ ] At protected schema/send decision, keep local preparation moving but do not activate unapproved effects. Perform one final review only after the releasable feature boundary is immutable and its acceptance is complete. Record PASS/PARTIAL boundaries and update project notes once.

## Protected boundaries

No customer sends, new account, relink/QR, credential rotation, data deletion, provider control-plane action or paid resource. Database delivery-attempt table and one labelled operator test were explicitly requested for approval, not assumed. No WAHA retirement before customer ingress/callers/routing and real acceptance pass. A qualified executor is an implementation prerequisite, not permission to weaken the route or overwrite unmatched source.
