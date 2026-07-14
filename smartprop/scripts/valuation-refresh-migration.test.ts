import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../migrations/020_add_chloe_valuation_refresh.sql', import.meta.url),
  'utf8',
);

function functionSql(name: string, nextName?: string): string {
  const start = sql.indexOf(`FUNCTION ${name}`);
  const end = nextName ? sql.indexOf(`FUNCTION ${nextName}`, start + 1) : sql.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

function expectSecured(section: string): void {
  expect(section).toContain('SECURITY DEFINER');
  expect(section).toContain('SET search_path = public, pg_temp');
}

describe('valuation refresh migration contract', () => {
  test('adds the project profile and accepted valuation identity columns', () => {
    expect(sql).toMatch(
      /ALTER TABLE crm_projects[\s\S]+valuation_location[\s\S]+valuation_property_type[\s\S]+valuation_tenure[\s\S]+valuation_area_distribution[\s\S]+valuation_profile_updated_at/i,
    );
    expect(sql).toMatch(
      /ALTER TABLE propnex_valuations[\s\S]+project_slug[\s\S]+evidence_status[\s\S]+evidence_contract_version[\s\S]+evidence_item_id[\s\S]+validated_confidence/i,
    );
  });

  test('creates the run and immutable item ledgers with exact state contracts', () => {
    expect(sql).toContain('CREATE TABLE newsletter_valuation_runs');
    expect(sql).toContain('CREATE TABLE newsletter_valuation_items');
    expect(sql).toMatch(
      /status TEXT NOT NULL CHECK \(status IN \('running','completed','quiet','blocked','failed'\)\)/i,
    );
    expect(sql).toMatch(/UNIQUE NULLS NOT DISTINCT\s*\(run_date, issue_id\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(run_id, project_slug\)/i);
    expect(sql).toMatch(/CHECK\s*\(project_slug = lower\(project_slug\)\)/i);
    expect(sql).toMatch(/lease_token UUID NOT NULL DEFAULT gen_random_uuid\(\)/i);
  });

  test('protects item identity and profile snapshots with an immutable trigger', () => {
    expect(sql).toContain('FUNCTION enforce_newsletter_valuation_item_immutable()');
    expect(sql).toMatch(
      /enforce_newsletter_valuation_item_immutable[\s\S]+OLD\.run_id[\s\S]+OLD\.project_slug[\s\S]+OLD\.project_profile[\s\S]+RAISE EXCEPTION/i,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_newsletter_valuation_item_immutable[\s\S]+BEFORE UPDATE OR DELETE ON newsletter_valuation_items/i,
    );
  });

  test('defines the preparation RPC signatures and internal issue resolver', () => {
    for (const signature of [
      'claim_newsletter_valuation_run(p_worker_id text, p_source_revision text)',
      'heartbeat_newsletter_valuation_run(p_run_id uuid, p_lease_token uuid)',
      'record_newsletter_valuation_item(p_run_id uuid, p_item_id uuid, p_lease_token uuid, p_outcome jsonb)',
      'complete_newsletter_valuation_run(p_run_id uuid, p_lease_token uuid)',
      'get_newsletter_valuation_gate(p_issue_id uuid)',
      'resolve_active_newsletter_issue()',
    ]) {
      expect(sql).toContain(`FUNCTION ${signature}`);
    }
  });

  test('secures every public preparation RPC with a fixed search path', () => {
    const functions = [
      ['claim_newsletter_valuation_run', 'heartbeat_newsletter_valuation_run'],
      ['heartbeat_newsletter_valuation_run', 'record_newsletter_valuation_item'],
      ['record_newsletter_valuation_item', 'complete_newsletter_valuation_run'],
      ['complete_newsletter_valuation_run', 'get_newsletter_valuation_gate'],
      ['get_newsletter_valuation_gate', 'assert_newsletter_valuation_gate'],
    ] as const;

    for (const [name, next] of functions) {
      expectSecured(functionSql(name, next));
    }
  });

  test('binds preparation and sending to the same oldest active issue', () => {
    expect(sql).toMatch(/ORDER BY approved_at ASC NULLS LAST, created_at ASC, id ASC/is);
    expect(sql).toContain(
      'FUNCTION claim_newsletter_run(p_claim_token text, p_issue_id uuid)',
    );
    expect(sql).toMatch(
      /claim_newsletter_run[\s\S]+WHERE issue\.id = p_issue_id[\s\S]+status IN \('approved', 'sending'\)/i,
    );
  });

  test('keeps one no-issue run per SGT day and preserves rollback compatibility', () => {
    expect(sql).toMatch(/UNIQUE NULLS NOT DISTINCT\s*\(run_date, issue_id\)/i);
    expect(sql).toContain('FUNCTION claim_newsletter_run(p_claim_token text)');
    expect(sql).toMatch(
      /claim_newsletter_run[\s\S]+ORDER BY approved_at ASC NULLS LAST, created_at ASC, id ASC/i,
    );
    expect(sql).toMatch(/claim_newsletter_run[\s\S]+get_newsletter_valuation_gate/i);
  });

  test('requires the server-issued lease for every mutating follow-up RPC', () => {
    expect(sql).toContain(
      'heartbeat_newsletter_valuation_run(p_run_id uuid, p_lease_token uuid)',
    );
    expect(sql).toContain(
      'record_newsletter_valuation_item(p_run_id uuid, p_item_id uuid, p_lease_token uuid, p_outcome jsonb)',
    );
    expect(sql).toContain(
      'complete_newsletter_valuation_run(p_run_id uuid, p_lease_token uuid)',
    );
    expect(sql).toMatch(
      /claim_newsletter_valuation_run[\s\S]+INTERVAL '15 minutes'[\s\S]+lease_token = gen_random_uuid\(\)/i,
    );
  });

  test('normalizes the four outcome shapes and keeps terminal replay immutable', () => {
    const record = functionSql(
      'record_newsletter_valuation_item',
      'complete_newsletter_valuation_run',
    );
    for (const kind of ['accepted', 'rejected', 'blocked', 'failed']) {
      expect(record).toContain(`'${kind}'`);
    }
    expect(record).toMatch(/p_outcome = v_item\.outcome[\s\S]+RETURN jsonb_build_object/i);
    expect(record).toContain('conflicting valuation item replay');
    expect(record).toMatch(
      /address_key[\s\S]+'project:' \|\| v_item\.project_slug[\s\S]+expires_at[\s\S]+INTERVAL '30 days'/i,
    );
  });

  test('blocks candidate-present zero-acceptance completion atomically', () => {
    expect(sql).toMatch(
      /candidate_count > 0[\s\S]+accepted_count = 0[\s\S]+'blocked'/i,
    );
    expect(sql).toMatch(
      /accepted_count > 0[\s\S]+'completed'[\s\S]+failed_count > 0[\s\S]+'failed'/i,
    );
  });

  test('blocks an invalid project profile before considering a run quiet', () => {
    const claim = functionSql(
      'claim_newsletter_valuation_run',
      'heartbeat_newsletter_valuation_run',
    );
    expect(claim).toMatch(
      /IF v_project\.id IS NULL[\s\S]+project valuation profile is incomplete[\s\S]+ELSIF v_candidate_count = 0 OR has_current_newsletter_project_valuation/i,
    );
  });

  test('indexes only current accepted exact-slug cache evidence', () => {
    expect(sql).toMatch(
      /CREATE INDEX idx_propnex_valuations_accepted_project_slug[\s\S]+ON propnex_valuations\s*\(project_slug, expires_at DESC\)[\s\S]+evidence_status = 'accepted'[\s\S]+evidence_contract_version = 'chloe-valuation-v1'[\s\S]+validated_confidence IN \('medium', 'high'\)/i,
    );
    expect(sql).toMatch(
      /project_slug = p_project_slug[\s\S]+evidence_status = 'accepted'[\s\S]+evidence_contract_version = 'chloe-valuation-v1'[\s\S]+validated_confidence IN \('medium', 'high'\)[\s\S]+expires_at > clock_timestamp\(\)/i,
    );
  });

  test('enforces the database-owned current-day gate on both send claim signatures', () => {
    expect(sql).toContain('FUNCTION assert_newsletter_valuation_gate(p_issue_id uuid)');
    expect(sql).toMatch(
      /assert_newsletter_valuation_gate[\s\S]+AT TIME ZONE 'Asia\/Singapore'[\s\S]+status IN \('completed', 'quiet'\)[\s\S]+SQLSTATE '55000'/i,
    );

    const explicitClaim = functionSql(
      'claim_newsletter_run(p_claim_token text, p_issue_id uuid)',
      'claim_newsletter_run(p_claim_token text)',
    );
    const legacyClaim = functionSql('claim_newsletter_run(p_claim_token text)');
    expect(explicitClaim).toContain('assert_newsletter_valuation_gate(v_issue_id)');
    expect(legacyClaim).toContain('assert_newsletter_valuation_gate(v_issue_id)');
  });

  test('never grants direct cache or audit writes to service_role', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON (TABLE )?newsletter_valuation_runs FROM anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON (TABLE )?newsletter_valuation_items FROM anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /REVOKE (ALL|INSERT, UPDATE, DELETE) ON (TABLE )?propnex_valuations FROM anon, authenticated, service_role/i,
    );
    expect(sql).toContain('GRANT SELECT ON TABLE newsletter_valuation_runs TO service_role');
    expect(sql).toContain('GRANT SELECT ON TABLE newsletter_valuation_items TO service_role');
    expect(sql).not.toMatch(
      /GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]+(newsletter_valuation_runs|newsletter_valuation_items|propnex_valuations)\s+TO service_role/i,
    );
  });

  test('grants only public RPC execution and revokes every internal helper', () => {
    for (const signature of [
      'claim_newsletter_valuation_run(TEXT, TEXT)',
      'heartbeat_newsletter_valuation_run(UUID, UUID)',
      'record_newsletter_valuation_item(UUID, UUID, UUID, JSONB)',
      'complete_newsletter_valuation_run(UUID, UUID)',
      'get_newsletter_valuation_gate(UUID)',
      'claim_newsletter_run(TEXT, UUID)',
      'claim_newsletter_run(TEXT)',
    ]) {
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`);
    }

    for (const signature of [
      'resolve_active_newsletter_issue()',
      'assert_newsletter_valuation_gate(UUID)',
      'enforce_newsletter_valuation_item_immutable()',
    ]) {
      expect(sql).toContain(
        `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated, service_role`,
      );
    }
  });
});
