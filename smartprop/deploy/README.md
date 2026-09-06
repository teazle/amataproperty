# SmartProp local release artifact contract

`manifest.ts` provides the provider-free boundary for a SmartProp source ZIP.
It does not build, upload, activate, restart, smoke-test, or roll back a release.

`createReleaseArtifactManifest` inspects a real ZIP and records its exact
SHA-256, byte size, and per-file hashes. The archive must contain the declared
Next/Bun application and pg-boss worker inputs, use safe relative paths, and
exclude environment, credential, key, cookie, and session artifacts.

`validateReleaseArtifactManifest` re-reads the archive and fails closed unless:

- the source is an exact 40-hex Git commit;
- the artifact bytes and entry hashes match the manifest;
- the build and rollback identities are immutable SHA-256 values;
- the build identity equals the artifact digest; and
- the target is exactly `/opt/smartprop/app/smartprop`, with PM2 processes
  `smartprop` and `scraper-worker` and the declared pg-boss worker entrypoint.

The rollback digest must be supplied by a later controller-owned reconciliation
step. This contract does not qualify a deployment route or infer a live target.

Focused local verification:

```sh
bun test scripts/release-artifact-contract.test.ts
```
