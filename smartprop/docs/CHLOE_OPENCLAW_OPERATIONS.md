# Chloe OpenClaw Operations

## Source and runtime boundary

Chloe's OpenClaw runtime is the Contabo VPS `vmi3136623` at `194.233.94.3`:

- OpenClaw: global npm package under `/usr/lib/node_modules/openclaw`
- Configuration: `/root/.openclaw/openclaw.json`
- Gateway: root user `openclaw-gateway.service`, port `20888`
- Agent state: `/root/.openclaw`

`/opt/openclaw-assistant` does not exist. The Git repository under `/root/.openclaw/workspace` is unrelated to the core package/configuration, is dirty, and has no remote. Do not commit or bulk-copy that live workspace.

## Read-only verification

From this repository, run:

```bash
smartprop/scripts/verify-chloe-openclaw.sh
```

The verifier is pinned to the approved host and checks:

- exact hostname and IP;
- OpenClaw version/build and Node engine compatibility;
- enabled/active gateway, zero restart count, HTTP health, RPC health, and config validity;
- effective main-agent `openai/gpt-5.6-sol`, inherited-or-overridden `high` thinking, and a usable OpenAI OAuth profile;
- the recorded no-external-delivery proof run, including the exact run window/prompt chain, diagnostic WebChat session key, provider/model/thinking, exact response, no fallback event, no messaging side effect, and normal stop.

It does not send a message, create a model run, restart a service, or change the VPS. The controller bounds the full SSH command to 120 seconds and also uses SSH keepalive failure detection.

## Mandatory update preflight

First inspect the stable-channel target:

```bash
ssh root@194.233.94.3 'openclaw update status --json'
```

Copy the exact `registry.latestVersion` value and preflight that immutable release. For example:

```bash
smartprop/scripts/verify-chloe-openclaw.sh --preflight-update=2026.7.1
```

The command reads that exact release's npm metadata and verifies that the VPS's current Node version satisfies the target `engines.node` range. If it fails, upgrade Node first and rerun the preflight. When it passes, supply the identical version to the updater:

```bash
ssh root@194.233.94.3 'openclaw update --tag 2026.7.1 --yes --json'
```

Do not preflight or update through a mutable tag such as `latest`; binding both commands to the same version prevents target drift between the check and package replacement.

## Current rollback point

The pre-upgrade archive is:

```text
/root/openclaw-backups/chloe-openclaw-pre-2026.7.1-20260714T131319Z/rollback-critical.tar.gz
```

Recorded SHA-256:

```text
89da323528c42ce9ded4113d47eb8eabe42596cee16ee18dafdc650cb8db0e10
```

The archive was extracted and its protected files were byte-compared successfully on 2026-07-14. This validates the archive contents, not a full disaster restore of the VPS.

## Known out-of-scope warnings

This upgrade does not remediate the pre-existing insecure Control UI flags, plaintext secret-bearing configuration fields, historical session/orphan warnings, or four cron jobs reporting repeated errors. It also does not establish broader production invariants such as monitored absence alerting, reboot survival, or resource saturation controls.
