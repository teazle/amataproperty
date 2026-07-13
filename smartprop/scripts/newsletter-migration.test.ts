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
      'queue_newsletter_attempt',
      'start_newsletter_attempt',
      'finalize_newsletter_attempt',
      'record_accepted_newsletter_recovery',
      'create_newsletter_test_send',
      'finalize_newsletter_test_send',
      'finalize_newsletter_operator_report',
      'record_newsletter_opt_out',
      'resolve_newsletter_unknown',
    ]) {
      expect(sql).toContain(`FUNCTION ${name}`);
    }
  });

  test('persists selected candidates before assigning provider slots', () => {
    const queue = functionSql('queue_newsletter_attempt', 'start_newsletter_attempt');
    expect(queue).toContain('p_claim_token TEXT');
    expect(queue).toContain('p_valuation_snapshot JSONB');
    expect(queue).toMatch(/INSERT INTO newsletter_sends[\s\S]+valuation_snapshot[\s\S]+status[\s\S]+'queued'/i);
    expect(queue).toMatch(/v_run\.claim_token IS DISTINCT FROM btrim\(p_claim_token\)/i);
    expect(queue).toMatch(/issue\.audience_project_slug = project\.slug/i);
    expect(queue).toMatch(/lead\.status <> 'lost'/i);
    expect(queue).toMatch(/attempt_started_at IS NOT NULL/i);
    const queuedInsertColumns = queue.match(/INSERT INTO newsletter_sends\s*\(([^)]+)\)/i)?.[1] || '';
    expect(queuedInsertColumns).not.toContain('slot_no');
    expect(queuedInsertColumns).not.toContain('attempt_started_at');
  });

  test('starts only a persisted queued row with the current claim token', () => {
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS start_newsletter_attempt(UUID, UUID, INTEGER, TEXT);',
    );
    const start = functionSql('start_newsletter_attempt', 'finalize_newsletter_attempt');
    expect(start).toContain('p_send_id UUID');
    expect(start).toContain('p_slot_no INTEGER');
    expect(start).toContain('p_claim_token TEXT');
    expect(start).toMatch(/v_send\.status <> 'queued'/i);
    expect(start).toMatch(/v_run\.claim_token IS DISTINCT FROM btrim\(p_claim_token\)/i);
    expect(start).toMatch(/SET status = 'sending'[\s\S]+slot_no = p_slot_no[\s\S]+attempt_started_at = clock_timestamp\(\)/i);
    expect(start).toMatch(/FROM crm_leads[\s\S]+FOR UPDATE[\s\S]+v_current_recipient_key IS DISTINCT FROM v_identity\.recipient_key/i);
  });

  test('atomically releases queued STOP recipients with an explicit start outcome', () => {
    const start = functionSql('start_newsletter_attempt', 'finalize_newsletter_attempt');
    expect(start).toMatch(/v_send\.status = 'opted_out'[\s\S]+RETURN v_send/i);
    expect(start).toMatch(/IF v_lead\.opt_out_at IS NOT NULL[\s\S]+SET status = 'opted_out'[\s\S]+RETURNING \* INTO v_send[\s\S]+RETURN v_send/i);
    expect(start).toMatch(/FROM newsletter_suppressions[\s\S]+SET status = 'opted_out'[\s\S]+RETURNING \* INTO v_send[\s\S]+RETURN v_send/i);
    const queue = functionSql('queue_newsletter_attempt', 'start_newsletter_attempt');
    expect(queue).toMatch(/attempt_started_at IS NOT NULL OR status = 'queued'/i);
  });

  test('atomically records stale operator-report recovery on the run', () => {
    const recovery = functionSql(
      'recover_stale_newsletter_operator_reports',
      'record_newsletter_opt_out',
    );
    expect(recovery).toContain('p_before TIMESTAMPTZ');
    expect(recovery).toMatch(/UPDATE newsletter_operator_reports[\s\S]+SET status = 'unknown'[\s\S]+attempt_started_at < p_before/i);
    expect(recovery).toMatch(/UPDATE newsletter_runs[\s\S]+SET report_error = 'stale operator report outcome unknown'/i);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION recover_stale_newsletter_operator_reports');
  });

  test('atomically finalizes operator reports and persists terminal report errors', () => {
    const finalize = functionSql(
      'finalize_newsletter_operator_report',
      'recover_stale_newsletter_operator_reports',
    );
    expect(finalize).toContain('SECURITY DEFINER');
    expect(finalize).toContain('SET search_path = public');
    expectOrdered(finalize, [
      "hashtext('newsletter_run:' || v_identity.run_id::TEXT)",
      'SELECT * INTO v_run\n  FROM newsletter_runs',
      "hashtext('newsletter_operator_report:' || p_report_id::TEXT)",
      'SELECT * INTO v_report\n  FROM newsletter_operator_reports',
    ]);
    expect(finalize).toMatch(/SELECT \* INTO v_run[\s\S]+FROM newsletter_runs[\s\S]+FOR UPDATE/i);
    expect(finalize).toMatch(/SELECT \* INTO v_report[\s\S]+FROM newsletter_operator_reports[\s\S]+FOR UPDATE/i);
    expect(finalize).toMatch(/v_report\.status IN \('sent', 'failed', 'unknown'\)[\s\S]+RETURN v_report[\s\S]+conflicting operator report finalization replay/i);
    expect(finalize).toMatch(/UPDATE newsletter_operator_reports[\s\S]+RETURNING \* INTO v_report/i);
    expect(finalize).toMatch(/IF p_provider_outcome <> 'sent'[\s\S]+UPDATE newsletter_runs[\s\S]+report_error = v_report_error/i);
    expect(finalize).not.toMatch(/report_error\s*=\s*NULL/i);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION finalize_newsletter_operator_report');
    expect(sql).toContain('REVOKE ALL ON FUNCTION finalize_newsletter_operator_report');
  });

  test('transfers only stale claims after fifteen minutes', () => {
    const claim = functionSql('claim_newsletter_run', 'queue_newsletter_attempt');
    expect(claim).toMatch(/last_heartbeat_at\s*>=\s*clock_timestamp\(\)\s*-\s*INTERVAL '15 minutes'/i);
    expect(claim).toMatch(/SET claim_token = btrim\(p_claim_token\)[\s\S]+last_heartbeat_at = clock_timestamp\(\)/i);
  });

  test('persists accepted recovery without mutating CRM', () => {
    const recovery = functionSql(
      'record_accepted_newsletter_recovery',
      'record_newsletter_opt_out',
    );
    expect(recovery).toContain('p_provider_message_id TEXT');
    expect(recovery).toMatch(/SET status = 'unknown'[\s\S]+provider_outcome = 'sent'[\s\S]+retryable = FALSE/i);
    expect(recovery).toContain('crm_sync_error = btrim(p_error)');
    expect(recovery).toMatch(/UPDATE newsletter_runs[\s\S]+SET status = 'failed'[\s\S]+unknown_count = unknown_count \+ 1/i);
    expect(recovery).not.toContain('UPDATE crm_leads');
    expect(recovery).not.toContain('INSERT INTO crm_lead_activities');
  });

  test('repairs the run when accepted recovery is explicitly resolved', () => {
    const resolve = functionSql('resolve_newsletter_unknown');
    expect(resolve).toContain("blocker = 'accepted send requires CRM finalization recovery'");
    expect(resolve).toMatch(/unknown_count = 1[\s\S]+attempted_count < 5[\s\S]+THEN 'running'[\s\S]+ELSE 'completed'/i);
    expect(resolve).toMatch(/blocker = CASE[\s\S]+THEN NULL[\s\S]+ELSE blocker\s+END/i);
  });

  test('makes the send ledger service-role read-only', () => {
    expect(sql).toContain(
      'REVOKE ALL ON TABLE newsletter_sends FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(sql).toContain('GRANT SELECT ON TABLE newsletter_sends TO service_role;');
    expect(sql).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]+newsletter_sends\s+TO service_role/i);
  });

  test('provides secured test-send write RPCs without CRM or run mutation', () => {
    const createTest = functionSql('create_newsletter_test_send', 'finalize_newsletter_test_send');
    const finalizeTest = functionSql(
      'finalize_newsletter_test_send',
      'finalize_newsletter_operator_report',
    );
    for (const section of [createTest, finalizeTest]) {
      expect(section).toContain('SECURITY DEFINER');
      expect(section).toContain('SET search_path = public');
      expect(section).not.toContain('UPDATE crm_leads');
      expect(section).not.toContain('INSERT INTO crm_lead_activities');
      expect(section).not.toContain('UPDATE newsletter_runs');
    }
    expect(createTest).toMatch(/INSERT INTO newsletter_sends[\s\S]+status[\s\S]+is_test[\s\S]+'test'[\s\S]+TRUE/i);
    expect(createTest).toContain('override_phone');
    expect(finalizeTest).toMatch(/v_send\.is_test <> TRUE[\s\S]+v_send\.status <> 'test'/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION create_newsletter_test_send[\s\S]+FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION finalize_newsletter_test_send[\s\S]+FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION create_newsletter_test_send');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION finalize_newsletter_test_send');
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

  test('keeps suppression event writes owner-only and service-role read-only', () => {
    const stop = functionSql('record_newsletter_opt_out', 'resolve_newsletter_unknown');
    expect(stop).toContain('SECURITY DEFINER');
    expect(stop).toContain('INSERT INTO newsletter_suppression_events');
    expect(sql).toContain(
      'REVOKE ALL ON TABLE newsletter_suppression_events FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(sql).toContain(
      'GRANT SELECT ON TABLE newsletter_suppression_events TO service_role;',
    );
    expect(sql).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]+newsletter_suppression_events/i);
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
      'ASSERT: suppression event least privilege',
      'ASSERT: persisted queue restart safety',
      'ASSERT: queue suppression before start',
      'ASSERT: stale claim takeover',
      'ASSERT: accepted recovery persistence',
      'ASSERT: Task 1.1 secured RPC grants',
      'ASSERT: newsletter sends least privilege and spoofed GUC',
      'ASSERT: secured test-send RPCs',
      'ASSERT: post-queue phone change blocks start',
      'ASSERT: accepted recovery auto-repairs run',
      'ASSERT: queued STOP release and replacement capacity',
      'ASSERT: stale operator report recovery is atomic',
      'ASSERT: STOP replacement effective selected count',
      'ASSERT: operator report finalization is atomic',
    ]) {
      expect(assertions).toContain(marker);
    }
  });
});
