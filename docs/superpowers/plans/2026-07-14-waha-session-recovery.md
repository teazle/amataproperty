# WAHA Session Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the authenticated SmartProp WhatsApp session onto persistent storage and upgrade WAHA so the session can reach `WORKING`.

**Architecture:** Keep the existing WEBJS engine and `default` session. Back up the live `/app/.sessions` profile, restore it into the existing `waha-sessions` named volume, mount that volume at `/app/.sessions`, then recreate only the WAHA container on the pinned `2026.6.2` image.

**Tech Stack:** Docker Compose, WAHA WEBJS, SmartProp production on Contabo.

## Global Constraints

- Production target is `vmi3201429` at `109.123.239.107` only.
- Preserve the authenticated WhatsApp profile and provide a tested rollback artifact before container recreation.
- Do not change the SmartProp app, database, DNS, Flaresolverr, Chloe host, or protected Mira infrastructure.
- Keep `SMARTPROP_NEWSLETTER_ENABLED=0`; do not send WhatsApp messages during verification.

---

### Task 1: Correct the production WAHA deployment

**Files:**
- Modify: `smartprop/docker-compose.prod.yml`

- [ ] Pin `waha` to `devlikeapro/waha:latest-2026.6.2`.
- [ ] Mount `waha-sessions` at `/app/.sessions`.
- [ ] Remove obsolete session-path environment settings that point at `/app/sessions`.
- [ ] Validate with `docker compose -f smartprop/docker-compose.prod.yml config` using non-secret test environment values.
- [ ] Commit and push the source change.

### Task 2: Preserve, deploy, and verify the live session

**Files:**
- Runtime: `/opt/smartprop/app/smartprop/docker-compose.prod.yml`
- Backup: `/opt/smartprop/backups/waha/`

- [ ] Stop only the `default` WAHA session and archive `/app/.sessions` with a SHA-256 checksum.
- [ ] Restore the archive into a temporary directory and verify archive readability, file count, and SQLite integrity.
- [ ] Copy the verified profile into the existing `smartprop_waha-sessions` volume.
- [ ] Lock the backup directory to `0700`, lock artifacts to `0600`, and record the old image ID plus Compose and environment hashes.
- [ ] Capture `wa_messages` and newsletter outbound counters, then use a one-time WAHA API key and sink webhook for the first upgrade boot so neither SmartProp nor inbound webhooks can send.
- [ ] Pull `devlikeapro/waha:latest-2026.6.2` and recreate only `smartprop-waha`.
- [ ] After the isolated boot reaches `WORKING`, recreate WAHA with the production API key and webhook, then confirm outbound counters did not change.
- [ ] Verify container health, authenticated API `200`, anonymous API `401`, session `WORKING`, linked account identity, webhook configuration, and current image/version.
- [ ] Verify `SMARTPROP_NEWSLETTER_ENABLED=0` and no campaign messages were sent.
- [ ] If verification fails, run the retained old image `sha256:02da9fa891f8d0258b2803bfcc9ca63e7be3c0a5b491edd28167a76b76e2db31` while keeping `smartprop_waha-sessions:/app/.sessions`; do not restore the incorrect `/app/sessions` mount. Restore the archived profile if the volume integrity check fails.
