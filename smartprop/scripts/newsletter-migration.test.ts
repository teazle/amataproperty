import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../migrations/019_add_whatsapp_newsletter_campaign.sql', import.meta.url),
  'utf8',
);

describe('newsletter migration contract', () => {
  test('creates one global SGT-day run and five numbered slots', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS newsletter_runs');
    expect(sql).toMatch(/UNIQUE\s*\(run_date\)/i);
    expect(sql).toMatch(/slot_no[^;]+CHECK\s*\(slot_no BETWEEN 1 AND 5\)/is);
  });

  test('models unknown outcomes and partial recipient uniqueness', () => {
    expect(sql).toContain("'unknown'");
    expect(sql).toMatch(
      /WHERE status IN \('queued', 'sending', 'sent', 'unknown'\)/i,
    );
    expect(sql).toMatch(/issue_id, recipient_key, attempt_no/i);
  });

  test('defines atomic run, attempt, STOP, finalization and resolution RPCs', () => {
    for (const name of [
      'claim_newsletter_run',
      'start_newsletter_attempt',
      'finalize_newsletter_attempt',
      'record_newsletter_opt_out',
      'resolve_newsletter_unknown',
    ]) {
      expect(sql).toContain(`FUNCTION ${name}`);
    }
  });
});
