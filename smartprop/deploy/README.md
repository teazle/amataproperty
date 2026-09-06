# SmartProp local release artifact contract

`manifest.ts` provides the provider-free boundary for a SmartProp source ZIP
and a separately produced opaque Next build artifact. It does not build,
upload, activate, restart, smoke-test, or roll back a release.

`createReleaseArtifactManifest` inspects a real ZIP and records its exact
SHA-256, byte size, and per-file hashes. The archive must contain the declared
Next/Bun application and pg-boss worker inputs (including `bun.lock`), use safe
relative paths, and exclude environment, credential, key, cookie, and session
artifacts. The build artifact is hashed independently; the source ZIP digest is
never treated as compiled-build proof.

`validateReleaseArtifactManifest` re-reads the archive and fails closed unless:

- the source is an exact 40-hex Git commit;
- the artifact bytes and entry hashes match the manifest;
- the separate build artifact and rollback identities are immutable SHA-256
  values;
- the build identity equals the separately re-read build artifact digest; and
- the target binds SSH alias `smartprop-vps`, hostname `vmi3201429`, machine ID
  `bfb5b1b8859546f9aac39a4c5bafa616`, IPv4 `109.123.239.107`, and
  `/opt/smartprop/app/smartprop`, with PM2 processes `smartprop` and
  `scraper-worker` and the declared pg-boss worker entrypoint.

The rollback digest is only a claimed immutable identity here. A later
controller-owned reconciliation step must select it and an executor must still
prove it can actually restore that artifact. This contract does not qualify a
deployment route, infer another live target, or prove rollback restoration.

Focused local verification:

```sh
bun test scripts/release-artifact-contract.test.ts
```
