import { composeNewsletter } from './compose';
import { normalizeSingaporeRecipient } from './recipient';
import { validateOperatorRecipients } from './operator-report';
import type {
  CampaignStore,
  FinalizeAttemptInput,
  RecoveryRecord,
} from './campaign-store';
import type {
  CampaignTransportResult,
  NewsletterValuationSnapshot,
} from './campaign-types';
import { countEffectiveSelections } from './campaign-types';

export interface NewsletterIssue {
  id: string;
  slug: string;
  status: 'approved' | 'sending';
  featuredProjects: Array<{ title: string }>;
  audienceProjectSlug?: string | null;
}

export interface CampaignCandidate {
  id: string;
  name: string;
  recipientKey: string;
  propertyTitle: string;
  leadCode: string;
  priority: 'high' | 'normal' | 'low';
  createdAt: string;
  attemptCount: number;
  valuation: NewsletterValuationSnapshot;
}

export type AttemptStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'unknown' | 'opted_out' | 'skipped' | 'test';

export interface NewsletterAttempt {
  id: string;
  runId: string;
  leadId: string | null;
  slotNo: number | null;
  recipientName: string;
  recipientKey: string;
  renderedBody: string;
  status: AttemptStatus;
  attemptNo: number | null;
  retryable: boolean;
}

export interface CampaignRun {
  id: string;
  runDate: string;
  issueId: string;
  issueSlug: string;
  status: 'blocked' | 'running' | 'completed' | 'failed';
  selectedCount: number;
  attemptedCount: number;
  sentCount: number;
  failedCount: number;
  unknownCount: number;
  skippedCount: number;
  blocker: string | null;
  reportError: string | null;
}

export interface CampaignRunOptions {
  enabled: boolean;
  operatorRecipients: string[];
  dryRun?: boolean;
  date?: string;
  claimToken?: string;
  featuredUrlBase?: string;
}

export interface CampaignRunResult {
  status: 'completed' | 'blocked' | 'dry-run' | 'recovery-required';
  recoverable: boolean;
  blocker: string | null;
  selectedCount: number;
  attemptedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  unknownCount: number;
  skippedCount: number;
  runId?: string;
}

export interface CampaignRunnerDependencies {
  store: CampaignStore;
  preflight: () => Promise<{ ready: boolean; error?: string }>;
  transport: (to: string, body: string) => Promise<CampaignTransportResult>;
  sleep: (milliseconds: number) => Promise<void>;
  writeRecoveryRecord: (record: RecoveryRecord) => Promise<void>;
  now?: () => Date;
}

export class CampaignConfigurationError extends Error {}

function validateDate(value: string): void {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!match || !date || date.getUTCFullYear() !== Number(match[1]) ||
      date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new CampaignConfigurationError('--date must be a valid yyyy-mm-dd date.');
  }
}

function validateOptions(options: CampaignRunOptions): string[] {
  if (!options.enabled) throw new CampaignConfigurationError('WhatsApp newsletter campaign is disabled.');
  if (options.date && !options.dryRun) {
    throw new CampaignConfigurationError('--date is allowed only with --dry-run.');
  }
  if (options.date) validateDate(options.date);
  try {
    return validateOperatorRecipients(options.operatorRecipients);
  } catch (error) {
    throw new CampaignConfigurationError(error instanceof Error ? error.message : 'Invalid operator configuration.');
  }
}

function compose(issue: NewsletterIssue, candidate: CampaignCandidate, featuredUrlBase: string): string {
  return composeNewsletter({
    lead: {
      name: candidate.name,
      propertyTitle: candidate.propertyTitle,
      leadCode: candidate.leadCode,
    },
    valuation: candidate.valuation,
    featuredProjects: issue.featuredProjects,
    featuredUrlBase,
  });
}

function resultFromRun(run: CampaignRun, status: CampaignRunResult['status'] = 'completed'): CampaignRunResult {
  return {
    status,
    recoverable: false,
    blocker: run.blocker,
    selectedCount: run.selectedCount,
    attemptedCount: run.attemptedCount,
    acceptedCount: run.sentCount,
    rejectedCount: run.failedCount,
    unknownCount: run.unknownCount,
    skippedCount: run.skippedCount,
    runId: run.id,
  };
}

function summarizeAttempts(run: CampaignRun, attempts: NewsletterAttempt[]): CampaignRun {
  return {
    ...run,
    selectedCount: countEffectiveSelections(attempts),
    attemptedCount: attempts.filter((attempt) => attempt.status !== 'queued' && attempt.status !== 'opted_out' && attempt.status !== 'skipped').length,
    sentCount: attempts.filter((attempt) => attempt.status === 'sent').length,
    failedCount: attempts.filter((attempt) => attempt.status === 'failed').length,
    unknownCount: attempts.filter((attempt) => attempt.status === 'unknown' || attempt.status === 'sending').length,
    skippedCount: attempts.filter((attempt) => attempt.status === 'opted_out' || attempt.status === 'skipped').length,
  };
}

async function sendOperatorReports(
  dependencies: CampaignRunnerDependencies,
  run: CampaignRun,
  operators: string[],
): Promise<string | null> {
  const reports = await dependencies.store.queueOperatorReports(run.id, operators);
  let reportError: string | null = null;
  for (const report of reports) {
    if (!await dependencies.store.startReport(report.id)) continue;
    const result = await dependencies.transport(report.operatorKey, report.body);
    await dependencies.store.finalizeReport(report.id, result);
    if (result.outcome !== 'accepted' && !reportError) {
      reportError = result.outcome === 'unknown'
        ? `operator report outcome unknown: ${result.error}`
        : `operator report failed: ${result.error}`;
    }
  }
  return reportError;
}

export async function runNewsletterCampaign(
  dependencies: CampaignRunnerDependencies,
  options: CampaignRunOptions,
): Promise<CampaignRunResult> {
  const operators = validateOptions(options);
  const featuredUrlBase = options.featuredUrlBase || 'https://viewproperty.ai/p';

  if (options.dryRun) {
    const issue = await dependencies.store.resolveIssue();
    const referenceTime = options.date
      ? new Date(`${options.date}T00:00:00+08:00`)
      : (dependencies.now?.() || new Date());
    const candidates = (await dependencies.store.selectCandidates(issue, 5, referenceTime))
      .filter((item) => item.attemptCount < 3);
    for (const candidate of candidates) compose(issue, candidate, featuredUrlBase);
    return {
      status: 'dry-run', recoverable: false, blocker: null,
      selectedCount: candidates.length, attemptedCount: 0, acceptedCount: 0,
      rejectedCount: 0, unknownCount: 0, skippedCount: 0,
    };
  }

  const readiness = await dependencies.preflight();
  if (!readiness.ready) {
    return {
      status: 'blocked', recoverable: true, blocker: readiness.error || 'WAHA is not ready',
      selectedCount: 0, attemptedCount: 0, acceptedCount: 0,
      rejectedCount: 0, unknownCount: 0, skippedCount: 0,
    };
  }

  const now = dependencies.now?.() || new Date();
  const claimToken = options.claimToken || crypto.randomUUID();
  let run = await dependencies.store.claimToday(claimToken);
  let attempts = await dependencies.store.listAttempts(run.id);
  const recoveredReports = await dependencies.store.recoverStaleReports(
    run.id,
    new Date(now.getTime() - 5 * 60_000),
  );
  if (recoveredReports > 0) {
    return {
      ...resultFromRun(run, 'recovery-required'),
      blocker: 'stale operator report outcome unknown',
    };
  }
  if (run.reportError) {
    return { ...resultFromRun(run, 'recovery-required'), blocker: run.reportError };
  }
  if (run.status === 'completed') {
    const reportError = await sendOperatorReports(dependencies, run, operators);
    if (reportError) {
      return { ...resultFromRun(run, 'recovery-required'), blocker: reportError };
    }
    return resultFromRun(run);
  }
  if (run.status === 'blocked') return { ...resultFromRun(run, 'blocked'), recoverable: true };
  if (run.status === 'failed') {
    return {
      ...resultFromRun(run, 'recovery-required'),
      blocker: run.blocker || 'newsletter run requires recovery',
    };
  }

  const issue = await dependencies.store.resolveIssue(run.issueId);
  await dependencies.store.recoverAbandoned(run.id, new Date(now.getTime() - 15 * 60_000));
  attempts = await dependencies.store.listAttempts(run.id);
  const queuedAttempts = attempts.filter((attempt) => attempt.status === 'queued');
  const knownRecipients = new Set(attempts.map((attempt) => attempt.recipientKey));
  const committedCount = () => attempts.filter((attempt) =>
    attempt.status === 'queued' || attempt.slotNo !== null).length;

  const targetCommittedCount = attempts.length === 0 ? 5 : Math.min(5, run.selectedCount);
  if (committedCount() < targetCommittedCount) {
    const candidates = await dependencies.store.selectCandidates(issue, 10, now);
    for (const candidate of candidates) {
      if (committedCount() >= targetCommittedCount || candidate.attemptCount >= 3 ||
          knownRecipients.has(candidate.recipientKey)) continue;
      const queued = await dependencies.store.queueAttempt(
        run, candidate, claimToken, compose(issue, candidate, featuredUrlBase),
      );
      if (queued === 'suppressed') continue;
      if (!attempts.some((attempt) => attempt.id === queued.id)) attempts.push(queued);
      queuedAttempts.push(queued);
      knownRecipients.add(candidate.recipientKey);
    }
  }

  let nextSlot = Math.max(0, ...attempts.flatMap((attempt) => attempt.slotNo === null ? [] : [attempt.slotNo])) + 1;
  for (let index = 0; index < queuedAttempts.length && nextSlot <= 5; index += 1) {
    const queued = queuedAttempts[index];
    const started = await dependencies.store.startAttempt(queued, run, nextSlot, claimToken);
    if (started === 'suppressed') {
      attempts = attempts.map((attempt) => attempt.id === queued.id
        ? { ...attempt, status: 'opted_out', retryable: false }
        : attempt);
      const replacements = await dependencies.store.selectCandidates(issue, 10, now);
      const replacement = replacements.find((candidate) =>
        candidate.attemptCount < 3 && !knownRecipients.has(candidate.recipientKey));
      if (replacement) {
        const queuedReplacement = await dependencies.store.queueAttempt(
          run, replacement, claimToken, compose(issue, replacement, featuredUrlBase),
        );
        if (queuedReplacement !== 'suppressed') {
          if (!attempts.some((attempt) => attempt.id === queuedReplacement.id)) attempts.push(queuedReplacement);
          queuedAttempts.push(queuedReplacement);
          knownRecipients.add(replacement.recipientKey);
        }
      }
      continue;
    }

    const transportResult = await dependencies.transport(started.recipientKey, started.renderedBody);
    const finalizeInput: FinalizeAttemptInput = { attemptId: started.id, result: transportResult };
    try {
      await dependencies.store.finalizeAttempt(finalizeInput);
    } catch (error) {
      if (transportResult.outcome === 'accepted') {
        const errorMessage = error instanceof Error ? error.message : 'Unknown CRM finalization failure';
        await dependencies.store.recordAcceptedRecovery(started.id, transportResult.messageId, errorMessage);
        const recoveryRecord = {
          kind: 'accepted-crm-finalization-failure',
          runId: run.id,
          attemptId: started.id,
          providerMessageId: transportResult.messageId,
          recipientKey: started.recipientKey,
          error: errorMessage,
          recordedAt: new Date().toISOString(),
        } as RecoveryRecord;
        try {
          await dependencies.writeRecoveryRecord(recoveryRecord);
        } catch {
          // The database recovery ledger is authoritative; the file is secondary evidence.
        }
        return {
          ...resultFromRun(summarizeAttempts(run, [...attempts, started]), 'recovery-required'),
          blocker: 'accepted send requires CRM finalization recovery',
        };
      }
      throw error;
    }
    await dependencies.store.heartbeat(run.id);
    const finalizedAttempt: NewsletterAttempt = {
      ...started,
      status: transportResult.outcome === 'accepted'
        ? 'sent'
        : transportResult.outcome === 'rejected' ? 'failed' : 'unknown',
      retryable: transportResult.outcome === 'rejected' && transportResult.retryable,
    };
    attempts = attempts.map((attempt) => attempt.id === started.id ? finalizedAttempt : attempt);
    nextSlot += 1;

    const canStartAnother = nextSlot <= 5 && queuedAttempts.slice(index + 1).length > 0;
    if (canStartAnother) await dependencies.sleep(60_000);
  }

  run = summarizeAttempts(run, attempts);
  run = await dependencies.store.finishRun(run.id, null);
  run = { ...run, ...summarizeAttempts(run, attempts) };
  const reportError = await sendOperatorReports(dependencies, run, operators);
  if (reportError) {
    return { ...resultFromRun(run, 'recovery-required'), blocker: reportError };
  }
  return resultFromRun(run);
}

export interface NewsletterTestSendOptions {
  destination: string;
  configuredDestination: string;
  sourceLeadId: string;
  featuredUrlBase?: string;
}

export async function runNewsletterTestSend(
  dependencies: CampaignRunnerDependencies,
  options: NewsletterTestSendOptions,
): Promise<CampaignTransportResult> {
  const destination = normalizeSingaporeRecipient(options.destination);
  const configured = normalizeSingaporeRecipient(options.configuredDestination);
  if (!destination || !configured || destination !== configured) {
    throw new CampaignConfigurationError('test-send destination must equal SMARTPROP_NEWSLETTER_TEST_TO.');
  }
  const issue = await dependencies.store.resolveIssue();
  const candidate = await dependencies.store.selectCandidate(issue, options.sourceLeadId);
  if (!candidate) throw new CampaignConfigurationError('test-send source lead is not eligible.');
  const body = compose(issue, candidate, options.featuredUrlBase || 'https://viewproperty.ai/p');
  const testSendId = await dependencies.store.createTestSend({
    issueId: issue.id,
    sourceLeadId: candidate.id,
    sourcePhone: candidate.recipientKey,
    overridePhone: destination,
    recipientName: candidate.name,
    renderedBody: body,
    valuation: candidate.valuation,
    isTest: true,
  });
  const result = await dependencies.transport(destination, body);
  await dependencies.store.finalizeTestSend(testSendId, result);
  return result;
}
