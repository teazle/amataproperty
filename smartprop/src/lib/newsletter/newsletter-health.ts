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

function heartbeatIsCurrent(heartbeatAt: string | null, now: Date): boolean {
  return Boolean(heartbeatAt) && singaporeDate(new Date(heartbeatAt!)) === singaporeDate(now);
}

export function deriveNewsletterHealth(input: NewsletterHealthInput, now = new Date()): NewsletterHealthCheck {
  const run = input.latestRun;
  const statusBase = {
    enabled: input.enabled,
    sourceRevision: input.sourceRevision,
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
  };

  if (!input.enabled || beforeSendWindow(now)) return { status: 'quiet', ...statusBase };
  if (input.dataError || run?.status === 'failed' || (run?.unknown || 0) > 0) return { status: 'unknown', ...statusBase };
  if (run?.runDate === singaporeDate(now) && (run.status === 'blocked' || Boolean(run.blocker))) return { status: 'blocked', ...statusBase };
  if (!heartbeatIsCurrent(run?.heartbeatAt || null, now)) return { status: 'stale', ...statusBase };
  if (!input.wahaReady) return { status: 'blocked', ...statusBase };
  return { status: 'healthy', ...statusBase };
}
