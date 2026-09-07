# Release-layout bootstrap implementation plan

Goal: execute the user-approved one-time directory-to-stable-link migration on verified Contabo without changing application source, credentials, sessions or provider.

Architecture: move the intact existing tree to a same-filesystem baseline directory, retaining all inodes and writable state. The unchanged literal app path becomes a symlink. This is configuration/layout maintenance, not a routine application release; the manual-only deployment route stays unqualified.

Execution: controller inline for the live boundary, with a read-only source-mapping agent. No separate executor-choice approval is needed; no disabled skill is used.

- [ ] Test real temporary-filesystem apply, rollback, no-clobber and tampered-pointer refusal in `smartprop/scripts/bootstrap-release-layout.test.ts` before implementing `smartprop/deploy/bootstrap-release-layout.ts`.
- [ ] Implement exclusive journal, same-filesystem/inode validation, controlled apply/rollback, and fixed-host CLI with stopped-app/worker/inactive-timer precondition.
- [ ] Run affected Smart Verify; freeze helper. Verify original app routes/build identity and idle worker/timer before maintenance.
- [ ] Create a private backup directory. Stop only the approved article timer and two PM2 consumers. Archive the whole tree, verify archive readability/digest, then apply the helper. Any failure restores the original directory where safe and resumes the existing consumers.
- [ ] Start the same PM2 definitions, restore prior timer state, verify pointer/inodes/state hashes/build identity, public login rendering and protected-route status. Roll back immediately on a migration regression.
- [ ] Final independent evidence review, project notes and exact outcome. Preserve backup. Shared writable-state externalization and qualified routine release remain later work; do not imply immutable runtime state or full recovery.
