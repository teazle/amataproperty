import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import {
  hashCanonicalValuationInput,
  validateValuationEvidence,
  ValuationEvidenceValidationError,
  type ValuationEvidenceContext,
} from '../src/lib/newsletter/valuation-evidence';
import {
  clearValuationLocalStatus,
  writeValuationLocalStatus,
  type ValuationLocalFailureStatus,
} from '../src/lib/newsletter/valuation-local-status';
import {
  createValuationStore,
  loadValuationEvidenceContext,
  type RecordedValuationOutcome,
  type ValuationProjectProfile,
  type ValuationQueue,
  type ValuationQueueCandidate,
  type ValuationStore,
} from '../src/lib/newsletter/valuation-store';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_STDIN_BYTES = 256 * 1024;

export class ValuationCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValuationCliError';
  }
}

export type ValuationCliCommand =
  | { command: 'queue'; json: true }
  | { command: 'heartbeat'; runId: string; leaseToken: string; json: true }
  | { command: 'import'; runId: string; itemId: string; leaseToken: string; json: true }
  | { command: 'complete'; runId: string; leaseToken: string; json: true }
  | { command: 'set-project-profile'; projectSlug: string; input: string; json: true };

function expectArgs(args: string[], expected: string[]): void {
  if (args.length !== expected.length || expected.some((value, index) =>
    value.startsWith('<') ? !args[index] : args[index] !== value)) {
    throw new ValuationCliError('command arguments do not match the restricted grammar');
  }
}

function validUuid(value: string, label: string): string {
  if (!UUID.test(value)) throw new ValuationCliError(`${label} must be a UUID`);
  return value;
}

export function parseValuationCliArgs(args: string[]): ValuationCliCommand {
  if (args[0] === 'queue') {
    expectArgs(args, ['queue', '--json']);
    return { command: 'queue', json: true };
  }
  if (args[0] === 'heartbeat' || args[0] === 'complete') {
    expectArgs(args, [args[0], '--run-id', '<uuid>', '--lease-token', '<uuid>', '--json']);
    return {
      command: args[0],
      runId: validUuid(args[2], '--run-id'),
      leaseToken: validUuid(args[4], '--lease-token'),
      json: true,
    };
  }
  if (args[0] === 'import') {
    expectArgs(args, ['import', '--run-id', '<uuid>', '--item-id', '<uuid>', '--lease-token', '<uuid>', '--json']);
    return {
      command: 'import',
      runId: validUuid(args[2], '--run-id'),
      itemId: validUuid(args[4], '--item-id'),
      leaseToken: validUuid(args[6], '--lease-token'),
      json: true,
    };
  }
  if (args[0] === 'set-project-profile') {
    expectArgs(args, ['set-project-profile', '--project-slug', '<slug>', '--input', '<path>', '--json']);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args[2])) {
      throw new ValuationCliError('--project-slug must be a lowercase slug');
    }
    if (!args[4].startsWith('/')) throw new ValuationCliError('--input must be an absolute path');
    return { command: 'set-project-profile', projectSlug: args[2], input: args[4], json: true };
  }
  throw new ValuationCliError('unknown valuation refresh command');
}

export interface ValuationCliDependencies {
  store: ValuationStore;
  now(): Date;
  readStdin(): Promise<string>;
  readFile(path: string): Promise<string>;
  loadEvidenceContext(runId: string, itemId: string, now: Date): Promise<ValuationEvidenceContext>;
  writeLocalStatus(value: ValuationLocalFailureStatus): Promise<void>;
  clearLocalStatus(): Promise<void>;
  sshOriginalCommand: string | undefined;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValuationCliError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, max = 1_000): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new ValuationCliError(`${label} is required and bounded`);
  }
  return value.trim();
}

function projectProfile(value: unknown): ValuationProjectProfile {
  const input = record(value, 'project profile');
  if (!Array.isArray(input.areaDistribution) || input.areaDistribution.length === 0 ||
      input.areaDistribution.length > 100) {
    throw new ValuationCliError('areaDistribution must contain 1-100 entries');
  }
  return {
    location: boundedString(input.location, 'location', 300),
    propertyType: boundedString(input.propertyType, 'propertyType', 100),
    tenure: boundedString(input.tenure, 'tenure', 100),
    areaDistribution: input.areaDistribution.map((entry) => {
      const item = record(entry, 'areaDistribution entry');
      const areaSqft = Number(item.areaSqft);
      const count = Number(item.count);
      if (!Number.isFinite(areaSqft) || areaSqft <= 0 || !Number.isInteger(count) || count <= 0) {
        throw new ValuationCliError('areaDistribution values must be positive');
      }
      return { areaSqft, count };
    }),
  };
}

function sanitizeCandidate(value: ValuationQueueCandidate): ValuationQueueCandidate {
  return {
    itemId: String(value.itemId),
    projectSlug: String(value.projectSlug),
    projectTitle: String(value.projectTitle),
    location: String(value.location),
    propertyType: String(value.propertyType),
    tenure: String(value.tenure),
    areaDistribution: Array.isArray(value.areaDistribution)
      ? value.areaDistribution.map((entry) => ({ areaSqft: Number(entry.areaSqft), count: Number(entry.count) }))
      : [],
    candidateCount: Number(value.candidateCount),
    reason: value.reason,
  };
}

function sanitizeQueue(value: ValuationQueue): ValuationQueue {
  return {
    runId: String(value.runId),
    leaseToken: String(value.leaseToken),
    issueId: value.issueId === null ? null : String(value.issueId),
    issueSlug: value.issueSlug === null ? null : String(value.issueSlug),
    runDate: String(value.runDate),
    status: value.status,
    deadlineSgt: '09:20',
    blocker: typeof value.blocker === 'string' ? value.blocker : null,
    candidates: (Array.isArray(value.candidates) ? value.candidates : [])
      .slice(0, 5).map(sanitizeCandidate)
      .sort((left, right) => left.projectSlug.localeCompare(right.projectSlug) || left.itemId.localeCompare(right.itemId)),
  };
}

function withoutLease<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const clean = Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'leaseToken'));
  return clean as T;
}

async function databaseAction<T>(
  deps: ValuationCliDependencies,
  command: ValuationLocalFailureStatus['command'],
  ids: { runId?: string; itemId?: string },
  action: () => Promise<T>,
): Promise<T> {
  try {
    const result = await action();
    await deps.clearLocalStatus();
    return result;
  } catch (error) {
    await deps.writeLocalStatus({
      status: 'failed', command, ...ids,
      recordedAt: deps.now().toISOString(),
      errorCode: 'database_error', message: 'database operation failed',
    });
    throw error;
  }
}

function parseSubmission(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text, 'utf8') > MAX_STDIN_BYTES) {
    throw new ValuationCliError('import stdin exceeds 256 KiB');
  }
  try {
    return record(JSON.parse(text), 'valuation submission');
  } catch (error) {
    if (error instanceof ValuationCliError) throw error;
    throw new ValuationCliError('valuation submission must be valid JSON');
  }
}

export async function runValuationCli(
  args: string[],
  deps: ValuationCliDependencies,
): Promise<unknown> {
  const command = parseValuationCliArgs(args);
  if (command.command === 'queue') {
    return sanitizeQueue(await databaseAction(deps, 'queue', {}, () => deps.store.claimQueue()));
  }
  if (command.command === 'heartbeat') {
    return withoutLease(await databaseAction(deps, 'heartbeat', { runId: command.runId },
      () => deps.store.heartbeat(command.runId, command.leaseToken)));
  }
  if (command.command === 'complete') {
    return withoutLease(await databaseAction(deps, 'complete', { runId: command.runId },
      () => deps.store.complete(command.runId, command.leaseToken)));
  }
  if (command.command === 'set-project-profile') {
    if (deps.sshOriginalCommand !== undefined) {
      throw new ValuationCliError('set-project-profile is not available over SSH');
    }
    const profile = projectProfile(JSON.parse(await deps.readFile(command.input)));
    await databaseAction(deps, 'set-project-profile', {},
      () => deps.store.setProjectProfile(command.projectSlug, profile));
    return { status: 'completed', projectSlug: command.projectSlug };
  }

  const submission = parseSubmission(await deps.readStdin());
  const kind = submission.kind;
  let outcome: RecordedValuationOutcome;
  if (kind === 'evidence') {
    const context = await databaseAction(deps, 'import', {
      runId: command.runId, itemId: command.itemId,
    }, () => deps.loadEvidenceContext(command.runId, command.itemId, deps.now()));
    try {
      outcome = { kind: 'accepted', evidence: validateValuationEvidence(submission.evidence, context) };
    } catch (error) {
      if (!(error instanceof ValuationEvidenceValidationError)) throw error;
      outcome = {
        kind: 'rejected',
        errorCode: error.code,
        errorDetail: error.message,
        evidenceHash: hashCanonicalValuationInput(submission.evidence),
      };
    }
  } else if (kind === 'blocked') {
    if (!Array.isArray(submission.attemptedSources) || submission.attemptedSources.length > 8 ||
        submission.attemptedSources.some((value) => typeof value !== 'string' || value.length > 2_000)) {
      throw new ValuationCliError('attemptedSources must be a bounded string array');
    }
    outcome = {
      kind: 'blocked',
      reason: boundedString(submission.reason, 'blocked reason'),
      attemptedSources: submission.attemptedSources as string[],
    };
  } else if (kind === 'failed') {
    if (typeof submission.retryable !== 'boolean') throw new ValuationCliError('failed retryable must be boolean');
    outcome = {
      kind: 'failed',
      reason: boundedString(submission.reason, 'failed reason'),
      retryable: submission.retryable,
    };
  } else {
    throw new ValuationCliError('submission kind must be evidence, blocked, or failed');
  }

  return withoutLease(await databaseAction(deps, 'import', {
    runId: command.runId, itemId: command.itemId,
  }, () => deps.store.importItem(command.runId, command.itemId, command.leaseToken, outcome)));
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ValuationCliError(`${name} is required`);
  return value;
}

async function readBoundedStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_STDIN_BYTES) throw new ValuationCliError('import stdin exceeds 256 KiB');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  config({ path: join(process.cwd(), '.env.local'), quiet: true });
  const client = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const store = createValuationStore(
    client,
    requiredEnv('VALUATION_WORKER_ID'),
    requiredEnv('VALUATION_SOURCE_REVISION'),
  );
  const deps: ValuationCliDependencies = {
    store,
    now: () => new Date(),
    readStdin: readBoundedStdin,
    readFile: (path) => readFile(path, 'utf8'),
    loadEvidenceContext: (runId, itemId, now) =>
      loadValuationEvidenceContext(client, runId, itemId, now),
    writeLocalStatus: (value) => writeValuationLocalStatus(value),
    clearLocalStatus: () => clearValuationLocalStatus(),
    sshOriginalCommand: process.env.SSH_ORIGINAL_COMMAND,
  };
  const result = await runValuationCli(args, deps);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (import.meta.main) {
  main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    const configuration = error instanceof ValuationCliError;
    process.stderr.write(`${configuration ? error.message : 'valuation refresh operation failed'}\n`);
    process.exitCode = configuration ? 20 : 30;
  });
}
