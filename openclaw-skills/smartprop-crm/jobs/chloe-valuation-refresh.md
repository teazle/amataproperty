# Chloe Valuation Refresh Job

Prepare current project-level valuation evidence for the approved ViewProperty
WhatsApp newsletter. This job researches valuations only. It never selects a
recipient and never sends a message.

1. Run `ssh -T smartprop-valuation 'queue --json'` once. Parse the JSON. If it
   reports no candidates or a blocker, report only the status, counts, and
   blocker, then stop.
2. Keep the returned `runId`, `leaseToken`, and each `itemId` private. Never
   print them in chat or include them in the operator report.
3. For each queue item, research the exact `projectSlug` and server-provided
   project profile. Use at least two independent registered sources from
   different ownership groups. At least one source must be a recent transaction
   or official valuation. Do not use a search snippet alone as evidence.
   Registered source hosts are `eservice.ura.gov.sg`, `data.gov.sg`,
   `edgeprop.sg`, `99.co`, `srx.com.sg`, `propertyguru.com.sg`,
   `homejourney.sg`, `nexthome.sg`, and `propnex.com`. Two hosts in the same
   ownership group do not count as independent sources.
4. While researching, run the exact heartbeat command at least every five
   minutes:

   `ssh -T smartprop-valuation 'heartbeat --run-id RUN_ID --lease-token LEASE_TOKEN --json'`

5. Hash the exact source content used with SHA-256. Submit JSON evidence over
   standard input with this command:

   `printf '%s' "$EVIDENCE_JSON" | ssh -T smartprop-valuation 'import --run-id RUN_ID --item-id ITEM_ID --lease-token LEASE_TOKEN --json'`

   The top-level JSON is `{"kind":"evidence","evidence":{...}}`. Evidence
   includes project-level low/mid/high SGD values or a midpoint, comparable
   count, medium/high confidence, basis, `asOf`, acquisition method, and 2-8
   sources. Each source includes canonical HTTPS URL, evidence date, permitted
   evidence type, a factual detail, and a 64-character SHA-256 content hash.
   Never include unit, address, postal code, lead identity, phone, or email.
6. If the registered sources are unavailable, import a bounded blocked result
   with attempted source URLs and a factual reason. For an unexpected research
   failure, import a failed result with a factual reason and retryable boolean.
   Never invent values, weaken confidence, or extend an expiry date.
7. After every item has a persisted outcome, run:

   `ssh -T smartprop-valuation 'complete --run-id RUN_ID --lease-token LEASE_TOKEN --json'`

8. Report only counts and blockers: candidate, accepted, rejected, blocked, and
   failed totals. Do not print lead PII, source tokens, lease values, full JSON,
   or recipient details.

Hard boundaries: do not send WhatsApp, select recipients, run SQL, modify CRM
contacts, update the valuation cache manually, call WAHA, or invoke any command
outside the four exact SSH forms above. The SmartProp campaign runner owns the
approved daily selection, send, CRM update, STOP handling, and operator report.
