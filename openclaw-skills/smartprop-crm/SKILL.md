---
name: smartprop-crm
description: Use when asked to import, inspect, browse, or update SmartProp CRM leads (Excel/CSV from OpenClaw or hand-curated lists), or to triage the CRM at https://viewproperty.ai/admin/crm.
---

# SmartProp CRM

The SmartProp CRM is a single-table lead list backed by Supabase. The UI is at
`https://viewproperty.ai/admin/crm` (admin auth required). It scales to thousands
of leads via server-side pagination + sortable columns, and accepts spreadsheet
imports through the **Import** dialog in the toolbar.

## Source Of Truth

- VPS: `ssh smartprop-vps` (alias for `root@109.123.239.107` on port **2222**).
  Do not try bare `root@109.123.239.107` — sshd is not on port 22.
- App path on VPS: `/opt/smartprop/app/smartprop` (PM2 process `smartprop`).
- Public CRM route: `https://viewproperty.ai/admin/crm`
- Local app route on VPS: `http://127.0.0.1:3000/admin/crm`
- Admin login: `POST /api/admin/auth/login` with `{ "password": "<admin-password>" }`.
  The cookie name on prod is `viewproperty_admin_session`.
- CRM tables: `crm_projects`, `crm_leads`, `crm_lead_activities`.
- Inbound OpenClaw spreadsheets: `/root/.openclaw/media/inbound/*.xlsx`

## Import API

```
POST /api/admin/crm/import
Content-Type: multipart/form-data
Body:
  file                — .xlsx / .xlsm / .csv / .tsv
  defaultProjectSlug  — project to use for rows that don't carry a project_slug column
```

Response:
```json
{
  "fileName": "FSBO_LANDED.xlsx",
  "rowsRead": 105,
  "imported": 64,
  "skipped": 41,
  "duplicates": 41,
  "detectedColumns": ["PT","DT","LOCATION","TNR","LAND","R/B","PSF","PRICE$","NAME","PHONE","DATE"],
  "skippedRows": [{ "rowNumber": 4, "reason": "Duplicate contact" }]
}
```

When `defaultProjectSlug` is provided, it now overrides the slug that would
otherwise be inferred from the property title. Use this to keep imports
isolated by source file (see "Owner outreach projects" below).

## List + Detail APIs

- `GET /api/admin/crm/leads?project=<slug|all>&status=<status|all>&search=<q>&page=1&pageSize=50&sortBy=created_at&sortDir=desc`
  - `pageSize` capped at 200.
  - `sortBy` whitelist: `created_at`, `updated_at`, `last_activity_at`,
    `follow_up_at`, `name`, `status`, `priority`, `property_title`.
  - Returns `{ leads, total, page, pageSize }`. **Activities are not joined**;
    fetch them only when you open a lead.
- `GET /api/admin/crm/leads/[id]` — returns the lead with its full activity timeline.
- `PATCH /api/admin/crm/leads/[id]` — updates status/priority/assignedTo/followUpAt
  and returns the lead with refreshed activities.
- `POST /api/admin/crm/leads/[id]/activities` — adds a note/call/follow-up entry.
- `GET /api/admin/crm/projects` — list of active CRM projects.

## Accepted Column Shapes

The importer normalizes case, spaces, hyphens, and underscores. Three input
shapes are recognized natively: the "normalized_*" naming, the raw OpenClaw
FSBO/FRBO codes, and URA-caveats transaction exports.

| Field          | Accepted columns                                                                                                                          |
|----------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| Name           | `name`, `full_name`, `contact_name`, `client_name`, `customer_name`, `lead_name`, `buyer_name`, `normalized_name`, `NAME`, `Purchasers`, `Buyer` |
| Phone          | `phone`, `phone_number`, `mobile`, `mobile_number`, `HP`, `handphone`, `whatsapp`, `whatsapp_number`, `contact_number`, `telephone`, `Pur Tel`, `Proj Tel`, `normalized_phone`, `normalized_mobile`, `PHONE` |
| Email          | `email`, `email_address`, `email_addr`, `normalized_email`                                                                                |
| Property title | `property_title`, `property_interest`, `interested_property`, `property`, `project`, `project_name`, `listing`, `listing_title`, `LOCATION`, `address`, `property_address`, `ProjName` |
| Project slug   | `project_slug`, `slug`                                                                                                                    |
| Message/notes  | `message`, `inquiry`, `inquiry_message`, `notes`, `remarks`, `requirements`, `normalized_message`                                         |
| Status         | `status`, `lead_status`, `pipeline_status`, `stage`                                                                                       |
| Priority       | `priority`, `lead_priority`                                                                                                                |
| Owner          | `assigned_to`, `agent`, `owner`, `handled_by`                                                                                              |
| Follow-up      | `follow_up_at`, `next_follow_up`, `next_follow_up_date`                                                                                    |
| Source         | `source`, `lead_source`, `channel`, `origin`                                                                                               |
| External id    | `id`, `lead_id`, `external_id`, `openclaw_id`, `record_id`                                                                                 |
| Source path    | `source_path`, `source_page`, `page_path`                                                                                                  |
| Source URL     | `source_url`, `url`, `lead_url`, `profile_url`                                                                                             |

Phone aliases are checked top-to-bottom — `HP` beats `Pur Tel` so caveats rows
that have both mobile + landline use the mobile.

## OpenClaw FSBO/FRBO files

The inbound FSBO/FRBO spreadsheets ship with this schema:

```
PT, DT, LOCATION, TNR, LAND|AREA, R/B, PSF, PRICE$, NAME, PHONE, DATE
```

Only **NAME** and **PHONE** map to contact fields. The importer auto-synthesizes
the lead message from the remaining property columns, e.g.

> [OpenClaw] · Condo · D21 · CAVENDISH PARK, PINE GROVE, 16, #05 ABOVE
> 1389 sqft · 3R/1B · 99-yr leasehold
> Asking 1,550K · 1116 psf
> Listed 16 Jun 2016.

Notes:
- Property type codes (PT column) are expanded: CO=Condo, CT=Cluster Terrace,
  TR=Terrace, BU=Bungalow, SD=Semi-Detached, PH=Penthouse, PW=Penthouse Walkup,
  AP=Apartment, WK=Walk-up.
- DATE columns containing Excel serial numbers (e.g. `42545`) are converted to
  Singapore-localized strings.
- NAME column garbage like `"MRS TAN 69660869"` or `"JIMMY (LH)"` is cleaned
  to just `"MRS TAN"` / `"JIMMY"`.
- FRBO files have a blank top row before the header — the XLSX parser skips it
  automatically.

## URA caveats files (.xls)

Legacy URA caveats exports look like `ALESSANDREA H62 97 1453A.xls` —
condo-specific transaction history with `Proj Blk, Proj Street, Proj Unit,
Proj Postal, ProjName, Contract Date, Amount, Area, Purchasers, HP, Pur Blk,
Pur Street, Pur Unit, Pur Postal, Proj Tel, Pur Tel`. Each row is one purchaser
(joint owners appear as two rows on the same unit).

The CRM importer does **not** read the binary `.xls` format directly — convert
to CSV first using the snippet below, then upload through the same import API
or the admin UI dialog:

```bash
python3 << 'EOF'
import xlrd, csv
def cell_to_str(cell, datemode):
    if cell.ctype == xlrd.XL_CELL_DATE:
        from xlrd.xldate import xldate_as_datetime
        return xldate_as_datetime(cell.value, datemode).strftime("%Y-%m-%d")
    v = cell.value
    return str(int(v)) if isinstance(v, float) and v.is_integer() else str(v).strip()
src, dst = "/tmp/INPUT.xls", "/tmp/output.csv"
wb = xlrd.open_workbook(src)
sh = wb.sheet_by_index(0)  # main sheet, not the H<NN> curated subset
with open(dst, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    for i in range(sh.nrows):
        w.writerow([cell_to_str(sh.cell(i, c), wb.datemode) for c in range(sh.ncols)])
EOF
```

When the rows arrive, the importer synthesizes a caveats-style note:

> [OpenClaw] · ALESSANDREA · #01-01 · 116 sqm
> Purchased 14 Aug 2001 for SGD 778,388.
> Project: 31, ALEXANDRA ROAD, S159967.
> Buyer address: 45, SIMEI RISE, #08-29, S528786.

Rows with no `HP` or `Pur Tel` are skipped as `Missing contact`. Joint
purchasers with different mobile numbers become two leads on the same unit;
joint purchasers sharing a phone are deduped.

## CRM projects (routing)

Route imports into their dedicated project so the CRM filter dropdown can
separate the lead types. Pass `defaultProjectSlug` in the import multipart
body — it now overrides any slug inferred from the property title.

| Source file                                     | `defaultProjectSlug`   |
|-------------------------------------------------|------------------------|
| FSBO_LANDED.xlsx                                | `fsbo-landed`          |
| FSBO_PTE_APARTMENT.xlsx                         | `fsbo-pte-apartment`   |
| FRBO_LANDED.xlsx                                | `frbo-landed`          |
| FRBO_PTE_APARTMENT.xlsx                         | `frbo-pte-apartment`   |
| `<CONDO> H<NN> <total> <ref>.xls` (caveats)     | `<condo-slug>`         |

Caveats projects already created: `alessandrea`, `cliften`. For a new condo,
create the project row first via the Supabase admin (or `POST /rest/v1/crm_projects`)
before importing — the importer rejects unknown slugs by falling back to
`general-luxe`, which mixes prospects with customer enquiries.

Existing customer enquiry projects (do not mix owner prospects in here):
`general-luxe`, `upperhouse`, `promenade-peak`, `zyon-grand`, `river-modern`,
`union-square`.

## Import Workflow

1. **Inspect** the file before importing:
   ```bash
   python3 /opt/openclaw-assistant/skills/newsletter-from-leads/scripts/profile_leads.py <file>
   ```
   Look for: row count, detected name/email/phone columns, duplicate email
   examples. If the columns aren't detected, the header row is probably not
   on row 1 — but the SmartProp parser handles that automatically.

2. **Pick the destination project** before uploading. Use the table above for
   owner prospects, or the existing slugs for customer enquiries.

3. **Prefer the admin UI** — log into `/admin/crm`, open the **Import** dialog
   from the toolbar, and drop the file in. The dialog shows rowsRead/imported/
   skipped/duplicates and the first skip reason on success.

4. **If using the API**, keep admin auth intact:
   ```bash
   COOKIE=$(curl -s -i -X POST https://viewproperty.ai/api/admin/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"password":"<admin>"}' | awk '/^set-cookie:/{print $2}' | head -1 | tr -d ';')
   curl -X POST https://viewproperty.ai/api/admin/crm/import \
     -H "cookie: $COOKIE" \
     -F "file=@FSBO_LANDED.xlsx" \
     -F "defaultProjectSlug=fsbo-landed"
   ```

5. **Verify** the per-project count after import:
   ```bash
   curl -s -H "cookie: $COOKIE" \
     "https://viewproperty.ai/api/admin/crm/leads?project=fsbo-landed&pageSize=1" \
     | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])'
   ```

## Import Rules

- Rows with no name and no contact are skipped (`Missing name and contact`).
- Rows with a name but no phone/email are skipped (`Missing contact`).
- Rows with a phone/email but no name are imported as `Unknown Lead`.
- Singapore 8-digit phone numbers are normalized to `+65...`.
- Email addresses are lowercased; invalid email text is ignored if a phone is available.
- Status defaults to `new`; `warm` / `qualified_lead` / `high_intent` / `interested` map to `qualified`;
  `called` / `replied` / `followed_up` / `responded` map to `contacted`;
  `viewing` / `appointment_scheduled` / `site_visit` map to `viewing_scheduled`;
  `deal` / `negotiation` / `proposal` map to `offer`;
  `closed` / `closed_won` / `converted` map to `won`;
  `closed_lost` / `dead` / `not_interested` / `invalid` map to `lost`.
- Priority defaults to `normal`; `hot` / `urgent` / `important` map to `high`;
  `cold` / `weak` map to `low`.
- Duplicates are skipped by email first, then phone (within-file and cross-file).
- Original spreadsheet rows are stored only in import activity metadata for audit context.

## Chloe's Daily WhatsApp Newsletter Workflow

This ViewProperty valuation newsletter is already approved for automatic operation.
It does not need a new approval every day. The production campaign runner, not an
OpenClaw chat send tool, owns recipient selection, sending, CRM updates, STOP
suppression, and the operator report.

1. Import and manage newsletter leads in the SmartProp CRM. Keep each list in the
   correct CRM project and verify the imported/skipped/duplicate counts.
2. Confirm the newsletter issue is approved and its audience project is active.
   Do not edit an approved issue while a run is in progress.
3. The scheduled runner starts at 09:30 SGT and may start at most five real WAHA
   provider sends per SGT day. Failed or unknown provider submissions still consume
   a daily slot. Do not manually resend them or run a second unledgered batch.
4. The runner updates the CRM after each accepted send and records every attempt in
   the append-only newsletter ledger. Chloe must not manually mark an unsent lead as
   contacted or alter ledger rows to make a run appear successful.
5. Exact inbound replies `STOP`, `UNSUBSCRIBE`, `CANCEL`, `OPTOUT`, or `OPT OUT`
   are handled before AI processing. The number is durably suppressed, matching CRM
   rows are opted out, and queued attempts are cancelled. Do not re-import or message
   a suppressed number through another route.
6. After the run, relay the generated operator report. For each attempted recipient,
   report the lead name, masked phone, exact message body, and final provider outcome.
   Report blockers and unknown outcomes explicitly; never claim a send from WAHA
   container health alone.

The configured operator/test number is server-side only and must never be imported
as a CRM lead. A controlled `test-send` may target only that configured number and
must leave the source lead's CRM state unchanged. If WAHA is not exactly `WORKING`,
report that the campaign is blocked and wait for the operator to relink it. Do not
fall back to OpenClaw's WhatsApp channel, email, or a manual five-recipient send.

Useful read-only campaign checks:

```bash
ssh smartprop-vps 'curl -fsS http://127.0.0.1:3000/api/health'
ssh smartprop-vps 'cd /opt/smartprop/app/smartprop && /root/.bun/bin/bun scripts/run-whatsapp-newsletter-campaign.ts run --dry-run --json'
ssh smartprop-vps 'systemctl status smartprop-whatsapp-newsletter.timer --no-pager'
```

Escalate to the operator when health reports WAHA disconnected, an unknown provider
outcome exists, the current run is stale, the approved issue is missing, or the
daily attempt count is already five. Unknown outcomes require provider evidence and
the audited `resolve-unknown` command in `docs/WHATSAPP_NEWSLETTER_OPERATIONS.md`.

## Safety

- Do not print full lead lists or raw personal data in chat. Summarize counts
  and a few non-sensitive examples only.
- Except for the approved daily ViewProperty WhatsApp newsletter workflow above,
  do not send WhatsApp, email, LinkedIn, or other outreach from imported leads
  without using `outbound-approval` and receiving explicit approval for exact copy
  and recipient scope.
- Do not expose `.env.local`, OpenClaw tokens, cookies, browser profiles, or
  WhatsApp session files.
- The VPS has no git checkout; deploys are rsync-from-laptop (`rsync -avzR`
  preserves paths) followed by `bun run build && pm2 reload smartprop`. If a
  build fails after a code change, clear `.next` first.

## Useful Checks

```bash
ssh smartprop-vps 'cd /opt/smartprop/app/smartprop && pm2 status --no-color'
ssh smartprop-vps 'curl -fsS http://127.0.0.1:3000/api/health'
ssh smartprop-vps 'curl -I http://127.0.0.1:3000/admin/crm'
ssh smartprop-vps 'grep -c "/api/admin/crm" /opt/smartprop/app/smartprop/.next/server/app-paths-manifest.json'
```
