export type NewsletterHealthStatus = 'healthy' | 'quiet' | 'blocked' | 'stale' | 'unknown';
export type ValuationPreparationState = 'quiet' | 'healthy' | 'blocked' | 'dead' | 'disabled';

export interface NewsletterRunHealthSnapshot {
  runDate: string;
  status: string;
  attempted: number;
  accepted: number;
  unknown: number;
  heartbeatAt: string | null;
  completedAt: string | null;
  blocker: string | null;
}

export interface NewsletterHealthInput {
  enabled: boolean;
  sourceRevision: string | null;
  wahaReady: boolean;
  latestRun: NewsletterRunHealthSnapshot | null;
  latestFinalizedSendAt: string | null;
  latestFinalizedReportAt: string | null;
  freshnessMinutes: number;
  dataError?: boolean;
}

export interface NewsletterHealthCheck {
  status: NewsletterHealthStatus;
  enabled: boolean;
  sourceRevision: string | null;
  latestRunDate: string | null;
  latestRunStatus: string | null;
  lastHeartbeatAt: string | null;
  lastMeaningfulWorkAt: string | null;
  attempted: number;
  accepted: number;
  unknown: number;
  wahaReady: boolean;
  freshnessMinutes: number;
}

export interface ValuationPreparationRunSnapshot {
  runDate: string;
  status: string;
  candidateCount: number;
  projectCount: number;
  acceptedCount: number;
  rejectedCount: number;
  blockedCount: number;
  failedCount: number;
  lastHeartbeatAt: string | null;
  lastMeaningfulWorkAt: string | null;
  completedAt: string | null;
  blocker: string | null;
}

export interface RedactedValuationLocalFailure {
  status: 'failed';
  command: 'queue' | 'heartbeat' | 'import' | 'complete' | 'set-project-profile';
  recordedAt: string;
  errorCode: 'database_error';
  message: 'database operation failed';
}

export interface ValuationPreparationHealthInput {
  enabled: boolean;
  sourceRevision: string | null;
  currentRun: ValuationPreparationRunSnapshot | null;
  newestAcceptedCacheAt: string | null;
  latestLocalFailure: RedactedValuationLocalFailure | null;
  rollingAcceptedImports: number;
  rollingCompletedItems: number;
  freshnessMinutes: number;
  dataError?: boolean;
}

export interface ValuationPreparationHealthCheck {
  state: ValuationPreparationState;
  enabled: boolean;
  sourceRevision: string | null;
  currentRunDate: string | null;
  currentRunStatus: string | null;
  lastHeartbeatAt: string | null;
  lastMeaningfulWorkAt: string | null;
  candidateCount: number;
  projectCount: number;
  acceptedCount: number;
  rejectedCount: number;
  blockedCount: number;
  failedCount: number;
  newestAcceptedCacheAt: string | null;
  latestLocalFailure: RedactedValuationLocalFailure | null;
  rollingAcceptedImports: number;
  rollingCompletedItems: number;
  rollingAcceptedImportRate: number;
  freshnessMinutes: number;
  blocker: string | null;
}

export const DEFAULT_NEWSLETTER_FRESHNESS_MINUTES = 30;
export const DEFAULT_VALUATION_FRESHNESS_MINUTES = 15;

export function parseNewsletterFreshnessMinutes(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 24 * 60
    ? parsed
    : DEFAULT_NEWSLETTER_FRESHNESS_MINUTES;
}

export function parseValuationFreshnessMinutes(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 120
    ? parsed
    : DEFAULT_VALUATION_FRESHNESS_MINUTES;
}

export function normalizeSourceRevision(value: string | null): string | null {
  const revision = value?.trim() || '';
  return /^[0-9a-f]{7,64}$/i.test(revision) ? revision : null;
}

function singaporeDate(value: Date): string {
  const singapore = new Date(value.getTime() + (8 * 60 * 60 * 1000));
  return [
    singapore.getUTCFullYear(),
    String(singapore.getUTCMonth() + 1).padStart(2, '0'),
    String(singapore.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function beforeSendWindow(now: Date): boolean {
  const singapore = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  return singapore.getUTCHours() < 9 || (singapore.getUTCHours() === 9 && singapore.getUTCMinutes() < 30);
}

function singaporeMinutes(now: Date): number {
  const singapore = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  return singapore.getUTCHours() * 60 + singapore.getUTCMinutes();
}

function latestTimestamp(...values: Array<string | null>): string | null {
  const valid = values.filter((value): value is string => typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value)));
  if (!valid.length) return null;
  return valid.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}

function timestampIsFresh(timestamp: string | null, now: Date, freshnessMinutes: number): boolean {
  if (!timestamp) return false;
  const ageMilliseconds = now.getTime() - Date.parse(timestamp);
  return Number.isFinite(ageMilliseconds) && ageMilliseconds >= 0 && ageMilliseconds <= freshnessMinutes * 60_000;
}

export function deriveNewsletterHealth(input: NewsletterHealthInput, now = new Date()): NewsletterHealthCheck {
  const run = input.latestRun;
  const freshnessMinutes = Number.isInteger(input.freshnessMinutes) && input.freshnessMinutes > 0
    ? input.freshnessMinutes
    : DEFAULT_NEWSLETTER_FRESHNESS_MINUTES;
  const sourceRevision = normalizeSourceRevision(input.sourceRevision);
  const statusBase = {
    enabled: input.enabled,
    sourceRevision,
    latestRunDate: run?.runDate || null,
    latestRunStatus: run?.status || null,
    lastHeartbeatAt: run?.heartbeatAt || null,
    lastMeaningfulWorkAt: latestTimestamp(
      run?.completedAt || null,
      input.latestFinalizedSendAt,
      input.latestFinalizedReportAt,
    ),
    attempted: run?.attempted || 0,
    accepted: run?.accepted || 0,
    unknown: run?.unknown || 0,
    wahaReady: input.wahaReady,
    freshnessMinutes,
  };

  if (input.dataError || !sourceRevision || run?.status === 'failed' || (run?.unknown || 0) > 0) return { status: 'unknown', ...statusBase };
  if (run?.runDate === singaporeDate(now) && (run.status === 'blocked' || Boolean(run.blocker))) return { status: 'blocked', ...statusBase };
  if (!input.wahaReady) return { status: 'blocked', ...statusBase };
  if (!input.enabled || beforeSendWindow(now)) return { status: 'quiet', ...statusBase };
  const heartbeatFresh = timestampIsFresh(run?.heartbeatAt || null, now, freshnessMinutes);
  if (run?.runDate === singaporeDate(now) && run.status === 'completed' && !heartbeatFresh) {
    return { status: 'quiet', ...statusBase };
  }
  if (!heartbeatFresh) return { status: 'stale', ...statusBase };
  return { status: 'healthy', ...statusBase };
}

export function deriveValuationPreparationHealth(
  input: ValuationPreparationHealthInput,
  now = new Date(),
): ValuationPreparationHealthCheck {
  const run = input.currentRun;
  const freshnessMinutes = Number.isInteger(input.freshnessMinutes) && input.freshnessMinutes > 0
    ? input.freshnessMinutes
    : DEFAULT_VALUATION_FRESHNESS_MINUTES;
  const rollingAcceptedImports = Math.max(0, Number(input.rollingAcceptedImports) || 0);
  const rollingCompletedItems = Math.max(0, Number(input.rollingCompletedItems) || 0);
  const base: Omit<ValuationPreparationHealthCheck, 'state'> = {
    enabled: input.enabled,
    sourceRevision: input.sourceRevision?.trim() || null,
    currentRunDate: run?.runDate || null,
    currentRunStatus: run?.status || null,
    lastHeartbeatAt: run?.lastHeartbeatAt || null,
    lastMeaningfulWorkAt: run?.lastMeaningfulWorkAt || null,
    candidateCount: run?.candidateCount || 0,
    projectCount: run?.projectCount || 0,
    acceptedCount: run?.acceptedCount || 0,
    rejectedCount: run?.rejectedCount || 0,
    blockedCount: run?.blockedCount || 0,
    failedCount: run?.failedCount || 0,
    newestAcceptedCacheAt: input.newestAcceptedCacheAt,
    latestLocalFailure: input.latestLocalFailure,
    rollingAcceptedImports,
    rollingCompletedItems,
    rollingAcceptedImportRate: rollingCompletedItems > 0
      ? rollingAcceptedImports / rollingCompletedItems
      : 0,
    freshnessMinutes,
    blocker: run?.blocker || null,
  };
  const result = (state: ValuationPreparationState): ValuationPreparationHealthCheck => ({ state, ...base });

  if (!input.enabled) return result('disabled');
  const currentDate = singaporeDate(now);
  const minutes = singaporeMinutes(now);
  const beforeSchedule = minutes < (8 * 60 + 30);
  if (input.dataError || !base.sourceRevision) return result('dead');
  if (!run || run.runDate !== currentDate) return result(beforeSchedule ? 'quiet' : 'dead');

  const latestDatabaseAction = latestTimestamp(
    run.lastHeartbeatAt,
    run.lastMeaningfulWorkAt,
    run.completedAt,
  );
  if (input.latestLocalFailure && (
    !latestDatabaseAction ||
    Date.parse(input.latestLocalFailure.recordedAt) > Date.parse(latestDatabaseAction)
  )) return result('dead');

  if (run.status === 'quiet' && run.candidateCount === 0 && Boolean(run.completedAt)) {
    return result('quiet');
  }
  if (run.status === 'failed') return result('dead');
  if (run.status === 'blocked' || run.blocker) return result('blocked');
  if (run.status === 'completed') {
    if (run.candidateCount === 0) return result('quiet');
    if (run.acceptedCount <= 0 || !input.newestAcceptedCacheAt) return result('blocked');
    return result('healthy');
  }
  if (minutes >= (9 * 60 + 20)) return result('dead');
  if (!timestampIsFresh(run.lastHeartbeatAt, now, freshnessMinutes) ||
      !timestampIsFresh(run.lastMeaningfulWorkAt, now, freshnessMinutes)) {
    return result('dead');
  }
  return result('healthy');
}
