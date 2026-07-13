import { describe, expect, test } from 'bun:test';

import {
  CampaignConfigurationError,
  runNewsletterCampaign,
  runNewsletterTestSend,
  type CampaignCandidate,
  type CampaignRun,
  type NewsletterAttempt,
  type NewsletterIssue,
} from '../src/lib/newsletter/campaign-runner';
import type {
  CampaignStore,
  FinalizeAttemptInput,
  OperatorReport,
  TestSendInput,
} from '../src/lib/newsletter/campaign-store';
import type { CampaignTransportResult } from '../src/lib/newsletter/campaign-types';
import { createCampaignStore } from '../src/lib/newsletter/campaign-store';
import {
  createProcessClaimToken,
  exitCodeForError,
  exitCodeForResult,
  parseCampaignCliArgs,
} from './run-whatsapp-newsletter-campaign';

const issue: NewsletterIssue = {
  id: 'issue-1',
  slug: 'week-28',
  status: 'approved',
  featuredProjects: [{ title: 'Upperhouse' }],
};

function candidate(number: number, attemptCount = 0): CampaignCandidate {
  return {
    id: `lead-${number}`,
    name: `Lead ${number}`,
    recipientKey: `+65910000${String(number).padStart(2, '0')}`,
    propertyTitle: 'Cliften, Ewe Boon Road',
    leadCode: `code-${number}`,
    priority: 'normal',
    createdAt: `2026-07-${String(number).padStart(2, '0')}T00:00:00Z`,
    attemptCount,
    valuation: {
      basis: 'project-level',
      lowSgd: 1_000_000,
      midSgd: 1_100_000,
      highSgd: 1_200_000,
      comparablesCount: 3,
      asOf: '2026-07-12',
    },
  };
}

class FakeStore implements CampaignStore {
  calls: string[] = [];
  run: CampaignRun = {
    id: 'run-1', runDate: '2026-07-13', issueId: issue.id, issueSlug: issue.slug,
    status: 'running', selectedCount: 0, attemptedCount: 0, sentCount: 0,
    failedCount: 0, unknownCount: 0, skippedCount: 0, blocker: null, reportError: null,
  };
  candidates = Array.from({ length: 6 }, (_, index) => candidate(index + 1));
  attempts: NewsletterAttempt[] = [];
  suppressed = new Set<string>();
  finalizeError: Error | null = null;
  recoveryError: Error | null = null;
  testRows: TestSendInput[] = [];
  reports: OperatorReport[] = [];
  referenceTimes: Array<Date | undefined> = [];

  async resolveIssue(_issueId?: string): Promise<NewsletterIssue> { this.calls.push('resolveIssue'); return issue; }
  async claimToday(_claimToken: string): Promise<CampaignRun> { this.calls.push('claimToday'); return this.run; }
  async listAttempts(): Promise<NewsletterAttempt[]> { this.calls.push('listAttempts'); return this.attempts; }
  async recoverAbandoned(_runId: string, olderThan: Date): Promise<number> {
    this.calls.push(`recoverAbandoned:${olderThan.toISOString()}`);
    let recovered = 0;
    this.attempts = this.attempts.map((attempt) => {
      if (attempt.status !== 'sending') return attempt;
      recovered += 1;
      return { ...attempt, status: 'unknown', retryable: false };
    });
    return recovered;
  }
  async recoverStaleReports(_runId: string, olderThan: Date): Promise<number> {
    this.calls.push(`recoverStaleReports:${olderThan.toISOString()}`);
    return 0;
  }
  async selectCandidates(_issue: NewsletterIssue, limit: number, referenceTime?: Date): Promise<CampaignCandidate[]> {
    this.calls.push(`selectCandidates:${limit}`);
    this.referenceTimes.push(referenceTime);
    return this.candidates.slice(0, limit);
  }
  async selectCandidate(issue: NewsletterIssue, leadId: string): Promise<CampaignCandidate | null> {
    this.calls.push(`selectCandidate:${leadId}`);
    return this.candidates.find((item) => item.id === leadId) || null;
  }
  async queueAttempt(
    run: CampaignRun, selected: CampaignCandidate, _claimToken: string, body: string,
  ): Promise<NewsletterAttempt | 'suppressed'> {
    this.calls.push(`queue:${selected.id}`);
    const attempt: NewsletterAttempt = {
      id: `send-${selected.id}-${selected.attemptCount + 1}`,
      runId: run.id,
      leadId: selected.id,
      slotNo: null,
      recipientName: selected.name,
      recipientKey: selected.recipientKey,
      renderedBody: body,
      status: 'queued',
      attemptNo: null,
      retryable: true,
    };
    this.attempts.push(attempt);
    return attempt;
  }
  async startAttempt(
    attempt: NewsletterAttempt, _run: CampaignRun, slotNo: number, _claimToken: string,
  ): Promise<NewsletterAttempt | 'suppressed'> {
    this.calls.push(`start:${attempt.leadId}:${slotNo}`);
    if (attempt.leadId && this.suppressed.has(attempt.leadId)) {
      this.attempts = this.attempts.map((item) => item.id === attempt.id ? { ...item, status: 'opted_out' } : item);
      return 'suppressed';
    }
    const started = { ...attempt, slotNo, status: 'sending' as const, attemptNo: 1 };
    this.attempts = this.attempts.map((item) => item.id === attempt.id ? started : item);
    return started;
  }
  async finalizeAttempt(input: FinalizeAttemptInput): Promise<void> {
    this.calls.push(`finalize:${input.attemptId}:${input.result.outcome}`);
    if (this.finalizeError) throw this.finalizeError;
    this.attempts = this.attempts.map((attempt) => attempt.id === input.attemptId
      ? { ...attempt, status: input.result.outcome === 'accepted' ? 'sent' : input.result.outcome === 'rejected' ? 'failed' : 'unknown', retryable: input.result.outcome === 'rejected' && input.result.retryable }
      : attempt);
  }
  async heartbeat(): Promise<void> { this.calls.push('heartbeat'); }
  async queueOperatorReports(): Promise<OperatorReport[]> { this.calls.push('queueReports'); return this.reports; }
  async startReport(): Promise<boolean> { return true; }
  async finalizeReport(id: string, result: CampaignTransportResult): Promise<void> {
    this.calls.push(`finalizeReport:${id}:${result.outcome}`);
  }
  async finishRun(_runId: string, _blocker: string | null): Promise<CampaignRun> {
    this.calls.push('finishRun');
    return { ...this.run, status: 'completed' };
  }
  async markRecoveryRequired(_runId: string, blocker: string): Promise<void> {
    this.calls.push('markRecoveryRequired');
    this.run = { ...this.run, status: 'failed', blocker };
  }
  async recordAcceptedRecovery(_attemptId: string, _messageId: string, _error: string): Promise<void> {
    this.calls.push('recordAcceptedRecovery');
    if (this.recoveryError) throw this.recoveryError;
    this.run = { ...this.run, status: 'failed', blocker: 'accepted send requires CRM finalization recovery' };
  }
  async createTestSend(input: TestSendInput): Promise<string> {
    this.calls.push('createTestSend'); this.testRows.push(input); return 'test-row-1';
  }
  async finalizeTestSend(): Promise<void> { this.calls.push('finalizeTestSend'); }
  async resolveUnknown(): Promise<void> { this.calls.push('resolveUnknown'); }
}

function accepted(): Promise<CampaignTransportResult> {
  return Promise.resolve({ outcome: 'accepted', messageId: 'provider-1' });
}

function dependencies(store: FakeStore, overrides: Record<string, unknown> = {}) {
  return {
    store,
    preflight: async () => ({ ready: true as const }),
    transport: accepted,
    sleep: async () => {},
    writeRecoveryRecord: async () => {},
    now: () => new Date('2026-07-13T04:00:00.000Z'),
    ...overrides,
  };
}

const options = { enabled: true, operatorRecipients: ['+6591051399'] };

describe('runNewsletterCampaign', () => {
  test('preflight blocker is recoverable and performs no database or provider work', async () => {
    const store = new FakeStore();
    let posts = 0;
    const result = await runNewsletterCampaign(dependencies(store, {
      preflight: async () => ({ ready: false as const, error: 'SCAN_QR_CODE' }),
      transport: async () => { posts += 1; return { outcome: 'accepted', messageId: 'x' }; },
    }), options);

    expect(result.status).toBe('blocked');
    expect(result.recoverable).toBe(true);
    expect(store.calls).toEqual([]);
    expect(posts).toBe(0);
  });

  test('six eligible leads start exactly five provider submissions in slots 1 through 5', async () => {
    const store = new FakeStore();
    const posts: string[] = [];
    const sleeps: number[] = [];
    const result = await runNewsletterCampaign(dependencies(store, {
      transport: async (to: string) => { posts.push(to); return { outcome: 'accepted', messageId: `p-${posts.length}` }; },
      sleep: async (milliseconds: number) => { sleeps.push(milliseconds); },
    }), options);

    expect(result.status).toBe('completed');
    expect(posts).toHaveLength(5);
    expect(store.calls.slice(0, store.calls.indexOf('start:lead-1:1'))).toEqual(expect.arrayContaining([
      'queue:lead-1', 'queue:lead-2', 'queue:lead-3', 'queue:lead-4', 'queue:lead-5',
    ]));
    expect(store.calls.filter((call) => call.startsWith('start:'))).toEqual([
      'start:lead-1:1', 'start:lead-2:2', 'start:lead-3:3', 'start:lead-4:4', 'start:lead-5:5',
    ]);
    expect(sleeps).toEqual([60_000, 60_000, 60_000, 60_000]);
  });

  test('a completed same-day invocation resumes reports without selecting again', async () => {
    const store = new FakeStore();
    store.run.status = 'completed';
    const result = await runNewsletterCampaign(dependencies(store), options);

    expect(result.status).toBe('completed');
    expect(store.calls).toEqual([
      'claimToday', 'listAttempts', 'recoverStaleReports:2026-07-13T03:55:00.000Z', 'queueReports',
    ]);
  });

  test.each(['completed', 'running'] as const)(
    '%s rerun with persisted report_error returns recovery-required without report resend',
    async (status) => {
      const store = new FakeStore();
      store.run = { ...store.run, status, reportError: 'operator report outcome unknown' };
      const result = await runNewsletterCampaign(dependencies(store), options);
      expect(result.status).toBe('recovery-required');
      expect(result.blocker).toBe('operator report outcome unknown');
      expect(store.calls).not.toContain('queueReports');
    },
  );

  test('stale sending report recovery returns recovery-required without resend', async () => {
    const store = new FakeStore();
    store.run.status = 'completed';
    store.recoverStaleReports = async (_runId: string, olderThan: Date) => {
      store.calls.push(`recoverStaleReports:${olderThan.toISOString()}`);
      return 1;
    };
    const result = await runNewsletterCampaign(dependencies(store), options);
    expect(result.status).toBe('recovery-required');
    expect(store.calls).not.toContain('queueReports');
  });

  test('a running same-day invocation resumes the persisted queued batch without reselection', async () => {
    const store = new FakeStore();
    store.attempts = [1, 2].map((number) => ({
      id: `queued-${number}`, runId: 'run-1', leadId: `original-${number}`, slotNo: null,
      recipientName: `Original ${number}`, recipientKey: `+659200000${number}`,
      renderedBody: `persisted-${number}`, status: 'queued' as const, attemptNo: null, retryable: true,
    }));
    store.candidates = [candidate(5), candidate(6)];
    const bodies: string[] = [];

    await runNewsletterCampaign(dependencies(store, {
      transport: async (_to: string, body: string) => { bodies.push(body); return { outcome: 'accepted', messageId: body }; },
    }), options);

    expect(store.calls.some((call) => call.startsWith('selectCandidates:'))).toBe(false);
    expect(bodies).toEqual(['persisted-1', 'persisted-2']);
  });

  test('a definite failed attempt consumes its slot without a same-day replacement', async () => {
    const store = new FakeStore();
    let calls = 0;
    await runNewsletterCampaign(dependencies(store, {
      transport: async () => {
        calls += 1;
        return calls === 1
          ? { outcome: 'rejected', retryable: true, error: '503', statusCode: 503 }
          : { outcome: 'accepted', messageId: `p-${calls}` };
      },
    }), options);

    expect(calls).toBe(5);
    expect(store.calls.some((call) => call === 'start:lead-6:5')).toBe(false);
  });

  test('a STOP suppression before POST reuses the unused slot for one replacement', async () => {
    const store = new FakeStore();
    store.suppressed.add('lead-2');
    const posts: string[] = [];
    const result = await runNewsletterCampaign(dependencies(store, {
      transport: async (to: string) => { posts.push(to); return { outcome: 'accepted', messageId: to }; },
    }), options);

    expect(posts).toHaveLength(5);
    expect(store.attempts).toHaveLength(6);
    expect(result.selectedCount).toBe(5);
    expect(result.attemptedCount).toBe(5);
    expect(store.calls).toContain('start:lead-2:2');
    expect(store.calls).toContain('start:lead-6:5');
    expect(posts).not.toContain(candidate(2).recipientKey);
  });

  test('an opt-out RPC cancelled queued row releases capacity for exactly one replacement', async () => {
    const store = new FakeStore();
    store.run.selectedCount = 5;
    store.attempts = [1, 2, 3, 4].map((number) => ({
      id: `queued-${number}`, runId: 'run-1', leadId: `lead-${number}`, slotNo: null,
      recipientName: `Lead ${number}`, recipientKey: candidate(number).recipientKey,
      renderedBody: `body-${number}`, status: 'queued' as const, attemptNo: null, retryable: true,
    }));
    store.attempts.push({
      id: 'stopped', runId: 'run-1', leadId: 'lead-5', slotNo: null,
      recipientName: 'Lead 5', recipientKey: candidate(5).recipientKey,
      renderedBody: 'stopped', status: 'opted_out', attemptNo: null, retryable: false,
    });
    const posts: string[] = [];
    await runNewsletterCampaign(dependencies(store, {
      transport: async (to: string) => { posts.push(to); return { outcome: 'accepted', messageId: to }; },
    }), options);
    expect(posts).toHaveLength(5);
    expect(store.calls.filter((call) => call === 'queue:lead-6')).toHaveLength(1);
  });

  test('unknown outcomes are persisted non-retryable and never retried', async () => {
    const store = new FakeStore();
    let posts = 0;
    await runNewsletterCampaign(dependencies(store, {
      transport: async () => { posts += 1; return { outcome: 'unknown', error: 'timeout' }; },
    }), options);
    expect(store.attempts.every((attempt) => attempt.status === 'unknown' && !attempt.retryable)).toBe(true);

    store.run.status = 'completed';
    await runNewsletterCampaign(dependencies(store, { transport: async () => { posts += 1; return accepted(); } }), options);
    expect(posts).toBe(5);
  });

  test('abandoned sending attempts recover as unknown before selection', async () => {
    const store = new FakeStore();
    store.attempts = [{
      id: 'abandoned', runId: 'run-1', leadId: 'lead-old', slotNo: 1,
      recipientName: 'Old', recipientKey: '+6591111111', renderedBody: 'old',
      status: 'sending', attemptNo: 1, retryable: true,
    }];
    await runNewsletterCampaign(dependencies(store), options);

    expect(store.attempts.find((attempt) => attempt.id === 'abandoned')?.status).toBe('unknown');
    expect(store.calls.some((call) => call.startsWith('selectCandidates:'))).toBe(false);
    expect(store.calls).toContain('recoverAbandoned:2026-07-13T03:45:00.000Z');
  });

  test('retryable failure can retry on a later day but candidates at three attempts are excluded', async () => {
    const store = new FakeStore();
    store.candidates = [candidate(1, 2), candidate(2, 3)];
    await runNewsletterCampaign(dependencies(store), options);

    expect(store.calls).toContain('start:lead-1:1');
    expect(store.calls.some((call) => call.startsWith('start:lead-2:'))).toBe(false);
  });

  test('accepted provider send with CRM finalization failure writes recovery and stops', async () => {
    const store = new FakeStore();
    store.finalizeError = new Error('CRM transaction failed');
    const recoveries: unknown[] = [];
    let posts = 0;

    const result = await runNewsletterCampaign(dependencies(store, {
      transport: async () => { posts += 1; return { outcome: 'accepted', messageId: 'provider-accepted' }; },
      writeRecoveryRecord: async (record: unknown) => { store.calls.push('writeRecoveryRecord'); recoveries.push(record); },
    }), options);

    expect(result.status).toBe('recovery-required');
    expect(posts).toBe(1);
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]).toMatchObject({ attemptId: 'send-lead-1-1', providerMessageId: 'provider-accepted' });
    expect(store.calls.indexOf('recordAcceptedRecovery')).toBeLessThan(store.calls.indexOf('writeRecoveryRecord'));

    store.finalizeError = null;
    await runNewsletterCampaign(dependencies(store, {
      transport: async () => { posts += 1; return { outcome: 'accepted', messageId: 'must-not-send' }; },
    }), options);
    expect(posts).toBe(1);
  });

  test('database accepted recovery survives filesystem recovery write failure and stops', async () => {
    const store = new FakeStore();
    store.finalizeError = new Error('CRM transaction failed');
    let posts = 0;
    const result = await runNewsletterCampaign(dependencies(store, {
      transport: async () => { posts += 1; return { outcome: 'accepted', messageId: 'provider-accepted' }; },
      writeRecoveryRecord: async () => { store.calls.push('writeRecoveryRecord'); throw new Error('disk full'); },
    }), options);

    expect(result.status).toBe('recovery-required');
    expect(posts).toBe(1);
    expect(store.calls).toContain('recordAcceptedRecovery');
  });

  test('operator report unknown records recovery-required and is not resent automatically', async () => {
    const store = new FakeStore();
    store.run.status = 'completed';
    store.reports = [{ id: 'report-1', operatorKey: '+6591051399', body: 'summary', status: 'queued' }];
    const result = await runNewsletterCampaign(dependencies(store, {
      transport: async () => ({ outcome: 'unknown', error: 'timeout' }),
    }), options);

    expect(result.status).toBe('recovery-required');
    expect(store.calls).toContain('finalizeReport:report-1:unknown');
  });

  test('zero-attempt completed run still sends its summary report', async () => {
    const store = new FakeStore();
    store.candidates = [];
    store.reports = [{ id: 'summary', operatorKey: '+6591051399', body: 'zero summary', status: 'queued' }];
    const sent: string[] = [];
    await runNewsletterCampaign(dependencies(store, {
      transport: async (_to: string, body: string) => { sent.push(body); return { outcome: 'accepted', messageId: 'summary-id' }; },
    }), options);
    expect(sent).toEqual(['zero summary']);
  });

  test('production date override is rejected before DB or provider operations', async () => {
    const store = new FakeStore();
    await expect(runNewsletterCampaign(dependencies(store), { ...options, date: '2026-07-12' }))
      .rejects.toBeInstanceOf(CampaignConfigurationError);
    expect(store.calls).toEqual([]);
  });

  test('dry-run performs no writes or sends', async () => {
    const store = new FakeStore();
    let posts = 0;
    const result = await runNewsletterCampaign(dependencies(store, {
      transport: async () => { posts += 1; return { outcome: 'accepted', messageId: 'x' }; },
    }), { ...options, dryRun: true, date: '2026-07-12' });

    expect(result.status).toBe('dry-run');
    expect(result.selectedCount).toBe(5);
    expect(posts).toBe(0);
    expect(store.calls).toEqual(['resolveIssue', 'selectCandidates:5']);
    expect(store.referenceTimes[0]?.toISOString()).toBe('2026-07-11T16:00:00.000Z');
  });

  test('rejects impossible dry-run calendar dates before store access', async () => {
    const store = new FakeStore();
    await expect(runNewsletterCampaign(dependencies(store), {
      ...options, dryRun: true, date: '2026-02-30',
    })).rejects.toBeInstanceOf(CampaignConfigurationError);
    expect(store.calls).toEqual([]);
  });

  test('invalid operator configuration is classified as CampaignConfigurationError', async () => {
    const store = new FakeStore();
    await expect(runNewsletterCampaign(dependencies(store), {
      enabled: true, operatorRecipients: [],
    })).rejects.toBeInstanceOf(CampaignConfigurationError);
  });
});

class RecordingQuery implements PromiseLike<{ data: unknown[] | null; error: null }> {
  constructor(
    private readonly table: string,
    private readonly calls: string[],
    private readonly rows: Record<string, unknown>[] = [],
    private readonly updates: Array<{ table: string; value: Record<string, unknown> }> = [],
  ) {}
  private record(name: string, value?: unknown) { this.calls.push(`${this.table}.${name}${value === undefined ? '' : `:${String(value)}`}`); return this; }
  select() { return this.record('select'); }
  eq(name: string, value: unknown) { return this.record('eq', `${name}=${String(value)}`); }
  in(name: string, value: unknown[]) { return this.record('in', `${name}=${value.join(',')}`); }
  gt(name: string, value: unknown) { return this.record('gt', `${name}=${String(value)}`); }
  lt(name: string, value: unknown) { return this.record('lt', `${name}=${String(value)}`); }
  order(name: string) { return this.record('order', name); }
  range(from: number, to: number) { return this.record('range', `${from}-${to}`); }
  limit(value: number) { return this.record('limit', value); }
  update(value: Record<string, unknown>) { this.updates.push({ table: this.table, value }); return this.record('update'); }
  insert() { return this.record('insert'); }
  maybeSingle() { return Promise.resolve({ data: this.rows[0] || null, error: null }); }
  single() { return Promise.resolve({ data: this.rows[0] || null, error: null }); }
  then<TResult1 = { data: unknown[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

function recordingClient(tableRows: Record<string, Record<string, unknown>[]> = {}) {
  const calls: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; value: Record<string, unknown> }> = [];
  return {
    calls,
    rpcCalls,
    updates,
    client: {
      from(table: string) { return new RecordingQuery(table, calls, tableRows[table] || [], updates); },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        return { data: tableRows[`rpc:${name}`]?.[0] || null, error: null };
      },
    },
  };
}

describe('campaign store RPC adapter', () => {
  const queuedRow = {
    id: 'send-1', run_id: 'run-1', lead_id: 'lead-1', slot_no: null,
    recipient_name: 'Lead 1', recipient_key: '+6591000001', phone: '+6591000001',
    rendered_body: 'body', status: 'queued', attempt_no: null, retryable: true,
  };

  test('uses exact queue/start/recovery and secured test-send RPC argument names', async () => {
    const recording = recordingClient({
      'rpc:queue_newsletter_attempt': [queuedRow],
      'rpc:start_newsletter_attempt': [{ ...queuedRow, status: 'sending', slot_no: 1, attempt_no: 1 }],
      'rpc:create_newsletter_test_send': [{ id: 'test-1' }],
    });
    const store = createCampaignStore(recording.client as never);
    const run = new FakeStore().run;
    const selected = candidate(1);
    const queued = await store.queueAttempt(run, selected, 'claim-1', 'body');
    await store.startAttempt(queued as NewsletterAttempt, run, 1, 'claim-1');
    await store.recordAcceptedRecovery('send-1', 'provider-1', 'crm failed');
    const testId = await store.createTestSend({
      issueId: 'issue-1', sourceLeadId: 'lead-1', sourcePhone: '+6591000001',
      overridePhone: '+6591051399', recipientName: 'Lead 1', renderedBody: 'body',
      valuation: selected.valuation, isTest: true,
    });
    await store.finalizeTestSend(testId, { outcome: 'accepted', messageId: 'test-provider' });

    expect(recording.rpcCalls).toEqual(expect.arrayContaining([
      { name: 'queue_newsletter_attempt', args: { p_run_id: 'run-1', p_lead_id: 'lead-1', p_claim_token: 'claim-1', p_rendered_body: 'body', p_valuation_snapshot: selected.valuation } },
      { name: 'start_newsletter_attempt', args: { p_send_id: 'send-1', p_slot_no: 1, p_claim_token: 'claim-1' } },
      { name: 'record_accepted_newsletter_recovery', args: { p_send_id: 'send-1', p_provider_message_id: 'provider-1', p_error: 'crm failed' } },
      { name: 'create_newsletter_test_send', args: { p_issue_id: 'issue-1', p_lead_id: 'lead-1', p_override_phone: '+6591051399', p_rendered_body: 'body', p_valuation_snapshot: selected.valuation } },
      { name: 'finalize_newsletter_test_send', args: { p_send_id: 'test-1', p_provider_outcome: 'sent', p_provider_message_id: 'test-provider', p_error: null, p_retryable: false } },
    ]));
  });

  test('classifies an explicit opted_out start row as suppressed without message matching', async () => {
    const recording = recordingClient({
      'rpc:start_newsletter_attempt': [{ ...queuedRow, status: 'opted_out', retryable: false }],
    });
    const store = createCampaignStore(recording.client as never);
    const outcome = await store.startAttempt(
      { ...queuedRow, slotNo: null, runId: 'run-1', leadId: 'lead-1', recipientName: 'Lead 1', recipientKey: '+6591000001', renderedBody: 'body', status: 'queued', attemptNo: null, retryable: true } as NewsletterAttempt,
      new FakeStore().run,
      1,
      'claim-1',
    );
    expect(outcome).toBe('suppressed');
  });

  test('orders every paginated query before range and uses dry-run reference time', async () => {
    const recording = recordingClient({
      crm_projects: [{ id: 'project-1', title: 'Cliften' }],
      crm_leads: [], newsletter_sends: [], newsletter_suppressions: [], propnex_valuations: [],
    });
    const store = createCampaignStore(recording.client as never);
    await store.selectCandidates({ ...issue, audienceProjectSlug: 'cliften' }, 5, new Date('2026-07-12T00:00:00Z'));
    expect(recording.calls.filter((call) => call.startsWith('newsletter_sends.order:'))).toEqual([
      'newsletter_sends.order:recipient_key',
      'newsletter_sends.order:attempt_started_at',
      'newsletter_sends.order:id',
    ]);
    expect(recording.calls.filter((call) => call.startsWith('crm_leads.order:'))).toEqual([
      'crm_leads.order:created_at',
      'crm_leads.order:id',
    ]);
    expect(recording.calls.filter((call) => call.startsWith('newsletter_suppressions.order:'))).toEqual([
      'newsletter_suppressions.order:recipient_key',
    ]);
    expect(recording.calls.filter((call) => call.startsWith('propnex_valuations.order:'))).toEqual([
      'propnex_valuations.order:project_name',
      'propnex_valuations.order:expires_at',
      'propnex_valuations.order:id',
    ]);
    expect(recording.calls).toContain('propnex_valuations.gt:expires_at=2026-07-12T00:00:00.000Z');
  });

  test('recovers only sending attempts older than the supplied cutoff', async () => {
    const recording = recordingClient({ newsletter_sends: [] });
    const store = createCampaignStore(recording.client as never);
    await store.recoverAbandoned('run-1', new Date('2026-07-13T03:45:00Z'));
    expect(recording.calls).toContain('newsletter_sends.lt:attempt_started_at=2026-07-13T03:45:00.000Z');
  });

  test('finalizes operator reports through the secured atomic RPC', async () => {
    const recording = recordingClient({
      'rpc:finalize_newsletter_operator_report': [{ id: 'report-1', status: 'unknown' }],
    });
    const store = createCampaignStore(recording.client as never);
    await store.finalizeReport('report-1', { outcome: 'unknown', error: 'report timeout' });
    expect(recording.rpcCalls).toContainEqual({
      name: 'finalize_newsletter_operator_report',
      args: {
        p_report_id: 'report-1',
        p_provider_outcome: 'unknown',
        p_provider_message_id: null,
        p_error: 'report timeout',
      },
    });
    expect(recording.calls).not.toContain('newsletter_operator_reports.update');
    expect(recording.calls).not.toContain('newsletter_runs.update');
  });

  test('finishRun excludes cancelled unused audit rows from selected_count', async () => {
    const rows = [1, 2, 3, 4, 5].map((slot) => ({
      ...queuedRow,
      id: `send-${slot}`,
      slot_no: slot,
      status: 'sent',
      attempt_no: 1,
    }));
    rows.push({ ...queuedRow, id: 'stopped', status: 'opted_out', retryable: false } as typeof queuedRow);
    const recording = recordingClient({
      newsletter_sends: rows,
      newsletter_runs: [{
        id: 'run-1', run_date: '2026-07-13', issue_id: 'issue-1', status: 'completed',
        selected_count: 5, attempted_count: 5, sent_count: 5, failed_count: 0,
        unknown_count: 0, skipped_count: 1, blocker: null, report_error: null,
      }],
    });
    const store = createCampaignStore(recording.client as never);
    await store.finishRun('run-1', null);
    expect(recording.updates.find((entry) => entry.table === 'newsletter_runs')?.value).toMatchObject({
      selected_count: 5,
      attempted_count: 5,
      skipped_count: 1,
    });
  });

  test('uses the secured atomic stale-report recovery RPC', async () => {
    const recording = recordingClient({ 'rpc:recover_stale_newsletter_operator_reports': [{ count: 1 }] });
    const store = createCampaignStore(recording.client as never);
    const count = await store.recoverStaleReports('run-1', new Date('2026-07-13T03:55:00Z'));
    expect(count).toBe(1);
    expect(recording.rpcCalls).toContainEqual({
      name: 'recover_stale_newsletter_operator_reports',
      args: { p_run_id: 'run-1', p_before: '2026-07-13T03:55:00.000Z' },
    });
  });
});

describe('runNewsletterTestSend', () => {
  test('uses only configured override, creates a test ledger row, and never claims a real slot', async () => {
    const store = new FakeStore();
    const destinations: string[] = [];
    const result = await runNewsletterTestSend(dependencies(store, {
      transport: async (to: string) => { destinations.push(to); return { outcome: 'accepted', messageId: 'test-provider' }; },
    }), {
      destination: '+6591051399',
      configuredDestination: '+65 9105 1399',
      sourceLeadId: 'lead-6',
    });

    expect(result.outcome).toBe('accepted');
    expect(destinations).toEqual(['+6591051399']);
    expect(store.testRows[0]).toMatchObject({ sourceLeadId: 'lead-6', overridePhone: '+6591051399', isTest: true });
    expect(store.calls).not.toContain('claimToday');
    expect(store.calls.some((call) => call.startsWith('start:'))).toBe(false);
  });
});

describe('campaign CLI parsing', () => {
  test('generates a fresh cryptographically random claim token per invocation', () => {
    const first = createProcessClaimToken();
    const second = createProcessClaimToken();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('maps configuration errors to 20 and report recovery to 30', () => {
    expect(exitCodeForError(new CampaignConfigurationError('bad operators'))).toBe(20);
    expect(exitCodeForResult({
      status: 'recovery-required', recoverable: false, blocker: 'report timeout',
      selectedCount: 0, attemptedCount: 0, acceptedCount: 0, rejectedCount: 0,
      unknownCount: 0, skippedCount: 0,
    })).toBe(30);
  });

  test('rejects a production date before runtime dependencies are created', () => {
    expect(() => parseCampaignCliArgs(['--date', '2026-07-12'])).toThrow('Production --date is forbidden');
  });

  test('accepts date only for dry-run and parses local recovery commands', () => {
    expect(parseCampaignCliArgs(['--dry-run', '--date', '2026-07-12', '--json'])).toEqual({
      command: 'run', dryRun: true, date: '2026-07-12', json: true,
    });
    expect(parseCampaignCliArgs([
      'resolve-unknown', '--send-id', 'send-1', '--resolver', 'vincent',
      '--resolution', 'failed', '--reason', 'provider dashboard evidence',
    ])).toEqual({
      command: 'resolve-unknown', sendId: 'send-1', resolver: 'vincent',
      resolution: 'failed', reason: 'provider dashboard evidence', json: false,
    });
  });
});
