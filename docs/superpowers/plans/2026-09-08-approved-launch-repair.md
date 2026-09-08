# Approved SmartProp repair execution

User approved the audit plan, lower-cost appropriate multi-agent implementation, controller orchestration/verification and end-to-end testing on 2026-09-08.

## Boundaries

- Existing SmartProp target only: smartprop-vps / 109.123.239.107 / vmi3201429 / machine bfb5b1b8859546f9aac39a4c5bafa616. Controller verified 03:44 UTC. Supabase pfdsmpfgwbbeijdzevpu.
- Full app still serves baseline-20260907-pW8Hlz. Daily-report component3294037 already deployed separately and must remain intact. Its failed unit state describes the pre-repair run.
- Canonical dirty checkout and previous recovery worktree preserved. New integration/worker worktrees branch from clean32940372c203bde31e17f821cd3c287199015d1b.
- Source edits, same-target deploy/restart/probes and scoped permissions tightening are approved by plan. No new paid resource/domain/account, credentials for unrelated systems, or session relink.
- Pending user inputs: existing HTTPS domain; up to3labelled WhatsApp tests ONLY to existing operator2002 plus operator reply/STOP. No sends until answered; no customer campaign activation.

## Ownership

| Lane | Owner | Files | Acceptance |
|---|---|---|---|
| Browsing | Terra worker implement_browsing | listing/agent normal+enhanced pages, their read APIs, adminlayout, dedicated helpers/tests | server pagination/filter tests; controller fullDBD09browser check and mobile |
| Matcher | Terra worker implement_matcher | matching job/API, outreach page+authenticated endpoint, helper/tests | recent scraped match to owner, preview no writes/sends, explicit selected confirmation, dedup/optout, existingclaim tests |
| Messaging | Terra worker implement_messaging | customer OpenClaw adapter/selectedtransport/tests | exact gateway send owner/account/key/receipt; unknown no retry |
| Access | Terra worker implement_access | adminauth/login and sign page/API/tests | missing config failclosed; configured auth; signing no side effects |
| Anonymous client inventory | Luna read-only | finite source map | revealed enhancedconversation anonymous realtime dependency |
| Integration/runtime | controller | remaining authenticated polling, DBpermission SQL, release/build/rollback, secrets and live configuration, realacceptance | freshSmartVerify, immutable preview/artifact, runtimeprobes, sole finalreview |

## Issue → minimum change → proof ledger

1. Source default admin credential accepted → unique configured admin password+independentsecret, failclosed helper → oldfallback/anonymous rejected, realadmin works. Signing disabled before any PDF/DB/send.
2. Browser1000row cutoff, D09falseempty → database filters/pagination and authenticatedAPI → D09total586 at audit snapshot, page2/search/export behavior; mobile no overflow.
3. Missingposted_at, wrongnonowner recipient → scraped_at “recently refreshed”, actuallistingowner, previewdefault → knownpositive/negative/null/optout/duplicate fixtures, livepreview no delivery.
4. Anonymousagents/outreach reads → allprivate browser interactions use authenticatedAPIs, poll enhancedconversation API, then scopedRLS/grant tightening → anonread denied and alladmin views remainfunctional.
5. WAHAselected/unpaired and ownerlessOpenClawCLI → reuse preparedbridge/ledger and correctedgateway adapter → controlledone-recipient transport/CRM/STOP only after specificsendapproval. Customer toolscope isolated fromoperator.
6. PGstale/contentchallenge/falsehealth → reuse existingpreparedsafe extraction+terminalhealth contracts; smallsafeEP/PG probes, reviewedrepair batches only → validpersistedoutput and truthfulfailed/stale status.
7. No fullapp route → simplest existinghost stagedrelease with exactsource, isolatedbuild, retainedstate/rollback and preview → same-hostidentity, fresh functional smoke. Do not use daily-report-only route forapp.
8. Currentrecovery gap → currentread-only DBbackup storedoffhost + scratchrestore with actualcounts → retainproof and existingbackups; do not call historicJuly14receipt current.

Use focused RED/GREEN, then integration Smart Verify on exact changed paths. No repeated full suites during implementation. Full release acceptance only when candidate stable. One final review after feature complete. Source/preview/live/phone proof remain separate.

## Integrated evidence and discovered dependencies

- Live application data was backed up off-host at 04:01 UTC and restored in an owned PostgreSQL17 container: 6,587 listings, 4,466 agents, 643 CRM leads and four existing outreach records. Scope is public application schema/data, not managed provider auth, storage objects or browser sessions.
- Actual database permissions were broader than the initial two-table finding. SQL021 revokes browser-role access to public application tables, sequences and RPCs while retaining server RPC access; tested on the restored copy only. SQL022 preserves history and adds a unique listing-agent pair constraint; the restored history had no duplicate pairs.
- District9 has three stored forms:09=577, D09=9 and D9=256. Correct filter total is842, superseding the audit's narrower586 count. Search uses database embedding rather than a capped agent lookup.
- Matcher handles paginated candidate/owner/guard queries, uses the listing owner, excludes persisted STOP recipients and invalid recipients, previews without writing, and requires selected confirmation. Five concurrent HTTP confirmations produced one record under SQL022.
- STOP is checked by the common customer transport. Signed synthetic STOP persisted suppression/message, updated CRM history/status, deduplicated replay, and blocked later outbound. No real transport was available to the local app.
- Directly opening the conversation view exposed missing Immer Map/Set initialization. The controller added local store initialization and removed the duplicate initial fetch. The rendered STOP conversation then appeared.
- All four browse screens passed injected API500 and Retry checks. No false empty results remain on that tested failure path. Mobile listings/agents fit390px.
- Shared Smart Verify lacked Bun terminal count support. A focused RED/GREEN parser repair passed13 parser tests and all216 mapped affected tests, with a fresh passing agent-tooling receipt. Earlier failed receipts remain unchanged.

Production mutations have not been made by this execution: the full app still needs its own qualified release route, configured admin access over an identified HTTPS origin, and the reviewed database steps. The existing route is scoped to the daily-report component only. Pending domain and real-send inputs are unchanged.
