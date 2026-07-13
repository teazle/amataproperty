# Chloe Mobile Newsletter Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Chloe a durable, test-protected operating workflow for preparing mobile-only WhatsApp newsletter leads while leaving final recipient selection and sending to the SmartProp campaign runner.

**Architecture:** The existing `smartprop-crm` OpenClaw skill remains the single operator instruction surface. A Bun contract test reads that skill as an artifact and enforces the critical mobile-only, dry-run, automatic-selection, reporting, and no-manual-send instructions. Deployment copies only the reviewed skill to Chloe's existing workspace and verifies both the file and Chloe's read-only understanding; it does not enable or execute the campaign.

**Tech Stack:** Markdown OpenClaw skill, Bun test runner, SSH, systemd user service, OpenClaw CLI.

## Global Constraints

- Valid WhatsApp newsletter candidates must normalize to `+658XXXXXXX` or `+659XXXXXXX`.
- Chloe prepares and reviews leads; the production campaign runner selects up to five eligible recipients and owns sending.
- Landlines, malformed numbers, duplicates, opted-out contacts, suppressed contacts, and lost leads are excluded.
- Chloe must run and interpret a dry-run before operational activation and must report exclusions, attempted recipients, exact message bodies, and provider outcomes.
- Chloe must never manually send or retry a parallel newsletter batch.
- Do not enable `SMARTPROP_NEWSLETTER_ENABLED`, start the service, enable the timer, mutate CRM data, or send any WhatsApp message during implementation or verification.
- Deploy only to the verified Chloe/OpenClaw host `vmi3136623` at `194.233.94.3`; SmartProp/WAHA remains on separate host `vmi3201429` at `109.123.239.107`.

---

### Task 1: Test-Protected Chloe Mobile Workflow

**Files:**
- Create: `smartprop/scripts/chloe-newsletter-skill.test.ts`
- Modify: `openclaw-skills/smartprop-crm/SKILL.md`

**Interfaces:**
- Consumes: the existing Markdown skill at `openclaw-skills/smartprop-crm/SKILL.md`.
- Produces: a durable Chloe workflow and a Bun artifact contract that fails when required operational instructions disappear.

- [ ] **Step 1: Write the failing skill contract test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const skillPath = join(import.meta.dir, '..', '..', 'openclaw-skills', 'smartprop-crm', 'SKILL.md');
const skill = readFileSync(skillPath, 'utf8');

describe('Chloe WhatsApp newsletter skill', () => {
  test('teaches mobile-only lead preparation and automatic selection', () => {
    expect(skill).toContain('Mobile-only lead preparation');
    expect(skill).toContain('`+658XXXXXXX` or `+659XXXXXXX`');
    expect(skill).toContain('landline');
    expect(skill).toContain('runner automatically selects up to five eligible recipients');
    expect(skill).toContain('Do not manually choose the five recipients');
  });

  test('teaches dry-run interpretation, reporting, and escalation', () => {
    expect(skill).toContain('selected count and blocker');
    expect(skill).toContain('excluded mobile-ineligible contacts as counts and reasons');
    expect(skill).toContain('exact message body');
    expect(skill).toContain('WAHA is not exactly `WORKING`');
    expect(skill).toContain('current approved valuation');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd smartprop
bun test scripts/chloe-newsletter-skill.test.ts
```

Expected: FAIL because the skill does not yet contain `Mobile-only lead preparation` and the exact automatic-selection instruction.

- [ ] **Step 3: Add the minimal operational instructions**

Under `## Chloe's Daily WhatsApp Newsletter Workflow`, add a `### Mobile-only lead preparation` subsection that states:

```markdown
### Mobile-only lead preparation

Before every dry-run, Chloe must review the audience project's CRM leads:

- Use the mobile field when a source row contains both mobile and landline numbers.
- A WhatsApp newsletter candidate must normalize to `+658XXXXXXX` or
  `+659XXXXXXX`. Treat landlines and malformed numbers as ineligible; never move
  them to another field or send them manually to bypass validation.
- Duplicates, lost leads, opted-out contacts, and suppressed contacts are also
  ineligible. Report excluded mobile-ineligible contacts as counts and reasons,
  without printing a raw lead list.
- Confirm the issue is approved, the audience project is active, and the project
  has a current approved valuation. Run the dry-run and review its selected count
  and blocker before treating the list as ready.

The runner automatically selects up to five eligible recipients. Do not manually
choose the five recipients, send a parallel batch, or retry a failed or unknown
provider submission outside the ledger.
```

Adjust the existing numbered workflow only enough to remove repetition and preserve these requirements:

- after-run reporting includes the exact message body and final provider outcome;
- WAHA must be exactly `WORKING`;
- no manual or alternate-channel campaign send.

- [ ] **Step 4: Run the focused and newsletter rule tests and verify GREEN**

Run:

```bash
cd smartprop
bun test scripts/chloe-newsletter-skill.test.ts scripts/newsletter-rules.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run repository checks**

Run:

```bash
cd smartprop
bun test scripts/chloe-newsletter-skill.test.ts scripts/newsletter-rules.test.ts scripts/newsletter-campaign-runner.test.ts
bun x tsc --noEmit
```

Expected: all selected tests and TypeScript checks PASS.

- [ ] **Step 6: Commit the implementation**

```bash
git add openclaw-skills/smartprop-crm/SKILL.md smartprop/scripts/chloe-newsletter-skill.test.ts
git commit -m "docs: teach Chloe mobile-only newsletter workflow"
```

### Task 2: Deploy and Verify Chloe's Live Understanding

**Files:**
- Source: `openclaw-skills/smartprop-crm/SKILL.md`
- Live target: `/root/.openclaw/workspace/skills/smartprop-crm/SKILL.md` on `194.233.94.3`

**Interfaces:**
- Consumes: the reviewed and committed skill from Task 1.
- Produces: a hash-matching live Chloe skill and read-only evidence that Chloe can explain the workflow correctly.

- [ ] **Step 1: Reconfirm target identity and impact**

Run:

```bash
ssh root@194.233.94.3 'hostname; curl -fsS --max-time 5 https://api.ipify.org; systemctl --user is-active openclaw-gateway.service'
```

Expected: `vmi3136623`, `194.233.94.3`, and `active`. Impact is limited to replacing Chloe's `smartprop-crm` Markdown skill; no SmartProp/WAHA process or campaign state changes.

- [ ] **Step 2: Back up and deploy the reviewed skill**

Run:

```bash
ssh root@194.233.94.3 'install -d -m 0700 /root/.openclaw/backups/skills && cp -a /root/.openclaw/workspace/skills/smartprop-crm/SKILL.md /root/.openclaw/backups/skills/smartprop-crm-SKILL-20260714.md'
scp openclaw-skills/smartprop-crm/SKILL.md root@194.233.94.3:/root/.openclaw/workspace/skills/smartprop-crm/SKILL.md
ssh root@194.233.94.3 'chmod 0644 /root/.openclaw/workspace/skills/smartprop-crm/SKILL.md'
```

Expected: the previous skill is retained under a root-only backup directory and only the live skill file changes.

- [ ] **Step 3: Verify exact artifact and gateway health**

Run:

```bash
shasum -a 256 openclaw-skills/smartprop-crm/SKILL.md
ssh root@194.233.94.3 'sha256sum /root/.openclaw/workspace/skills/smartprop-crm/SKILL.md; systemctl --user is-active openclaw-gateway.service; curl -fsS http://127.0.0.1:20888/health'
```

Expected: local and live SHA-256 hashes match, the gateway is `active`, and health returns success.

- [ ] **Step 4: Run a read-only Chloe comprehension smoke**

Run without `--deliver` so the response stays in the CLI and no channel message is sent:

```bash
ssh root@194.233.94.3 'openclaw agent --agent main --session-key agent:main:chloe-newsletter-training-20260714 --message "Use the smartprop-crm skill. For the approved ViewProperty WhatsApp newsletter, explain which phone numbers are eligible, who selects the final five recipients, what you check in the dry-run, what you report after the run, and when you stop and escalate. Do not send anything and do not modify CRM data." --thinking low --timeout 180 --json'
```

Expected response requirements:

- only `+658XXXXXXX` and `+659XXXXXXX` mobile candidates;
- automatic final selection by the production runner, not manual Chloe sends;
- selected count and blocker reviewed in dry-run;
- exact recipient/message/outcome reporting with masked phones;
- escalation for WAHA not `WORKING`, expired/missing valuation, unknown outcome, or daily cap;
- no claim that any send or CRM mutation occurred.

- [ ] **Step 5: Verify campaign remained disabled and no send ledger changed**

Immediately before Step 2, record the ledger baseline with this read-only query:

```bash
ssh smartprop-vps 'set -a; . /etc/smartprop/newsletter-db.env; set +a; psql "$SMARTPROP_NEWSLETTER_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT COUNT(*) FILTER (WHERE is_test = FALSE), COUNT(*) FILTER (WHERE is_test = TRUE), COUNT(*) FILTER (WHERE attempt_started_at IS NOT NULL) FROM newsletter_sends;"'
```

After the comprehension smoke, run the same query again together with the disabled-state checks:

```bash
ssh smartprop-vps 'systemctl is-enabled smartprop-whatsapp-newsletter.timer 2>/dev/null || true; systemctl is-active smartprop-whatsapp-newsletter.timer 2>/dev/null || true; grep -E "^SMARTPROP_NEWSLETTER_ENABLED=" /opt/smartprop/app/smartprop/.env'
ssh smartprop-vps 'set -a; . /etc/smartprop/newsletter-db.env; set +a; psql "$SMARTPROP_NEWSLETTER_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT COUNT(*) FILTER (WHERE is_test = FALSE), COUNT(*) FILTER (WHERE is_test = TRUE), COUNT(*) FILTER (WHERE attempt_started_at IS NOT NULL) FROM newsletter_sends;"'
```

Expected: timer remains `disabled` and `inactive`, `SMARTPROP_NEWSLETTER_ENABLED=0`, and the three pipe-delimited ledger counts exactly match the baseline.

- [ ] **Step 6: Push the reviewed branch**

```bash
git push origin codex/whatsapp-newsletter-campaign
```

Expected: remote branch advances to the implementation commit.
