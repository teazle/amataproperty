import { createClient } from '@supabase/supabase-js';
import { PgBoss, type Job } from 'pg-boss';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  SCRAPER_QUEUE_NAME,
  type ScraperJobPayload,
  SCRAPER_DLQ_NAME,
} from './queue-types';
import { ensureScraperQueues, getBoss, stopBoss } from './scraper-queue';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  throw new Error('Missing Supabase environment variables for scraper worker');
}

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  db: { schema: 'public' },
  global: {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  },
});

async function updateJobStatus(
  jobId: string,
  status: 'running' | 'completed' | 'failed',
  error?: string
) {
  const updates: Record<string, unknown> = {
    status,
    error_message: error ?? null,
  };

  if (status === 'running') {
    updates.started_at = new Date().toISOString();
    updates.completed_at = null;
  }

  if (status === 'completed') {
    updates.completed_at = new Date().toISOString();
  }

  if (status === 'failed') {
    updates.completed_at = new Date().toISOString();
  }

  await supabase.from('scraper_jobs').update(updates).eq('id', jobId);
}

function closeIfOpen(fd: number | undefined) {
  if (fd === undefined) return;
  try {
    fs.closeSync(fd);
  } catch {
    // ignore
  }
}

function runScraperProcess(payload: ScraperJobPayload): Promise<void> {
  const { platform, config, jobId } = payload;

  return new Promise((resolve, reject) => {
    const cwd = process.cwd();
    const homeDir = process.env.HOME || '/home/ec2-user';
    const bunPath = process.env.BUN_PATH || `${homeDir}/.bun/bin/bun`;
    const isLinux = process.platform === 'linux';

    const logFile =
      platform === 'propertyguru'
        ? `/tmp/pg-scraper-${jobId}.log`
        : `/tmp/ep-scraper-${jobId}.log`;

    let logFd: number | undefined;
    try {
      logFd = fs.openSync(logFile, 'a');
    } catch (error) {
      return reject(error);
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${homeDir}/.bun/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
      HOME: homeDir,
      HEADLESS: 'true',
      NODE_ENV: process.env.NODE_ENV || 'production',
    };

    if (platform === 'propertyguru') {
      const district = config.district?.replace('D', '') || '';
      env.PG_DISTRICTS = district;
      env.PG_MAX_PAGES = config.pages.toString();
      if (config.maxListings) env.PG_MAX_LISTINGS = config.maxListings.toString();
      env.PG_JOB_ID = jobId;
    } else {
      env.EP_MAX_PAGES = config.pages.toString();
      if (config.maxListings) env.EP_MAX_LISTINGS = config.maxListings.toString();
      env.EP_JOB_ID = jobId;
    }

    const command = isLinux ? 'xvfb-run' : bunPath;
    const args =
      platform === 'propertyguru'
        ? isLinux
          ? ['-a', bunPath, 'src/workers/pg.districts.ts']
          : ['src/workers/pg.districts.ts']
        : isLinux
          ? ['-a', bunPath, 'src/workers/ep.live.ts']
          : ['src/workers/ep.live.ts'];

    const child = spawn(command, args, {
      cwd,
      env,
      detached: false,
      stdio: ['ignore', logFd, logFd],
    });

    child.on('error', (error) => {
      closeIfOpen(logFd);
      reject(error);
    });

    child.on('exit', (code, signal) => {
      closeIfOpen(logFd);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Scraper exited with code ${code ?? 'unknown'}${signal ? ` (signal: ${signal})` : ''}`
          )
        );
      }
    });
  });
}

async function handleScraperJob(job: Job<ScraperJobPayload>) {
  const payload = job.data;

  await updateJobStatus(payload.jobId, 'running');
  const heartbeat = startHeartbeat(payload.jobId);

  try {
    await runScraperProcess(payload);
    await updateJobStatus(payload.jobId, 'completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateJobStatus(payload.jobId, 'failed', message);
    throw error;
  } finally {
    heartbeat.stop();
  }
}

function startHeartbeat(jobId: string) {
  const intervalMs = Number(process.env.SCRAPER_HEARTBEAT_MS || 30000);
  if (!intervalMs) {
    return { stop: () => {} };
  }
  let disabled = false;
  const timer = setInterval(async () => {
    if (disabled) return;
    try {
      await supabase
        .from('scraper_jobs')
        .update({ heartbeat_at: new Date().toISOString() })
        .eq('id', jobId);
    } catch (error) {
      console.warn('[ScraperWorker] Heartbeat failed', error);
      // If heartbeat_at column doesn't exist, disable further heartbeats to avoid log spam
      disabled = true;
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}

export async function startScraperWorker(): Promise<void> {
  const boss: PgBoss = await getBoss();
  await ensureScraperQueues(boss);

  // When batchSize is used, callback receives array of jobs
  const workId = await boss.work<ScraperJobPayload>(
    SCRAPER_QUEUE_NAME,
    { batchSize: 1 },
    async ([job]) => {
      if (!job) return;
      await handleScraperJob(job);
    }
  );

  // DLQ tracker (no batchSize, receives single job)
  await boss.work<ScraperJobPayload>(SCRAPER_DLQ_NAME, async (job) => {
    if (!job) return;
    const payload = job.data;
    await updateJobStatus(payload.jobId, 'failed', 'Moved to DLQ after retries');
  });

  const shutdown = async () => {
    try {
      await boss.offWork(workId, { wait: true });
    } catch (error) {
      console.warn('[ScraperWorker] Error stopping worker', error);
    } finally {
      await stopBoss({ graceful: true, timeout: 10000 });
      process.exit(0);
    }
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  console.log('[ScraperWorker] Started scraper worker');
}

// Allow running directly with `bun src/lib/queue/scraper-worker.ts`
if (import.meta.url === `file://${path.join(process.cwd(), 'src/lib/queue/scraper-worker.ts')}`) {
  startScraperWorker().catch((error) => {
    console.error('[ScraperWorker] Failed to start worker', error);
    process.exit(1);
  });
}
