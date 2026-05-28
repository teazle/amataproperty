---
name: smartprop-crm
description: Use when asked to import, inspect, normalize, or manage SmartProp CRM leads, especially Excel/CSV files produced or normalized by OpenClaw.
---

# SmartProp CRM

Use this skill for SmartProp CRM lead imports, lead quality checks, and CRM workflow questions.

## Source Of Truth

- VPS: `root@109.123.239.107`
- App path: `/opt/smartprop/app/smartprop`
- Public CRM route: `https://viewproperty.ai/admin/crm`
- Local app route on VPS: `http://127.0.0.1:3000/admin/crm`
- Import API: `/api/admin/crm/import`
- CRM tables: `crm_projects`, `crm_leads`, `crm_lead_activities`

## Import Workflow

1. Inspect the file before importing. If possible, run:
   ```bash
   python3 /opt/openclaw-assistant/skills/newsletter-from-leads/scripts/profile_leads.py <file>
   ```
2. Accept `.xlsx`, `.xlsm`, `.csv`, and `.tsv` files.
3. Prefer importing through the admin UI drag-and-drop box at `/admin/crm` after admin login.
4. If using the API, keep admin auth intact. Do not bypass the protected route.
5. After import, verify the returned summary: rows read, added, skipped, duplicates, detected columns, and first skipped-row reason.
6. Refresh `/admin/crm` and confirm the added leads are visible in the correct project/status columns.

## OpenClaw-Normalized Columns

The CRM importer accepts these column families. Exact spelling, case, spaces, hyphens, and underscores can vary.

- Name: `name`, `full_name`, `contact_name`, `client_name`, `customer_name`, `lead_name`, `buyer_name`, `normalized_name`
- Phone: `phone`, `phone_number`, `mobile`, `mobile_number`, `whatsapp`, `whatsapp_number`, `contact_number`, `telephone`, `normalized_phone`, `normalized_mobile`
- Email: `email`, `email_address`, `email_addr`, `normalized_email`
- Project: `project_slug`, `slug`, `project`, `project_name`, `property_title`, `property_interest`, `interested_property`, `listing_title`
- Message/notes: `message`, `inquiry`, `inquiry_message`, `notes`, `remarks`, `requirements`, `normalized_message`
- Pipeline: `status`, `lead_status`, `pipeline_status`, `stage`
- Priority: `priority`, `lead_priority`
- Owner/follow-up: `assigned_to`, `agent`, `owner`, `follow_up_at`, `next_follow_up`, `next_follow_up_date`
- Source/audit: `source`, `lead_source`, `channel`, `origin`, `source_path`, `source_url`, `lead_url`, `external_id`, `openclaw_id`

## Import Rules

- Rows with no name and no contact are skipped.
- Rows with a name but no phone/email are skipped.
- Rows with a phone/email but no name are imported as `Unknown Lead`.
- Singapore 8-digit phone numbers are normalized to `+65...`.
- Email addresses are lowercased; invalid email text is ignored if a phone is available.
- Status defaults to `new`; warm/high-intent style values map to `qualified`; appointment/site-visit values map to `viewing_scheduled`.
- Priority defaults to `normal`; hot/urgent values map to `high`; cold/weak values map to `low`.
- Duplicates are skipped by email first, then phone.
- Original spreadsheet rows are stored only in import activity metadata for audit context.

## Safety

- Do not print full lead lists or raw personal data in chat. Summarize counts and a few non-sensitive examples only.
- Do not send WhatsApp, email, LinkedIn, or newsletter outreach from imported leads without using `outbound-approval` and receiving explicit approval for exact copy and recipient scope.
- Do not expose `.env.local`, OpenClaw tokens, cookies, browser profiles, or WhatsApp session files.

## Useful Checks

```bash
cd /opt/smartprop/app/smartprop
pm2 status --no-color
curl -fsS http://127.0.0.1:3000/api/health
curl -I http://127.0.0.1:3000/admin/crm
grep -n '"/api/admin/crm/import/route"' .next/server/app-paths-manifest.json
```
