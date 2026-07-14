# Chloe OpenClaw 2026.7.1 Upgrade Implementation Plan

**Goal:** Upgrade Chloe's live OpenClaw gateway on `194.233.94.3` to stable `2026.7.1`, preserve `openai/gpt-5.6-sol` with `high` thinking, and leave a repeatable read-only verifier.

**Target boundary:** Contabo host `vmi3136623` at `194.233.94.3`; global npm OpenClaw package, root user gateway service, and `/root/.openclaw` runtime state only. SmartProp, WAHA, databases, DNS, and the unrelated dirty OpenClaw workspace are out of scope.

## Completed work

- [x] Verify provider, hostname, IP, service identity, installed package, and persistent-state paths.
- [x] Create a root-only rollback archive and validate extraction plus byte comparisons.
- [x] Upgrade OpenClaw to stable `2026.7.1` and Node to the compatible `22.23.1` release.
- [x] Repair and refresh the managed gateway after the updater exposed the Node engine mismatch.
- [x] Preserve and validate `openai/gpt-5.6-sol` and `high` thinking defaults.
- [x] Authorize a usable OpenAI OAuth profile without recording credentials in Git.
- [x] Run a new no-delivery Sol High turn and require the exact `CHLOE_SOL_HIGH_OK` sentinel.
- [x] Add a source-controlled verifier that fails closed on host, version, Node engine, service, health, auth, model, thinking, fallback, or proof-run drift.
- [x] Add an update preflight that checks the target package's Node engine before a future OpenClaw update.
- [x] Complete independent review and final evidence gate.

## Incident-derived invariant

Before replacing OpenClaw, the installed Node version must satisfy the target package's `engines.node` range. Run:

```bash
smartprop/scripts/verify-chloe-openclaw.sh --preflight-update=2026.7.1
```

If the preflight fails, upgrade Node first. When it passes, run the updater with the same immutable version (`openclaw update --tag 2026.7.1 --yes --json`). Do not update through a mutable tag such as `latest`.

## Completion evidence

The completion claim and redacted command output are stored under `docs/superpowers/evidence/`. The broader host invariants (tested disaster restore, monitored absence alerting, reboot survival, and resource saturation controls) are not claimed by this narrowly scoped upgrade.
