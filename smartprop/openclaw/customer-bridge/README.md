# SmartProp customer bridge — activation checklist

## Current status: LOCAL-ONLY

This is an operational design note for the controller-owned customer-bridge
candidate. It does **not** activate a plugin, change a provider, send a message,
copy credentials, or establish a live customer route.

Keep the existing OpenClaw WhatsApp account. Do not relink with a QR code, copy
tokens, or import/export session state. The current channel owner remains the
existing `whatsapp:default` account; this bridge is an ingress seam for a small,
explicit customer set, not a channel replacement.

The SmartProp transport selector currently understands:

- `SMARTPROP_WHATSAPP_PROVIDER` — default is WAHA; do **not** switch it yet.
- `SMARTPROP_OPENCLAW_WHATSAPP_ACCOUNT` — defaults to `default` when OpenClaw
  transport is eventually selected.
- `OPENCLAW_BIN` — the local OpenClaw command override.
- `SMARTPROP_OPENCLAW_WEBHOOK_SECRET` — required by the local OpenClaw ingress.

Remaining listing-match and viewing-request jobs are not migrated by this bridge.
They must continue on their current transport, so `SMARTPROP_WHATSAPP_PROVIDER`
must **not** be changed as part of this work.

## Preconditions — all required before any customer allowlist entry

1. Retain the existing OpenClaw WhatsApp account and its current session. No QR,
   token, cookie, or state copying is part of activation.
2. Configure a **separate, unprivileged, no-tool fallback agent** for customer
   conversations and configure explicit operator peer routing for operator
   conversations. The exact runtime fallback/peer-routing configuration keys are
   not established by this repository and require controller verification before
   activation.
3. Define exact, normalized individual phone identities for both allowlists:

   - `operatorNumbers` must be non-empty.
   - `customerNumbers` contains only the customers explicitly approved for this
     bridge.
   - The two lists must be disjoint. Do not use broad country, prefix, group, or
     pattern-based allowlists.

   Do not add even one customer to `customerNumbers` until step 2 is complete.
4. Use the bridge candidate's configuration vocabulary only:
   `accountId`, `selfNumber`, `operatorNumbers`, `customerNumbers`, `endpoint`,
   and `secretEnv`. Its configuration schema rejects undeclared properties.
5. Use only the loopback endpoint `http://127.0.0.1:<app-port>/api/wa/openclaw`,
   with the actual app port verified by the controller. Set
   `secretEnv` to `SMARTPROP_OPENCLAW_WEBHOOK_SECRET`; the local value is an
   HMAC secret placeholder such as `<set-locally-never-copy>`, never a real
   secret in this document, source control, chat, or plugin configuration.

## Routing and failure boundaries

- The candidate registers an OpenClaw `before_dispatch` hook for the retained
  WhatsApp account only. It accepts a customer only when the account, WhatsApp
  channel, sender identity, message identity, body, and non-group status all
  agree.
- Operators are deliberately not forwarded to SmartProp and continue to the
  explicit operator peer route. Customer routing must not become an implicit
  operator fallback.
- Within the configured account/channel, groups, LID-like/invalid senders,
  unknown customers, conflicting identities, missing IDs and malformed messages
  are claimed without invoking the operator model. Other accounts/channels are
  outside this hook's scope. Plugin configuration/load failures require the
  separate unprivileged fallback route; the hook cannot protect a runtime in
  which it did not load.
- A failed handoff is also terminal for that customer event: reconcile it through
  the controller; do not auto-retry or hand the message to the operator model.
- The SmartProp ingress verifies the raw body with HMAC SHA-256 and a fresh
  seconds timestamp before any CRM/AI path. Keep the secret local to the
  loopback pair.

## Timestamp evidence

The controller candidate is based on OpenClaw **2026.9.2** `before_dispatch`
hook types. Its event timestamp is milliseconds and is explicitly converted with
`Math.floor(event.timestamp / 1000)` before it reaches the existing CRM/WAHA
numeric-seconds contract. Do not pass hook milliseconds through unchanged.

## Functional acceptance — controller-owned, after authorization

Do not use a synthetic send or a test-send shortcut as acceptance. After the
preconditions are met and user authorization covers the live boundary, require:

1. One permitted real inbound message from a customer already present in the
   exact customer allowlist.
2. A controller check that SmartProp received the correctly signed, normalized
   event once and that its existing STOP/dedupe/conversation path produced the
   expected result.
3. An operator check that an operator peer remains on the explicit operator
   route and was not claimed as a customer.
4. Evidence that groups and an unknown customer remain fail-closed, without
   sending any synthetic customer message.

Only these checks can establish functional readiness. They do not authorize
provider migration, outbound campaigns, listing matching, viewing requests, QR
relinking, token changes, or automated sends.

## Evidence used for this note

- Controller candidate: `bridge.ts`, `index.ts`, and `openclaw.plugin.json` in
  the SmartProp customer-bridge candidate.
- Existing SmartProp transport selection and OpenClaw ingress source under
  `src/lib/wa/`.
- Controller OpenClaw 2026.9.2 continuity record: the retained
  `whatsapp:default` account and explicit channel owner are live, while CRM
  transport migration remains separate.
