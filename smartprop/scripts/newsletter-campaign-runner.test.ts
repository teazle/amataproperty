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
import { parseCampaignCliArgs } from './run-whatsapp-newsletter-campaign';

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
    failedCount: 0, unknownCount: 0, skippedCount: 0, blocker: null,
  };
  candidates = Array.from({ length: 6 }, (_, index) => candidate(index + 1));
  attempts: NewsletterAttempt[] = [];
  suppressed = new Set<string>();
  finalizeError: Error | null = null;
  testRows: TestSendInput[] = [];

  async resolveIssue(_issueId?: string): Promise<NewsletterIssue> { this.calls.push('resolveIssue'); return issue; }
  async claimToday(_claimToken: string): Promise<CampaignRun> { this.calls.push('claimToday'); return this.run; }
  async listAttempts(): Promise<NewsletterAttempt[]> { this.calls.push('listAttempts'); return this.attempts; }
  async recoverAbandoned(): Promise<number> {
    this.calls.push('recoverAbandoned');
    let recovered = 0;
    this.attempts = this.attempts.map((attempt) => {
      if (attempt.status !== 'sending') return attempt;
      recovered += 1;
      return { ...attempt, status: 'unknown', retryable: false };
    });
    return recovered;
  }
  async selectCandidates(_issue: NewsletterIssue, limit: number): Promise<CampaignCandidate[]> {
    this.calls.push(`selectCandidates:${limit}`);
    return this.candidates.slice(0, limit);
  }
  async selectCandidate(issue: NewsletterIssue, leadId: string): Promise<CampaignCandidate | null> {
    this.calls.push(`selectCandidate:${leadId}`);
    return this.candidates.find((item) => item.id === leadId) || null;
  }
  async startAttempt(
    run: CampaignRun, selected: CampaignCandidate, slotNo: number, body: string,
  ): Promise<NewsletterAttempt | 'suppressed'> {
    this.calls.push(`start:${selected.id}:${slotNo}`);
    if (this.suppressed.has(selected.id)) return 'suppressed';
    const attempt: NewsletterAttempt = {
      id: `send-${selected.id}-${selected.attemptCount + 1}`,
      runId: run.id,
      leadId: selected.id,
      slotNo,
      recipientName: selected.name,
      recipientKey: selected.recipientKey,
      renderedBody: body,
      status: 'sending',
      attemptNo: selected.attemptCount + 1,
      retryable: true,
    };
    this.attempts.push(attempt);
    return attempt;
  }
  async finalizeAttempt(input: FinalizeAttemptInput): Promise<void> {
    this.calls.push(`finalize:${input.attemptId}:${input.result.outcome}`);
    if (this.finalizeError) throw this.finalizeError;
    this.attempts = this.attempts.map((attempt) => attempt.id === input.attemptId
      ? { ...attempt, status: input.result.outcome === 'accepted' ? 'sent' : input.result.outcome === 'rejected' ? 'failed' : 'unknown', retryable: input.result.outcome === 'rejected' && input.result.retryable }
      : attempt);
  }
  async heartbeat(): Promise<void> { this.calls.push('heartbeat'); }
  async queueOperatorReports(): Promise<OperatorReport[]> { this.calls.push('queueReports'); return []; }
  async startReport(): Promise<boolean> { return true; }
  async finalizeReport(): Promise<void> {}
  async finishRun(_runId: string, _blocker: string | null): Promise<CampaignRun> {
    this.calls.push('finishRun');
    return { ...this.run, status: 'completed' };
  }
  async markRecoveryRequired(_runId: string, blocker: string): Promise<void> {
    this.calls.push('markRecoveryRequired');
    this.run = { ...this.run, status: 'failed', blocker };
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
    expect(store.calls).toEqual(['claimToday', 'listAttempts', 'queueReports']);
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
    await runNewsletterCampaign(dependencies(store, {
      transport: async (to: string) => { posts.push(to); return { outcome: 'accepted', messageId: to }; },
    }), options);

    expect(posts).toHaveLength(5);
    expect(store.calls).toContain('start:lead-2:2');
    expect(store.calls).toContain('start:lead-6:5');
    expect(posts).not.toContain(candidate(2).recipientKey);
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
    const selectionIndex = store.calls.findIndex((call) => call.startsWith('selectCandidates:'));
    expect(store.calls.indexOf('recoverAbandoned')).toBeLessThan(selectionIndex);
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
      writeRecoveryRecord: async (record: unknown) => { recoveries.push(record); },
    }), options);

    expect(result.status).toBe('recovery-required');
    expect(posts).toBe(1);
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]).toMatchObject({ attemptId: 'send-lead-1-1', providerMessageId: 'provider-accepted' });
    expect(store.calls).toContain('markRecoveryRequired');

    store.finalizeError = null;
    await runNewsletterCampaign(dependencies(store, {
      transport: async () => { posts += 1; return { outcome: 'accepted', messageId: 'must-not-send' }; },
    }), options);
    expect(posts).toBe(1);
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
