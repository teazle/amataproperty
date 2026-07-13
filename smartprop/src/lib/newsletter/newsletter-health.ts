export type NewsletterHealthStatus = 'healthy' | 'quiet' | 'blocked' | 'stale' | 'unknown';

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

export const DEFAULT_NEWSLETTER_FRESHNESS_MINUTES = 30;

export function parseNewsletterFreshnessMinutes(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 24 * 60
    ? parsed
    : DEFAULT_NEWSLETTER_FRESHNESS_MINUTES;
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
