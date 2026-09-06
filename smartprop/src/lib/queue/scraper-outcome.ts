import type { ScraperJobPayload } from './queue-types';

type PersistedScraperJob = {
  status: string;
  listingsProcessed?: number | null;
  stats?: Record<string, unknown> | null;
  errorMessage?: string | null;
};

export type ScraperOutcomeDependencies = {
  run: () => Promise<void>;
  read: () => Promise<PersistedScraperJob>;
  markFailed: (message: string) => Promise<'failed' | 'cancelled'>;
};

export class ScraperProcessExitError extends Error {
  readonly exitCode: number | null;

  constructor(exitCode: number | null, message: string) {
    super(message);
    this.name = 'ScraperProcessExitError';
    this.exitCode = exitCode;
  }
}

export function assertScraperJobUpdate(rowCount: number): void {
  if (rowCount !== 1) {
    throw new Error(`Outcome update did not update exactly one scraper job (updated ${rowCount})`);
  }
}

export function appendOperatorActionDiagnostic(existingError: string | null | undefined, diagnostic: string): string {
  const existing = existingError?.trim();
  if (!existing) return diagnostic;
  if (existing.includes(diagnostic)) return existing;
  return `${existing}\n${diagnostic}`;
}

export function decideScraperJobLaunch(status: string):
  | { launch: true }
  | { acknowledged: true; status: 'cancelled' | 'completed' | 'running' } {
  if (status === 'cancelled' || status === 'completed' || status === 'running') {
    return { acknowledged: true, status };
  }

  if (status === 'queued' || status === 'failed') {
    return { launch: true };
  }

  throw new Error(`Scraper job cannot launch from persisted status ${status || 'unknown'}`);
}

export function buildScraperChildEnvironment(
  platform: ScraperJobPayload['platform'],
  config: ScraperJobPayload['config'],
  jobId: string,
  base: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };

  if (platform === 'propertyguru') {
    env.PG_DISTRICTS = config.district?.replace('D', '') || '';
    env.PG_MAX_PAGES = config.pages.toString();
    if (config.maxListings) env.PG_MAX_LISTINGS = config.maxListings.toString();
    if (config.minPrice !== undefined) env.PG_MIN_PRICE = config.minPrice.toString();
    if (config.maxPrice !== undefined) env.PG_MAX_PRICE = config.maxPrice.toString();
    env.PG_JOB_ID = jobId;
  } else {
    env.EP_MAX_PAGES = config.pages.toString();
    if (config.maxListings) env.EP_MAX_LISTINGS = config.maxListings.toString();
    env.EP_JOB_ID = jobId;
  }

  return env;
}

export function buildScheduledEnqueueTelemetry(enqueuedCount: number): {
  lastRunStatus: null;
  lastError: string;
} {
  return {
    lastRunStatus: null,
    lastError: `Enqueued ${enqueuedCount} scraper job${enqueuedCount === 1 ? '' : 's'}; completion pending in scraper job history.`,
  };
}

export function cleanEdgePropPropertyTitle(title: string): string {
  const cleaned = title
    .replace(/\s*\|\s*EdgeProp.*$/i, '')
    .replace(/\s+(For Sale|For Rent)\s+at\s+S\$.*$/i, '')
    .replace(/\s+(Condominium|Apartment|HDB|Landed|Terrace)$/i, '')
    .trim();

  const widgetMatch = cleaned.match(/^(.*?)\s+Rental\s+Volume\s*:?\s+(?:\d[\d,]*(?:\.\d+)?%?|\d+)\s*(?:transactions|listings)?/i);
  if (widgetMatch?.[1]) return widgetMatch[1].trim();

  const gluedRentalVolume = cleaned.match(/^(.*\S)Rental\s+Volume$/i);
  if (gluedRentalVolume?.[1]) return gluedRentalVolume[1].trim();

  const gluedPercentage = cleaned.match(/^(.*\p{L})\d+(?:\.\d+)?%$/u);
  return (gluedPercentage?.[1] || cleaned).trim();
}

function hasConfirmedOutput(job: PersistedScraperJob): boolean {
  const stats = job.stats;
  if (typeof stats?.totalSuccess === 'number') return stats.totalSuccess > 0;
  if ((job.listingsProcessed ?? 0) > 0) return true;
  return stats?.confirmedEmpty === true && typeof stats.emptyReason === 'string' && stats.emptyReason.trim().length > 0;
}

function describeInvalidCompletion(job: PersistedScraperJob): string {
  if (job.status === 'failed' || job.status === 'cancelled') {
    return `Scraper child persisted ${job.status}${job.errorMessage ? `: ${job.errorMessage}` : ''}`;
  }

  if (job.status !== 'completed') {
    return `Scraper child exited without a completed persisted status (found ${job.status || 'unknown'})`;
  }

  return 'Scraper child exited with no confirmed output';
}

export async function settleScraperJobOutcome(
  dependencies: ScraperOutcomeDependencies
): Promise<{ acknowledged: true; status: 'completed' | 'failed' | 'cancelled' }> {
  try {
    await dependencies.run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ScraperProcessExitError && error.exitCode === 78) {
      const status = await dependencies.markFailed(`Operator action required: ${message}`);
      return { acknowledged: true, status };
    }

    const status = await dependencies.markFailed(message);
    if (status === 'cancelled') return { acknowledged: true, status };
    throw error;
  }

  const persisted = await dependencies.read();
  if (persisted.status === 'completed' && hasConfirmedOutput(persisted)) {
    return { acknowledged: true, status: 'completed' };
  }

  if (persisted.status === 'cancelled') {
    return { acknowledged: true, status: 'cancelled' };
  }

  const reason = describeInvalidCompletion(persisted);
  if (persisted.status !== 'failed') {
    const status = await dependencies.markFailed(reason);
    if (status === 'cancelled') return { acknowledged: true, status };
  }
  throw new Error(reason);
}
