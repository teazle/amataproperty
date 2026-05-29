import fs from 'fs';
import path from 'path';
import type { ScraperPlatform } from './runtime-health';
import { normalizeCompletionStatus } from './runtime-health';

export type DbClient = {
  from: (table: string) => DbQueryBuilder;
};

type DbQueryBuilder = {
  select: (columns?: string, options?: { head?: boolean; count?: 'exact' | 'planned' | 'estimated' }) => DbFilterQuery;
  update: (values: object) => DbFilterQuery;
};

type DbFilterQuery = PromiseLike<{ data?: unknown | null; error?: unknown }> & {
  eq: (column: string, value: unknown) => DbFilterQuery;
  in: (column: string, values: readonly unknown[]) => DbFilterQuery;
  gte: (column: string, value: unknown) => DbFilterQuery;
  lt: (column: string, value: unknown) => DbFilterQuery;
  lte: (column: string, value: unknown) => DbFilterQuery;
  order: (column: string, options?: { ascending?: boolean }) => DbFilterQuery;
  limit: (count: number) => DbFilterQuery;
};

type RuntimeProgress = {
  currentDistrict?: string | null;
  currentPage?: number | null;
  listingsProcessed?: number | null;
};

type RuntimeFileData = {
  status?: string;
  statusMessage?: string;
  startedAt?: string;
  completedAt?: string;
  jobId?: string | null;
  pid?: number;
  progress?: RuntimeProgress;
  stats?: Record<string, unknown> | null;
};

type ScraperJobRow = {
  id: string;
  platform: ScraperPlatform;
  status: string;
  config?: Record<string, unknown> | null;
  started_at: string;
  completed_at?: string | null;
  total_pages?: number | null;
  current_district?: string | null;
  current_page?: number | null;
  listings_processed?: number | null;
  stats?: Record<string, unknown> | null;
  error_message?: string | null;
};

export type RuntimeReconcileResult = {
  cleaned: number;
  synced: number;
  errors: string[];
};

export type ScraperRuntimeStatusPayload =
  | { status: 'idle' }
  | {
      status: 'active';
      job: {
        id: string;
        platform: ScraperPlatform;
        status: string;
        config?: Record<string, unknown> | null;
        currentDistrict?: string | null;
        currentPage?: number | null;
        listingsProcessed?: number | null;
        totalPages?: number | null;
        stats?: Record<string, unknown> | null;
        startedAt: string;
        statusMessage: string;
        error?: string | null;
      };
    };

const PLATFORMS: ScraperPlatform[] = ['propertyguru', 'edgeprop'];

export function getScraperLockFile(platform: ScraperPlatform, cwd: string = process.cwd()): string {
  return path.join(cwd, 'storage', platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');
}

export function getScraperCompletedFile(platform: ScraperPlatform, cwd: string = process.cwd()): string {
  return getScraperLockFile(platform, cwd).replace('.lock', '.completed.json');
}

export function readRuntimeFile(filePath: string): RuntimeFileData | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RuntimeFileData;
  } catch {
    return null;
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function findLatestActiveJob(db: DbClient, platform: ScraperPlatform): Promise<ScraperJobRow | null> {
  const { data } = await db
    .from('scraper_jobs')
    .select('*')
    .eq('platform', platform)
    .in('status', ['queued', 'running'])
    .order('started_at', { ascending: false })
    .limit(1);

  return (data as ScraperJobRow[] | null | undefined)?.[0] ?? null;
}

async function updateCompletedFromFile(
  db: DbClient,
  platform: ScraperPlatform,
  completedData: RuntimeFileData
): Promise<boolean> {
  const finalStatus = normalizeCompletionStatus(
    completedData.status,
    completedData.status === 'failed' ? 'failed' : 'completed'
  );

  const updates = {
    status: finalStatus,
    completed_at: completedData.completedAt || new Date().toISOString(),
    listings_processed: completedData.progress?.listingsProcessed || completedData.stats?.totalSuccess || 0,
    stats: completedData.stats || null,
    current_page: completedData.progress?.currentPage || null,
    current_district: completedData.progress?.currentDistrict || null,
    error_message: finalStatus === 'failed' ? completedData.statusMessage || 'Scraper failed' : null,
  };

  if (completedData.jobId) {
    const { error } = await db
      .from('scraper_jobs')
      .update(updates)
      .eq('id', completedData.jobId);
    return !error;
  }

  if (!completedData.startedAt) {
    return false;
  }

  const startedAt = new Date(completedData.startedAt);
  const windowStart = new Date(startedAt.getTime() - 60 * 60 * 1000);
  const windowEnd = new Date(startedAt.getTime() + 60 * 60 * 1000);

  const { data: matchingJobs } = await db
    .from('scraper_jobs')
    .select('id, status')
    .eq('platform', platform)
    .in('status', ['running', 'queued'])
    .gte('started_at', windowStart.toISOString())
    .lte('started_at', windowEnd.toISOString())
    .order('started_at', { ascending: false })
    .limit(1);

  const job = (matchingJobs as Pick<ScraperJobRow, 'id' | 'status'>[] | null | undefined)?.[0];
  if (!job) {
    return false;
  }

  const { error } = await db.from('scraper_jobs').update(updates).eq('id', job.id);
  return !error;
}

async function failStaleJobsWithoutRuntime(
  db: DbClient,
  platform: ScraperPlatform
): Promise<number> {
  const staleAfterHours = Number(process.env.SCRAPER_STALE_JOB_HOURS || 8);
  const cutoff = new Date(Date.now() - staleAfterHours * 60 * 60 * 1000).toISOString();

  const { data: staleJobs } = await db
    .from('scraper_jobs')
    .select('id, status')
    .eq('platform', platform)
    .in('status', ['queued', 'running'])
    .lt('started_at', cutoff);

  const staleJobRows = staleJobs as Pick<ScraperJobRow, 'id' | 'status'>[] | null | undefined;
  if (!staleJobRows || staleJobRows.length === 0) {
    return 0;
  }

  const { error } = await db
    .from('scraper_jobs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: `No active scraper runtime found after ${staleAfterHours} hours - stale job reconciled`,
    })
    .in('id', staleJobRows.map((job) => job.id));

  return error ? 0 : staleJobRows.length;
}

export async function reconcileScraperRuntimeState(
  db: DbClient,
  options?: {
    cwd?: string;
    platforms?: ScraperPlatform[];
  }
): Promise<RuntimeReconcileResult> {
  const cwd = options?.cwd ?? process.cwd();
  const platforms = options?.platforms ?? PLATFORMS;
  const result: RuntimeReconcileResult = { cleaned: 0, synced: 0, errors: [] };

  for (const platform of platforms) {
    const lockFile = getScraperLockFile(platform, cwd);
    const completedFile = getScraperCompletedFile(platform, cwd);

    try {
      if (fs.existsSync(completedFile) && !fs.existsSync(lockFile)) {
        const completedData = readRuntimeFile(completedFile);
        if (completedData && await updateCompletedFromFile(db, platform, completedData)) {
          result.synced++;
        }
      }

      if (!fs.existsSync(lockFile)) {
        result.synced += await failStaleJobsWithoutRuntime(db, platform);
        continue;
      }

      const lockData = readRuntimeFile(lockFile);
      const pid = lockData?.pid;

      if (!pid || typeof pid !== 'number' || !isProcessRunning(pid)) {
        fs.unlinkSync(lockFile);
        result.cleaned++;

        const activeJob = await findLatestActiveJob(db, platform);
        if (activeJob) {
          await db
            .from('scraper_jobs')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: pid
                ? `Process ${pid} not running - stale lock cleaned`
                : 'Invalid scraper lock file - stale lock cleaned',
            })
            .eq('id', activeJob.id);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${platform}: ${message}`);

      if (fs.existsSync(lockFile)) {
        try {
          fs.unlinkSync(lockFile);
          result.cleaned++;
        } catch (removeError) {
          result.errors.push(`${platform}: could not remove lock file: ${String(removeError)}`);
        }
      }
    }
  }

  return result;
}

async function getActiveJobs(db: DbClient): Promise<ScraperJobRow[]> {
  const { data } = await db
    .from('scraper_jobs')
    .select('*')
    .in('status', ['queued', 'running'])
    .order('started_at', { ascending: false });

  return (data as ScraperJobRow[] | null | undefined) ?? [];
}

function readJobRuntime(job: ScraperJobRow, cwd: string): {
  progress: RuntimeProgress;
  statusMessage: string;
  stats: Record<string, unknown> | null | undefined;
} {
  const lockFile = getScraperLockFile(job.platform, cwd);
  const completedFile = getScraperCompletedFile(job.platform, cwd);
  const runtimeData = readRuntimeFile(lockFile) ?? readRuntimeFile(completedFile);

  return {
    progress: runtimeData?.progress ?? {
      currentDistrict: job.current_district,
      currentPage: job.current_page,
      listingsProcessed: job.listings_processed,
    },
    statusMessage: runtimeData?.statusMessage || 'Scraping...',
    stats: runtimeData?.stats || job.stats,
  };
}

export async function buildScraperStatusPayload(
  db: DbClient,
  options?: {
    cwd?: string;
    reconcile?: boolean;
  }
): Promise<ScraperRuntimeStatusPayload> {
  const cwd = options?.cwd ?? process.cwd();

  if (options?.reconcile !== false) {
    await reconcileScraperRuntimeState(db, { cwd });
  }

  const activeJobs = await getActiveJobs(db);
  if (activeJobs.length === 0) {
    return { status: 'idle' };
  }

  let selectedJob = activeJobs[0];
  for (const job of activeJobs) {
    const lockData = readRuntimeFile(getScraperLockFile(job.platform, cwd));
    if (lockData?.pid && isProcessRunning(lockData.pid)) {
      selectedJob = job;
      break;
    }
  }

  const runtime = readJobRuntime(selectedJob, cwd);

  return {
    status: 'active',
    job: {
      id: selectedJob.id,
      platform: selectedJob.platform,
      status: selectedJob.status,
      config: selectedJob.config,
      ...runtime.progress,
      totalPages: selectedJob.total_pages,
      stats: runtime.stats,
      startedAt: selectedJob.started_at,
      statusMessage: runtime.statusMessage,
      error: selectedJob.error_message,
    },
  };
}
