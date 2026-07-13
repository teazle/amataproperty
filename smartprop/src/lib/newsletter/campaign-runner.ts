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
  slotNo: number;
  recipientName: string;
  recipientKey: string;
  renderedBody: string;
  status: AttemptStatus;
  attemptNo: number;
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
}

export class CampaignConfigurationError extends Error {}

function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new CampaignConfigurationError('--date must be a valid yyyy-mm-dd date.');
  }
}

function validateOptions(options: CampaignRunOptions): string[] {
  if (!options.enabled) throw new CampaignConfigurationError('WhatsApp newsletter campaign is disabled.');
  if (options.date && !options.dryRun) {
    throw new CampaignConfigurationError('--date is allowed only with --dry-run.');
  }
  if (options.date) validateDate(options.date);
  return validateOperatorRecipients(options.operatorRecipients);
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
    selectedCount: attempts.length,
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
): Promise<void> {
  const reports = await dependencies.store.queueOperatorReports(run.id, operators);
  for (const report of reports) {
    if (!await dependencies.store.startReport(report.id)) continue;
    const result = await dependencies.transport(report.operatorKey, report.body);
    await dependencies.store.finalizeReport(report.id, result);
  }
}

export async function runNewsletterCampaign(
  dependencies: CampaignRunnerDependencies,
  options: CampaignRunOptions,
): Promise<CampaignRunResult> {
  const operators = validateOptions(options);
  const featuredUrlBase = options.featuredUrlBase || 'https://viewproperty.ai/p';

  if (options.dryRun) {
    const issue = await dependencies.store.resolveIssue();
    const candidates = (await dependencies.store.selectCandidates(issue, 5)).filter((item) => item.attemptCount < 3);
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

  let run = await dependencies.store.claimToday(options.claimToken || 'newsletter-runner');
  let attempts = await dependencies.store.listAttempts(run.id);
  if (run.status === 'completed') {
    await sendOperatorReports(dependencies, run, operators);
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
  await dependencies.store.recoverAbandoned(run.id);
  attempts = await dependencies.store.listAttempts(run.id);
  const consumedSlots = new Set(attempts.map((attempt) => attempt.slotNo));
  const remainingSlots = Math.max(0, 5 - consumedSlots.size);
  const candidates = remainingSlots > 0
    ? await dependencies.store.selectCandidates(issue, remainingSlots + 5)
    : [];
  const attemptedRecipients = new Set(attempts.map((attempt) => attempt.recipientKey));
  let nextSlot = consumedSlots.size + 1;
  let startedThisInvocation = 0;

  for (const candidate of candidates) {
    if (nextSlot > 5 || candidate.attemptCount >= 3 || attemptedRecipients.has(candidate.recipientKey)) continue;
    const body = compose(issue, candidate, featuredUrlBase);
    const started = await dependencies.store.startAttempt(run, candidate, nextSlot, body);
    if (started === 'suppressed') continue;

    startedThisInvocation += 1;
    attemptedRecipients.add(candidate.recipientKey);
    const transportResult = await dependencies.transport(candidate.recipientKey, body);
    const finalizeInput: FinalizeAttemptInput = { attemptId: started.id, result: transportResult };
    try {
      await dependencies.store.finalizeAttempt(finalizeInput);
    } catch (error) {
      if (transportResult.outcome === 'accepted') {
        await dependencies.writeRecoveryRecord({
          kind: 'accepted-crm-finalization-failure',
          runId: run.id,
          attemptId: started.id,
          providerMessageId: transportResult.messageId,
          recipientKey: candidate.recipientKey,
          error: error instanceof Error ? error.message : 'Unknown CRM finalization failure',
          recordedAt: new Date().toISOString(),
        });
        await dependencies.store.markRecoveryRequired(
          run.id,
          `accepted send ${started.id} requires CRM finalization recovery`,
        );
        return {
          ...resultFromRun(summarizeAttempts(run, [...attempts, started]), 'recovery-required'),
          blocker: 'accepted send requires CRM finalization recovery',
        };
      }
      throw error;
    }
    await dependencies.store.heartbeat(run.id);
    attempts.push({
      ...started,
      status: transportResult.outcome === 'accepted'
        ? 'sent'
        : transportResult.outcome === 'rejected' ? 'failed' : 'unknown',
      retryable: transportResult.outcome === 'rejected' && transportResult.retryable,
    });
    nextSlot += 1;

    const canStartAnother = nextSlot <= 5 && candidates.some((remaining) =>
      remaining.attemptCount < 3 && !attemptedRecipients.has(remaining.recipientKey));
    if (canStartAnother) await dependencies.sleep(60_000);
  }

  run = summarizeAttempts(run, attempts);
  run = await dependencies.store.finishRun(run.id, null);
  run = { ...run, ...summarizeAttempts(run, attempts) };
  if (startedThisInvocation > 0 || attempts.length > 0) {
    await sendOperatorReports(dependencies, run, operators);
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
