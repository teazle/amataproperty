import { normalizeSingaporeRecipient } from './recipient';
import type { CampaignRun, NewsletterAttempt } from './campaign-runner';

export interface OperatorReportDraft {
  operatorKey: string;
  kind: 'summary' | 'recipient';
  sendId: string | null;
  body: string;
  idempotencyKey: string;
}

export function validateOperatorRecipients(values: string[]): string[] {
  if (values.length < 1 || values.length > 2) {
    throw new Error('Campaign reporting requires one or two operator recipients.');
  }
  const normalized = values.map((value) => normalizeSingaporeRecipient(value));
  if (normalized.some((value) => value === null)) {
    throw new Error('Operator recipients must be valid Singapore mobile numbers.');
  }
  const recipients = normalized as string[];
  if (new Set(recipients).size !== recipients.length) {
    throw new Error('Operator recipients must be unique.');
  }
  return recipients;
}

export function maskLeadPhone(recipientKey: string): string {
  const normalized = normalizeSingaporeRecipient(recipientKey);
  if (!normalized) return '+65 **** ????';
  return `+65 **** ${normalized.slice(-4)}`;
}

function summaryBody(run: CampaignRun): string {
  return [
    'WhatsApp newsletter campaign report',
    `Campaign: ${run.issueSlug}`,
    `SGT date: ${run.runDate}`,
    `Selected: ${run.selectedCount}`,
    `Attempted: ${run.attemptedCount}`,
    `Accepted: ${run.sentCount}`,
    `Rejected: ${run.failedCount}`,
    `Unknown: ${run.unknownCount}`,
    `Skipped: ${run.skippedCount}`,
    `Blocker: ${run.blocker || 'none'}`,
  ].join('\n');
}

function detailBody(attempt: NewsletterAttempt): string {
  return [
    'WhatsApp newsletter recipient report',
    `Name: ${attempt.recipientName}`,
    `Phone: ${maskLeadPhone(attempt.recipientKey)}`,
    `Final status: ${attempt.status}`,
    '',
    'Exact rendered body:',
    attempt.renderedBody,
  ].join('\n');
}

export function buildOperatorReportRows(
  run: CampaignRun,
  attempts: NewsletterAttempt[],
  operators: string[],
): OperatorReportDraft[] {
  const recipients = validateOperatorRecipients(operators);
  const stableAttempts = [...attempts].sort((left, right) =>
    (left.slotNo ?? Number.MAX_SAFE_INTEGER) - (right.slotNo ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id));

  return recipients.flatMap((operatorKey) => [
    {
      operatorKey,
      kind: 'summary' as const,
      sendId: null,
      body: summaryBody(run),
      idempotencyKey: `${run.id}:${operatorKey}:summary`,
    },
    ...stableAttempts.map((attempt) => ({
      operatorKey,
      kind: 'recipient' as const,
      sendId: attempt.id,
      body: detailBody(attempt),
      idempotencyKey: `${run.id}:${operatorKey}:recipient:${attempt.id}`,
    })),
  ]);
}
