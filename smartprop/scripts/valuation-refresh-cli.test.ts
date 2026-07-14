import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type {
  RecordedValuationOutcome,
  ValuationQueue,
  ValuationStore,
} from '../src/lib/newsletter/valuation-store';
import { createValuationStore } from '../src/lib/newsletter/valuation-store';
import { writeValuationLocalStatus } from '../src/lib/newsletter/valuation-local-status';
import {
  ValuationCliError,
  parseValuationCliArgs,
  runValuationCli,
  type ValuationCliDependencies,
} from './run-chloe-valuation-refresh';

const runId = '00000000-0000-4000-8000-000000000001';
const itemId = '10000000-0000-4000-8000-000000000001';
const leaseToken = '20000000-0000-4000-8000-000000000001';

const queue: ValuationQueue = {
  runId,
  leaseToken,
  issueId: '30000000-0000-4000-8000-000000000001',
  issueSlug: 'week-29',
  runDate: '2026-07-14',
  status: 'running',
  deadlineSgt: '09:20',
  blocker: null,
  candidates: [{
    itemId,
    projectSlug: 'cliften',
    projectTitle: 'The Cliften',
    location: 'Pasir Panjang, Singapore',
    propertyType: 'Condominium',
    tenure: 'Freehold',
    areaDistribution: [{ areaSqft: 1000, count: 2 }],
    candidateCount: 5,
    reason: 'missing',
  }],
};

class FakeStore implements ValuationStore {
  calls: Array<{ name: string; args: unknown[] }> = [];
  queueResult: ValuationQueue & Record<string, unknown> = queue;
  fail = false;

  private maybeFail(): void {
    if (this.fail) throw new Error('postgresql://user:secret@db.example/private');
  }

  async claimQueue(): Promise<ValuationQueue> {
    this.maybeFail();
    this.calls.push({ name: 'claimQueue', args: [] });
    return this.queueResult;
  }
  async heartbeat(id: string, lease: string) {
    this.maybeFail();
    this.calls.push({ name: 'heartbeat', args: [id, lease] });
    return { runId: id, status: 'running' as const, leaseToken: lease } as never;
  }
  async importItem(id: string, item: string, lease: string, outcome: RecordedValuationOutcome) {
    this.maybeFail();
    this.calls.push({ name: 'importItem', args: [id, item, lease, outcome] });
    return { runId: id, itemId: item, status: outcome.kind, leaseToken: lease } as never;
  }
  async complete(id: string, lease: string) {
    this.maybeFail();
    this.calls.push({ name: 'complete', args: [id, lease] });
    return { runId: id, status: 'completed' as const, leaseToken: lease } as never;
  }
  async loadGate(issueId: string) {
    this.calls.push({ name: 'loadGate', args: [issueId] });
    return { healthy: true, issueId, status: 'completed' as const } as never;
  }
  async setProjectProfile(projectSlug: string, profile: never) {
    this.calls.push({ name: 'setProjectProfile', args: [projectSlug, profile] });
  }
}

function validEvidence(): string {
  return JSON.stringify({
    kind: 'evidence',
    evidence: {
      projectSlug: 'cliften',
      projectTitle: 'The Cliften',
      propertyType: 'Condominium',
      location: 'Pasir Panjang, Singapore',
      lowSgd: 1_500_000,
      midSgd: 1_600_000,
      highSgd: 1_700_000,
      psfLow: 1500,
      psfHigh: 1700,
      areaSqft: 1000,
      comparablesCount: 4,
      confidence: 'high',
      basis: 'Four recent project transactions support the indicative range.',
      asOf: '2026-07-14',
      acquisitionMethod: 'ura',
      sources: [
        {
          url: 'https://eservice.ura.gov.sg/property-market-information/example',
          evidenceDate: '2026-06-30', evidenceType: 'transaction',
          detail: 'Four registered project transactions support the range.',
          contentHash: 'a'.repeat(64),
        },
        {
          url: 'https://nexthome.sg/?ac=pc&pc=259342',
          evidenceDate: '2026-07-10', evidenceType: 'market-analysis',
          detail: 'Project page corroborates the range and freehold tenure.',
          contentHash: 'b'.repeat(64),
        },
      ],
    },
  });
}

function dependencies(store = new FakeStore()): ValuationCliDependencies & { store: FakeStore; statuses: unknown[] } {
  const statuses: unknown[] = [];
  return {
    store,
    statuses,
    now: () => new Date('2026-07-14T01:00:00.000Z'),
    readStdin: async () => validEvidence(),
    readFile: async () => '{}',
    loadEvidenceContext: async () => ({
      projectSlug: 'cliften', projectTitle: 'The Cliften',
      location: 'Pasir Panjang, Singapore', propertyType: 'Condominium', tenure: 'Freehold',
      areaDistribution: [{ areaSqft: 1000, count: 2 }], runDate: '2026-07-14',
      now: new Date('2026-07-14T01:00:00.000Z'), agentIdentity: 'chloe',
      sourceRevision: 'openclaw:2026.7.14',
    }),
    writeLocalStatus: async (value) => { statuses.push(value); },
    clearLocalStatus: async () => undefined,
    sshOriginalCommand: undefined,
  };
}

describe('valuation refresh CLI', () => {
  test('parses only exact lease-bearing command forms', () => {
    expect(parseValuationCliArgs(['queue', '--json'])).toEqual({ command: 'queue', json: true });
    expect(parseValuationCliArgs(['heartbeat', '--run-id', runId, '--lease-token', leaseToken, '--json']))
      .toEqual({ command: 'heartbeat', runId, leaseToken, json: true });
    for (const args of [
      ['heartbeat', '--run-id', runId, '--json'],
      ['complete', '--run-id', 'bad', '--lease-token', leaseToken, '--json'],
      ['queue', '--worker-id', 'attacker', '--json'],
      ['unknown', '--json'],
    ]) {
      expect(() => parseValuationCliArgs(args)).toThrow(ValuationCliError);
    }
  });

  test('queue output is allowlisted and contains no recipient PII fields', async () => {
    const deps = dependencies();
    deps.store.queueResult = {
      ...queue,
      name: 'Private Lead', phone: '+6591234567', email: 'private@example.com', notes: 'private',
    };
    const result = await runValuationCli(['queue', '--json'], deps);
    const text = JSON.stringify(result);
    for (const forbidden of ['Private Lead', '+6591234567', 'private@example.com', 'notes']) {
      expect(text).not.toContain(forbidden);
    }
    expect(result).toEqual(queue);
  });

  test('supports a nullable no-issue quiet queue', async () => {
    const deps = dependencies();
    deps.store.queueResult = { ...queue, issueId: null, issueSlug: null, status: 'quiet', candidates: [] };
    expect(await runValuationCli(['queue', '--json'], deps)).toMatchObject({
      issueId: null, issueSlug: null, status: 'quiet', candidates: [],
    });
  });

  test('validates evidence and records accepted outcome without caller-owned context', async () => {
    const deps = dependencies();
    const result = await runValuationCli([
      'import', '--run-id', runId, '--item-id', itemId,
      '--lease-token', leaseToken, '--json',
    ], deps);
    expect(result).toMatchObject({ status: 'accepted' });
    const outcome = deps.store.calls.at(-1)?.args[3] as RecordedValuationOutcome;
    expect(outcome.kind).toBe('accepted');
    expect(outcome).toMatchObject({ evidence: { agentIdentity: 'chloe', sourceRevision: 'openclaw:2026.7.14' } });
    expect(JSON.stringify(result)).not.toContain(leaseToken);
  });

  test('persists malformed evidence as rejected instead of dropping the audit', async () => {
    const deps = dependencies();
    deps.readStdin = async () => JSON.stringify({ kind: 'evidence', evidence: { confidence: 'low' } });
    const result = await runValuationCli([
      'import', '--run-id', runId, '--item-id', itemId,
      '--lease-token', leaseToken, '--json',
    ], deps);
    expect(result).toMatchObject({ status: 'rejected' });
    expect(deps.store.calls.at(-1)?.args[3]).toMatchObject({
      kind: 'rejected', errorCode: expect.any(String), evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test('records bounded blocked and failed outcomes', async () => {
    for (const submission of [
      { kind: 'blocked', reason: 'search unavailable', attemptedSources: ['https://eservice.ura.gov.sg/'] },
      { kind: 'failed', reason: 'browser failed', retryable: true },
    ]) {
      const deps = dependencies();
      deps.readStdin = async () => JSON.stringify(submission);
      await runValuationCli([
        'import', '--run-id', runId, '--item-id', itemId,
        '--lease-token', leaseToken, '--json',
      ], deps);
      expect(deps.store.calls.at(-1)?.args[3]).toMatchObject(submission);
    }
  });

  test('rejects oversized import stdin before parsing', async () => {
    const deps = dependencies();
    deps.readStdin = async () => 'x'.repeat(256 * 1024 + 1);
    await expect(runValuationCli([
      'import', '--run-id', runId, '--item-id', itemId,
      '--lease-token', leaseToken, '--json',
    ], deps)).rejects.toThrow('256 KiB');
    expect(deps.store.calls).toHaveLength(0);
  });

  test('writes a redacted local artifact before surfacing a database failure', async () => {
    const store = new FakeStore();
    store.fail = true;
    const deps = dependencies(store);
    await expect(runValuationCli(['queue', '--json'], deps)).rejects.toThrow();
    expect(deps.statuses).toHaveLength(1);
    const text = JSON.stringify(deps.statuses[0]);
    expect(text).toContain('database_error');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('db.example');
  });

  test('rejects local profile mutation through an SSH forced command', async () => {
    const deps = dependencies();
    deps.sshOriginalCommand = 'set-project-profile';
    await expect(runValuationCli([
      'set-project-profile', '--project-slug', 'cliften', '--input', '/tmp/profile.json', '--json',
    ], deps)).rejects.toThrow('not available over SSH');
  });
});

describe('valuation store and local status adapters', () => {
  test('uses only the reviewed RPC names and exact argument keys', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: name === 'claim_newsletter_valuation_run' ? queue : { runId, itemId, status: 'running' }, error: null };
      },
    };
    const store = createValuationStore(client as never, 'chloe', 'revision-1');
    await store.claimQueue();
    await store.heartbeat(runId, leaseToken);
    await store.importItem(runId, itemId, leaseToken, {
      kind: 'blocked', reason: 'search unavailable', attemptedSources: [],
    });
    await store.complete(runId, leaseToken);
    await store.loadGate(queue.issueId!);

    expect(calls).toEqual([
      { name: 'claim_newsletter_valuation_run', args: { p_worker_id: 'chloe', p_source_revision: 'revision-1' } },
      { name: 'heartbeat_newsletter_valuation_run', args: { p_run_id: runId, p_lease_token: leaseToken } },
      { name: 'record_newsletter_valuation_item', args: {
        p_run_id: runId, p_item_id: itemId, p_lease_token: leaseToken,
        p_outcome: { kind: 'blocked', reason: 'search unavailable', attemptedSources: [] },
      } },
      { name: 'complete_newsletter_valuation_run', args: { p_run_id: runId, p_lease_token: leaseToken } },
      { name: 'get_newsletter_valuation_gate', args: { p_issue_id: queue.issueId } },
    ]);
  });

  test('atomically writes a mode-0600 redacted local failure artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'valuation-local-status-'));
    const path = join(directory, 'status.json');
    await writeValuationLocalStatus({
      status: 'failed', command: 'queue', recordedAt: '2026-07-14T01:00:00.000Z',
      errorCode: 'database_error', message: 'database operation failed',
    }, path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      status: 'failed', command: 'queue', recordedAt: '2026-07-14T01:00:00.000Z',
      errorCode: 'database_error', message: 'database operation failed',
    });
  });
});
