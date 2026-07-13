# Chloe Mobile-Only Newsletter Workflow Design

**Date:** 2026-07-14
**Status:** Approved

## Goal

Teach Chloe to prepare and operate the approved ViewProperty WhatsApp newsletter
workflow using only valid Singapore mobile contacts, while preserving deterministic
selection, delivery, CRM updates, opt-out enforcement, and reporting in the
production campaign runner.

## Operating Model

Chloe owns lead preparation and operational review. The SmartProp campaign runner
owns final eligibility checks, selection of up to five recipients per Singapore
day, WAHA submission, CRM activity updates, STOP suppression, and operator reports.
Chloe must not manually send a parallel batch or override a skipped recipient.

## Chloe's Workflow

### Before a run

1. Import leads into the correct SmartProp CRM project and review the import counts.
2. Use a mobile number when a source row contains both a mobile and a landline.
3. Treat only numbers that normalize to `+658XXXXXXX` or `+659XXXXXXX` as WhatsApp
   newsletter candidates. Landlines, malformed numbers, duplicates, opted-out
   contacts, suppressed contacts, and lost leads are not candidates.
4. Confirm that the newsletter issue is approved, its audience project is active,
   and the project has a current approved valuation.
5. Run the campaign dry-run and review the selected count and blocker. Chloe must
   not infer readiness from WAHA container health alone.

### During a run

1. Let the production runner choose up to five eligible recipients. Chloe does not
   manually choose or send the five messages through OpenClaw chat tools.
2. Do not retry failed or unknown submissions manually. Every provider submission
   consumes a daily slot and remains in the append-only campaign ledger.
3. Stop and escalate when WAHA is not exactly `WORKING`, the valuation is missing or
   expired, an unknown provider outcome exists, or the daily attempt cap is reached.

### After a run

1. Relay the generated operator report containing each attempted lead's name,
   masked mobile number, exact message body, and final provider outcome.
2. Report excluded invalid or landline contacts as counts and reasons without
   exposing a raw lead list.
3. Confirm that accepted sends produced CRM activity updates. Never mark an unsent
   or rejected lead as contacted.
4. Treat `STOP`, `UNSUBSCRIBE`, `CANCEL`, `OPTOUT`, and `OPT OUT` as durable
   suppressions. Chloe must not re-import or contact a suppressed number through
   another route.

## System Guardrails

- Recipient normalization remains enforced by the campaign code. Chloe's screening
  is an operational pre-check, not the final authorization to send.
- The five-per-day limit counts real WAHA submission attempts, including failed or
  unknown outcomes.
- The configured operator/test number remains separate from CRM lead data.
- `SMARTPROP_NEWSLETTER_ENABLED` and the systemd timer stay disabled until the
  controlled-send, STOP, monitoring, and production-readiness gates pass.

## Implementation

1. Expand `openclaw-skills/smartprop-crm/SKILL.md` with the mobile-only preparation,
   dry-run interpretation, reporting, and escalation workflow.
2. Add a focused regression test that fails if Chloe's durable skill omits the
   mobile format, automatic-selection ownership, dry-run check, reporting duties,
   or no-manual-send rule.
3. Deploy the reviewed skill to Chloe's live OpenClaw workspace on
   `194.233.94.3` without changing the SmartProp campaign schedule or sending any
   WhatsApp message.
4. Verify the live file hash/content, gateway health, and a read-only Chloe agent
   response that correctly explains the workflow.

## Success Criteria

- Chloe can state which Singapore numbers are valid campaign candidates.
- Chloe knows that the runner, not she, selects the final five recipients.
- Chloe knows how to run and interpret the dry-run before operational activation.
- Chloe knows what to report after a run and when to escalate.
- Invalid or landline contacts remain rejected by code even if imported.
- No live campaign, timer, or WhatsApp send is activated as part of this change.
