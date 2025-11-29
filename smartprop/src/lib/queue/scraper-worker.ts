import { config } from 'dotenv';
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

// Load environment variables explicitly (needed when running as standalone process)
// This ensures env vars are available even when not running through Next.js
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  const missing = [];
  if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseServiceRole) missing.push('SUPABASE_SERVICE_ROLE');
  throw new Error(`Missing Supabase environment variables for scraper worker: ${missing.join(', ')}`);
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

    console.log(`[ScraperWorker] Spawning scraper process: ${command} ${args.join(' ')}`);
    console.log(`[ScraperWorker] Log file: ${logFile}`);
    
    const child = spawn(command, args, {
      cwd,
      env,
      detached: false,
      stdio: ['ignore', logFd, logFd],
    });

    child.on('error', (error) => {
      console.error(`[ScraperWorker] Failed to spawn scraper process:`, error);
      closeIfOpen(logFd);
      reject(error);
    });

    child.on('exit', (code, signal) => {
      closeIfOpen(logFd);
      if (code === 0) {
        console.log(`[ScraperWorker] Scraper process exited successfully`);
        resolve();
      } else {
        const errorMsg = `Scraper exited with code ${code ?? 'unknown'}${signal ? ` (signal: ${signal})` : ''}`;
        console.error(`[ScraperWorker] ${errorMsg}`);
        // Try to read the log file to get more details
        try {
          const logContent = fs.readFileSync(logFile, 'utf-8');
          const lastLines = logContent.split('\n').slice(-10).join('\n');
          console.error(`[ScraperWorker] Last 10 lines from ${logFile}:`);
          console.error(lastLines);
        } catch (logError) {
          console.error(`[ScraperWorker] Could not read log file:`, logError);
        }
        reject(new Error(errorMsg));
      }
    });
  });
}

async function handleScraperJob(job: Job<ScraperJobPayload> | null | Job<ScraperJobPayload>[]) {
  // Handle array of jobs (pg-boss may pass arrays)
  if (Array.isArray(job)) {
    if (job.length === 0) {
      console.log('[ScraperWorker] Received empty job array, skipping');
      return;
    }
    // Process first job in array
    job = job[0];
  }
  
  if (!job) {
    console.log('[ScraperWorker] Received null job, skipping');
    return;
  }
  
  const payload = job.data;
  
  // Validate payload structure
  if (!payload) {
    console.error('[ScraperWorker] Job has no data payload:', JSON.stringify(job, null, 2));
    throw new Error('Job payload is missing');
  }
  
  if (!payload.jobId) {
    console.error('[ScraperWorker] Job payload missing jobId:', JSON.stringify(payload, null, 2));
    throw new Error('Job payload missing jobId');
  }
  
  console.log(`[ScraperWorker] Processing job ${payload.jobId} for ${payload.platform}`);

  try {
    await updateJobStatus(payload.jobId, 'running');
    console.log(`[ScraperWorker] Updated job ${payload.jobId} to running status`);
  } catch (error) {
    console.error(`[ScraperWorker] Failed to update job status to running:`, error);
    throw error;
  }

  const heartbeat = startHeartbeat(payload.jobId);

  try {
    console.log(`[ScraperWorker] Starting scraper process for job ${payload.jobId}...`);
    await runScraperProcess(payload);
    console.log(`[ScraperWorker] Scraper process completed for job ${payload.jobId}`);
    await updateJobStatus(payload.jobId, 'completed');
    console.log(`[ScraperWorker] Updated job ${payload.jobId} to completed status`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ScraperWorker] Job ${payload.jobId} failed:`, message);
    if (error instanceof Error && error.stack) {
      console.error(`[ScraperWorker] Stack trace:`, error.stack);
    }
    try {
      await updateJobStatus(payload.jobId, 'failed', message);
    } catch (updateError) {
      console.error(`[ScraperWorker] Failed to update job status to failed:`, updateError);
    }
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
  const maxRetries = 5;
  const retryDelay = 5000; // 5 seconds
  let retries = 0;

  while (retries < maxRetries) {
    try {
      console.log(`[ScraperWorker] Attempting to start worker (attempt ${retries + 1}/${maxRetries})...`);
      
      const boss: PgBoss = await getBoss();
      await ensureScraperQueues(boss);

      // Process jobs one at a time
      // pg-boss v12 requires the callback to be a function that handles the job
      const workId = await boss.work<ScraperJobPayload>(
        SCRAPER_QUEUE_NAME,
        handleScraperJob
      );

      // DLQ tracker
      await boss.work<ScraperJobPayload>(
        SCRAPER_DLQ_NAME,
        async (job) => {
          if (!job) return;
          const payload = job.data;
          await updateJobStatus(payload.jobId, 'failed', 'Moved to DLQ after retries');
        }
      );

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

      console.log('[ScraperWorker] ✅ Started scraper worker successfully');
      
      // Set up error handlers for the boss instance
      boss.on('error', (error) => {
        console.error('[ScraperWorker] pg-boss error:', error);
        // Don't exit on error, let it retry
      });

      boss.on('warning', (warning) => {
        console.warn('[ScraperWorker] pg-boss warning:', warning);
      });

      // Success - break out of retry loop
      return;
    } catch (error) {
      retries++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ScraperWorker] ❌ Failed to start worker (attempt ${retries}/${maxRetries}):`, errorMessage);
      
      if (retries >= maxRetries) {
        console.error('[ScraperWorker] ❌ Max retries reached. Exiting...');
        throw new Error(`Failed to start scraper worker after ${maxRetries} attempts: ${errorMessage}`);
      }
      
      console.log(`[ScraperWorker] ⏳ Retrying in ${retryDelay / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

// Allow running directly with `bun src/lib/queue/scraper-worker.ts`
if (import.meta.url === `file://${path.join(process.cwd(), 'src/lib/queue/scraper-worker.ts')}`) {
  // Add unhandled error handlers
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[ScraperWorker] Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit - let PM2 handle restarts
  });

  process.on('uncaughtException', (error) => {
    console.error('[ScraperWorker] Uncaught Exception:', error);
    // Don't exit immediately - let PM2 handle restarts
    // But log the error for debugging
  });

  startScraperWorker().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[ScraperWorker] ❌ Failed to start worker:', errorMessage);
    console.error('[ScraperWorker] Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    
    // Wait a bit before exiting to allow logs to flush
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });
}
