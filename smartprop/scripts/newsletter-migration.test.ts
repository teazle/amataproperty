import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../migrations/019_add_whatsapp_newsletter_campaign.sql', import.meta.url),
  'utf8',
);
const assertions = readFileSync(
  new URL('./newsletter-schema-assertions.sql', import.meta.url),
  'utf8',
);

function functionSql(name: string, nextName?: string): string {
  const start = sql.indexOf(`FUNCTION ${name}`);
  const end = nextName ? sql.indexOf(`FUNCTION ${nextName}`, start + 1) : sql.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

function expectOrdered(section: string, fragments: string[]): void {
  let previous = -1;
  for (const fragment of fragments) {
    const current = section.indexOf(fragment);
    expect(current).toBeGreaterThan(previous);
    previous = current;
  }
}

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

  test('gates provider submissions to the current SGT day and five globally', () => {
    const start = functionSql('start_newsletter_attempt', 'finalize_newsletter_attempt');
    expect(start).toContain("v_sgt_date DATE := (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::DATE");
    expect(start).toMatch(/v_run\.run_date\s*<>\s*v_sgt_date/i);
    expect(start).toMatch(/run\.run_date\s*=\s*v_sgt_date[\s\S]+attempt_started_at IS NOT NULL/i);
    expect(start).toMatch(/v_day_attempt_count\s*>=\s*5/i);
  });

  test('caps real provider submissions at three per issue recipient', () => {
    expect(sql).toMatch(/attempt_no IS NULL OR attempt_no BETWEEN 1 AND 3/i);
    expect(sql).toMatch(/v_recipient_attempt_count\s*>=\s*3/i);
  });

  test('rejects provider states without a gated insert start', () => {
    expect(sql).toMatch(/status NOT IN \('sending', 'sent', 'failed', 'unknown'\)[\s\S]+attempt_started_at IS NOT NULL/i);
    const guard = functionSql('enforce_newsletter_attempt_submission', 'claim_newsletter_run');
    expect(guard).toMatch(/TG_OP = 'UPDATE'[\s\S]+OLD\.attempt_started_at IS NULL[\s\S]+NEW\.attempt_started_at IS NOT NULL[\s\S]+RAISE EXCEPTION/i);
  });

  test('requires immutable provider start identity and forward-only state', () => {
    expect(sql).toMatch(/attempt_started_at IS NULL[\s\S]+slot_no IS NOT NULL/i);
    const guard = functionSql('enforce_newsletter_attempt_submission', 'claim_newsletter_run');
    expect(guard).toMatch(/OLD\.attempt_started_at IS NOT NULL[\s\S]+NEW\.attempt_started_at IS DISTINCT FROM OLD\.attempt_started_at[\s\S]+RAISE EXCEPTION/i);
    expect(guard).toMatch(/OLD\.status = 'sending'[\s\S]+NEW\.status IN \('sent', 'failed', 'unknown'\)/i);
    expect(guard).toMatch(/OLD\.status = 'unknown'[\s\S]+NEW\.status IN \('sent', 'failed'\)/i);
    expect(guard).toContain('invalid newsletter provider state transition');
  });

  test('binds real recipient keys to canonical Singapore phone snapshots', () => {
    expect(sql).toMatch(/recipient_key = CASE[\s\S]+length\(regexp_replace\(phone,[\s\S]+\+65[\s\S]+END/i);
    expect(sql).toContain("recipient_key ~ '^\\+65[689][0-9]{7}$'");
    const guard = functionSql('enforce_newsletter_attempt_submission', 'claim_newsletter_run');
    expect(guard).toContain('recipient key must equal canonical Singapore E.164 phone snapshot');
  });

  test('does not backfill queued rows as provider submissions', () => {
    expect(sql).toContain(`attempt_started_at = COALESCE(
    send.attempt_started_at,
    CASE
      WHEN send.status IN ('sent', 'failed') THEN COALESCE(send.sent_at, send.created_at)
      ELSE NULL
    END
  )`);
  });

  test('allows only FK-driven lead nulling through append-only guard', () => {
    const trigger = functionSql('enforce_newsletter_attempt_append_only', 'enforce_newsletter_attempt_submission');
    expect(trigger).toMatch(/OLD\.lead_id IS NOT NULL[\s\S]+NEW\.lead_id IS NULL/i);
    expect(trigger).toMatch(/NOT EXISTS[\s\S]+FROM crm_leads[\s\S]+id = OLD\.lead_id/i);
  });

  test('forces unknown outcomes non-retryable and preserves provider outcome on resolution', () => {
    const finalize = functionSql('finalize_newsletter_attempt', 'record_newsletter_opt_out');
    const resolve = functionSql('resolve_newsletter_unknown');
    expect(sql).toMatch(/status <> 'unknown' OR retryable = FALSE/i);
    expect(finalize).toMatch(/WHEN p_provider_outcome = 'unknown' THEN FALSE/i);
    expect(resolve).not.toContain('provider_outcome = p_resolution');
    expect(resolve).toContain('unknown_resolution = p_resolution');
  });

  test('uses the documented lock order across state-changing RPCs', () => {
    expect(sql).toContain('Lock order: SGT day -> recipient -> run -> lead -> send.');
    for (const [name, next] of [
      ['finalize_newsletter_attempt', 'record_newsletter_opt_out'],
      ['resolve_newsletter_unknown', undefined],
    ] as const) {
      expectOrdered(functionSql(name, next), [
        "newsletter_recipient:",
        "newsletter_run:",
        'FROM newsletter_runs',
        'FROM crm_leads',
        "newsletter_send:",
        'FROM newsletter_sends',
      ]);
    }
  });

  test('short-circuits replayed STOP before CRM mutation', () => {
    const stop = functionSql('record_newsletter_opt_out', 'resolve_newsletter_unknown');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS newsletter_suppression_events');
    expect(sql).toMatch(/UNIQUE\s*\(recipient_key, provider_message_id\)/i);
    expect(sql).toContain('FUNCTION enforce_newsletter_suppression_event_append_only');
    expectOrdered(stop, [
      'INSERT INTO newsletter_suppression_events',
      'ON CONFLICT (recipient_key, provider_message_id) DO NOTHING',
      'IF v_claimed_message_id IS NULL THEN',
      'FROM newsletter_suppressions',
      'RETURN v_suppression',
    ]);
  });

  test('compares all persisted finalization fields before accepting a replay', () => {
    const finalize = functionSql('finalize_newsletter_attempt', 'record_newsletter_opt_out');
    expect(finalize).toContain("v_send.error IS NOT DISTINCT FROM NULLIF(btrim(p_error), '')");
    expect(finalize).toContain('v_send.retryable IS NOT DISTINCT FROM v_effective_retryable');
  });

  test('deduplicates operator summaries with null send ids', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_operator_summary[\s\S]+WHERE send_id IS NULL/i);
  });

  test('contains executable proofs for every reviewed boundary', () => {
    for (const marker of [
      'ASSERT: global five-attempt gate',
      'ASSERT: three-attempt recipient limit',
      'ASSERT: stale-run rejection and resume safety',
      'ASSERT: FK lead nulling',
      'ASSERT: unknown is non-retryable',
      'ASSERT: duplicate-phone STOP idempotency',
      'ASSERT: service-role grants and fixed search paths',
      'ASSERT: provider submission negative transitions',
      'ASSERT: STOP event ledger A-B-A replay',
    ]) {
      expect(assertions).toContain(marker);
    }
  });
});
