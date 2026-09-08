/**
 * Short opaque tracking codes appended to newsletter CTA URLs as ?ref=<code>
 * (migrations/017_add_newsletter_pipeline.sql documents the "vp1a2b3c" shape).
 *
 * Codes are cryptographically random and do not embed lead PII or a lead UUID.
 * They remain tracking identifiers; they are not authentication secrets.
 */

const CODE_SUFFIX_LENGTH = 6;
const HEX_DIGITS = '0123456789abcdef';

/** Bounded retries covering unique-index collisions and concurrent claims. */
export const MAX_LEAD_CODE_CLAIM_ATTEMPTS = 5;

export function generateLeadCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_SUFFIX_LENGTH));
  let suffix = '';
  for (const byte of bytes) suffix += HEX_DIGITS[byte % 16];
  return `vp${suffix}`;
}

/**
 * Dry-run-only composition stand-in. Clearly distinguishable from a persisted
 * code so a preview body can never be mistaken for a trackable CTA link.
 */
export function generatePreviewLeadCode(): string {
  return `preview-${generateLeadCode()}`;
}
