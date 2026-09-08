import { describe, expect, test } from 'bun:test';

import { createCampaignStore } from '../src/lib/newsletter/campaign-store';
import type { NewsletterIssue } from '../src/lib/newsletter/campaign-runner';
import {
  MAX_LEAD_CODE_CLAIM_ATTEMPTS,
  generateLeadCode,
  generatePreviewLeadCode,
} from '../src/lib/newsletter/lead-code';

const issue: NewsletterIssue = {
  id: 'issue-1',
  slug: 'week-37',
  status: 'approved',
  featuredProjects: [],
  audienceProjectSlug: 'cliften',
};

type Row = Record<string, unknown>;

function leadFixture(overrides: Row = {}): Row {
  return {
    id: 'lead-1',
    project_id: 'project-1',
    name: 'Vincent Tan',
    phone: '+65 9100 0001',
    phone_e164: '+6591000001',
    property_title: 'Cliften, Ewe Boon Road',
    lead_code: 'vp1a2b3c',
    priority: 'normal',
    created_at: '2026-07-01T00:00:00Z',
    status: 'new',
    opt_out_at: null,
    ...overrides,
  };
}

function valuationFixture(overrides: Row = {}): Row {
  return {
    id: 'valuation-1',
    project_name: 'Cliften',
    low_sgd: 1_000_000,
    mid_sgd: 1_100_000,
    high_sgd: 1_200_000,
    comparables_count: 3,
    as_of: '2026-07-01',
    expires_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function tablesWith(leadOverrides: Row = {}, valuationOverrides: Row = {}): Record<string, Row[]> {
  return {
    crm_projects: [{ id: 'project-1', slug: 'cliften', title: 'Cliften', is_active: true }],
    crm_leads: [leadFixture(leadOverrides)],
    newsletter_sends: [],
    newsletter_suppressions: [],
    propnex_valuations: [valuationFixture(valuationOverrides)],
  };
}

// Minimal PostgREST-shaped fake: eq/gt/or filters apply to rows, order/range are
// no-ops (fixtures stay under one page), and updates run their matched filters
// against the live table state so rereads observe the mutation.
class FakeQuery implements PromiseLike<{ data: unknown; error: Row | null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private updateValue: Row | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly tableName: string,
  ) {}

  select(_columns?: string) { return this; }
  eq(name: string, value: unknown) {
    this.filters.push((row) => row[name] === value);
    return this;
  }
  gt(name: string, value: unknown) {
    this.filters.push((row) => row[name] > value);
    return this;
  }
  or(predicate: string) {
    const clauses = predicate.split(',');
    this.filters.push((row) => clauses.some((clause) => {
      const name = clause.split('.')[0];
      if (clause.endsWith('.is.null')) return row[name] === null || row[name] === undefined;
      if (clause.endsWith('.eq.""')) return row[name] === '';
      return true;
    }));
    return this;
  }
  order(_name: string, _options?: Row) { return this; }
  range() { return this; }
  limit() { return this; }
  maybeSingle() { return Promise.resolve({ data: this.match()[0] || null, error: null }); }
  single() { return Promise.resolve({ data: this.match()[0] || null, error: null }); }
  update(value: Row) {
    this.updateValue = value;
    this.db.updateCalls.push({ table: this.tableName, value: { ...value } });
    return this;
  }

  private match(): Row[] {
    return this.db.tables[this.tableName].filter((row) => this.filters.every((filter) => filter(row)));
  }

  then<TResult1 = { data: unknown; error: Row | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: Row | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.settle()).then(onfulfilled, onrejected);
  }

  private settle(): { data: unknown; error: Row | null } {
    if (this.updateValue === null) return { data: this.match(), error: null };
    const error = this.db.updateErrors.length > 0 ? this.db.updateErrors.shift() ?? null : null;
    if (error) return { data: null, error };
    const matched = this.match();
    if (matched.length === 0) return { data: [], error: null };
    return { data: matched.map((row) => Object.assign(row, this.updateValue)), error: null };
  }
}

class FakeDb {
  updateErrors: Array<Row | null> = [];
  updateCalls: Array<{ table: string; value: Row }> = [];

  constructor(readonly tables: Record<string, Row[]>) {}

  get client() {
    return { from: (table: string) => new FakeQuery(this, table) };
  }
}

function store(tables: Record<string, Row[]>) {
  const db = new FakeDb(tables);
  return { db, store: createCampaignStore(db.client as never) };
}

const referenceTime = new Date('2026-07-13T00:00:00.000Z');
const leadCodePattern = /^vp[0-9a-f]{6}$/;

describe('missing lead_code selection', () => {
  test('an otherwise eligible imported lead without a lead_code is selected (RED regression)', async () => {
    const { store: campaignStore } = store(tablesWith({ lead_code: null }));

    const candidates = await campaignStore.selectCandidates(issue, 5, referenceTime);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('lead-1');
    expect(candidates[0].leadCode).toBe('');
  });

  test('a lead with an existing code keeps it verbatim through selection', async () => {
    const { store: campaignStore } = store(tablesWith());

    const candidates = await campaignStore.selectCandidates(issue, 5, referenceTime);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].leadCode).toBe('vp1a2b3c');
  });

  test.each([
    ['opted-out lead', { opt_out_at: '2026-07-02T00:00:00Z' }],
    ['lost lead', { status: 'lost' }],
    ['unparseable phone', { phone: 'not-a-phone', phone_e164: null }],
  ])('%s without a code is still excluded', async (_name, overrides) => {
    const { store: campaignStore } = store(tablesWith({ lead_code: null, ...overrides }));

    const candidates = await campaignStore.selectCandidates(issue, 5, referenceTime);

    expect(candidates).toHaveLength(0);
  });

  test('a suppressed recipient without a code is still excluded', async () => {
    const { store: campaignStore } = store({
      ...tablesWith({ lead_code: null }),
      newsletter_suppressions: [{ recipient_key: '+6591000001' }],
    });

    const candidates = await campaignStore.selectCandidates(issue, 5, referenceTime);

    expect(candidates).toHaveLength(0);
  });

  test('a lead at three prior attempts without a code is still excluded', async () => {
    const { store: campaignStore } = store({
      ...tablesWith({ lead_code: null }),
      newsletter_sends: [1, 2, 3].map((number) => ({
        id: `send-${number}`,
        issue_id: 'issue-1',
        is_test: false,
        recipient_key: '+6591000001',
        status: 'failed',
        retryable: false,
        attempt_started_at: `2026-07-0${number}T00:00:00Z`,
      })),
    });

    const candidates = await campaignStore.selectCandidates(issue, 5, referenceTime);

    expect(candidates).toHaveLength(0);
  });

  test('a lead with only an expired valuation is still excluded', async () => {
    const { store: campaignStore } = store(tablesWith({ lead_code: null }, { expires_at: '2026-07-10T00:00:00.000Z' }));

    const candidates = await campaignStore.selectCandidates(issue, 5, referenceTime);

    expect(candidates).toHaveLength(0);
  });
});

describe('ensureLeadCode persistence', () => {
  test('claims and persists a fresh opaque code for a code-less lead', async () => {
    const { db, store: campaignStore } = store(tablesWith({ lead_code: null }));

    const code = await campaignStore.ensureLeadCode('lead-1', '');

    expect(code).toMatch(leadCodePattern);
    const row = db.tables.crm_leads[0];
    expect(row.lead_code).toBe(code);
    expect(typeof row.updated_at).toBe('string');
    expect(db.updateCalls).toHaveLength(1);
    expect(db.updateCalls[0]).toMatchObject({ table: 'crm_leads', value: { lead_code: code } });
  });

  test('a nonempty current code is preserved without any write', async () => {
    const { db, store: campaignStore } = store(tablesWith());

    const code = await campaignStore.ensureLeadCode('lead-1', 'vp1a2b3c');

    expect(code).toBe('vp1a2b3c');
    expect(db.updateCalls).toHaveLength(0);
    expect(db.tables.crm_leads[0].lead_code).toBe('vp1a2b3c');
  });

  test('a concurrent writer that claimed first is adopted, not overwritten', async () => {
    // Another writer set a code after our selection read but before our update:
    // the null-only predicate matches zero rows, so we reread and adopt theirs.
    const { db, store: campaignStore } = store(tablesWith({ lead_code: 'vpwinner' }));

    const code = await campaignStore.ensureLeadCode('lead-1', '');

    expect(code).toBe('vpwinner');
    expect(db.tables.crm_leads[0].lead_code).toBe('vpwinner');
    expect(db.updateCalls).toHaveLength(1);
  });

  test('unique-index collisions retry with fresh codes until one persists', async () => {
    const { db, store: campaignStore } = store(tablesWith({ lead_code: null }));
    db.updateErrors = [
      { code: '23505', message: 'duplicate key value violates unique constraint "uniq_crm_leads_lead_code"' },
      { code: '23505', message: 'duplicate key value violates unique constraint "uniq_crm_leads_lead_code"' },
      { code: '23505', message: 'duplicate key value violates unique constraint "uniq_crm_leads_lead_code"' },
      { code: '23505', message: 'duplicate key value violates unique constraint "uniq_crm_leads_lead_code"' },
    ];

    const code = await campaignStore.ensureLeadCode('lead-1', '');

    expect(code).toMatch(leadCodePattern);
    expect(db.tables.crm_leads[0].lead_code).toBe(code);
    expect(db.updateCalls).toHaveLength(5);
    const generated = db.updateCalls.map((call) => String(call.value.lead_code));
    expect(new Set(generated).size).toBe(generated.length);
  });

  test('persistent collisions stop after a bounded number of attempts', async () => {
    const { db, store: campaignStore } = store(tablesWith({ lead_code: null }));
    db.updateErrors = Array.from({ length: 20 }, () => ({
      code: '23505',
      message: 'duplicate key value violates unique constraint "uniq_crm_leads_lead_code"',
    }));

    await expect(campaignStore.ensureLeadCode('lead-1', '')).rejects.toThrow('exhausted unique-code retries');
    expect(db.updateCalls).toHaveLength(MAX_LEAD_CODE_CLAIM_ATTEMPTS);
  });

  test('a database error that is not a uniqueness collision is surfaced', async () => {
    const { db, store: campaignStore } = store(tablesWith({ lead_code: null }));
    db.updateErrors = [{ code: '42501', message: 'row-level security policy violation' }];

    await expect(campaignStore.ensureLeadCode('lead-1', '')).rejects.toThrow(/claim newsletter lead code/);
    expect(db.updateCalls).toHaveLength(1);
  });
});

describe('lead code generator', () => {
  test('generated codes are opaque, well-formed, and unique', () => {
    const codes = Array.from({ length: 200 }, () => generateLeadCode());
    expect(codes.every((code) => leadCodePattern.test(code))).toBe(true);
    // 24-bit suffix space: sample small enough that a birthday collision is
    // not the expected outcome of a passing generator.
    expect(new Set(codes.slice(0, 32)).size).toBe(32);
  });

  test('preview codes are clearly distinguishable from persisted codes', () => {
    const preview = generatePreviewLeadCode();
    expect(preview).toMatch(/^preview-vp[0-9a-f]{6}$/);
    expect(preview).not.toMatch(leadCodePattern);
  });
});
