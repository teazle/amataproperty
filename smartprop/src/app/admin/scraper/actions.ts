'use server'

import type { ScraperJobPayload } from '@/lib/queue/queue-types';
import { enqueueScraperJob } from '@/lib/queue/scraper-queue';
import { checkFlaresolverr,inspectAuthState } from '@/lib/scraper/runtime-health';
import { buildScraperStatusPayload,reconcileScraperRuntimeState,type DbClient } from '@/lib/scraper/runtime-state';
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import fs from 'fs';
import { revalidatePath } from 'next/cache';
import cron from 'node-cron';
import path from 'path';
import { promisify } from 'util';
import type { AuthStatus } from './types';

/**
 * Safely revalidate a path - only works in request context, fails silently in background jobs
 */
function safeRevalidatePath(path: string): void {
  try {
    revalidatePath(path);
  } catch (error) {
    // revalidatePath only works in request context (server actions called from UI)
    // When called from background jobs (scheduler), it will fail - that's expected
    // We can safely ignore this error
    if (error instanceof Error && (
      error.message.includes('revalidatePath') ||
      error.message.includes('static generation store') ||
      error.message.includes('during render')
    )) {
      // Expected error when called from background context - ignore
      return;
    }
    // Unexpected error - log it but don't throw
    console.warn(`[safeRevalidatePath] Failed to revalidate ${path}:`, error);
  }
}

const execAsync = promisify(exec);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  },
});
const runtimeDbClient = supabase as unknown as DbClient;

export interface ScraperConfig {
  platform: 'propertyguru' | 'edgeprop';
  district?: string; // For PropertyGuru only (D01-D28)
  pages: number;
  minPrice?: number;
  maxPrice?: number;
  maxListings?: number; // Optional: stop after scraping this many listings
}

export interface ScraperJobStatus {
  id: string;
  platform: string;
  status: string;
  currentDistrict?: string;
  currentPage?: number;
  totalPages?: number;
  listingsProcessed?: number;
  stats?: {
    saved: number;
    skipped: number;
    errors: number;
    phoneSuccessRate?: number;
  };
  startedAt: string;
  completedAt?: string;
  [key: string]: unknown;
  error?: string;
}

interface DistrictMetadata {
  district: string;
  last_scraped_at: string | null;
  total_listings: number;
  last_phone_success_rate: number | null;
  is_favorite: boolean;
}

interface QualityMetricsResult {
  success: boolean;
  error?: string;
  metrics: {
    completenessScore: number;
    phoneValidationRate: number;
    duplicatesToday: number;
    staleListings: number;
  };
}

interface CompletedRuntimeData {
  status?: string;
  startedAt: string;
  completedAt?: string;
  progress?: {
    listingsProcessed?: number;
    currentPage?: number;
    currentDistrict?: string | null;
  };
  stats?: Record<string, unknown> | null;
}

type JobUpdate = Record<string, unknown>;

function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

function parseRuntimeFile(filePath: string): CompletedRuntimeData | null {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<CompletedRuntimeData>;
  if (parsed.status !== 'completed' || !parsed.startedAt) {
    return null;
  }

  return {
    status: parsed.status,
    startedAt: parsed.startedAt,
    completedAt: parsed.completedAt,
    progress: parsed.progress,
    stats: parsed.stats,
  };
}

async function validateScraperRuntime(
  platform: ScraperConfig['platform']
): Promise<{ success: true } | { success: false; error: string }> {
  const authStatus = inspectAuthState(platform);
  const credentialNames =
    platform === 'propertyguru'
      ? ['PG_EMAIL', 'PG_PASSWORD']
      : ['EP_EMAIL', 'EP_PASSWORD'];
  const missingCredentials = credentialNames.filter((name) => !process.env[name]);

  if (!authStatus.isAuthenticated && missingCredentials.length > 0) {
    return {
      success: false,
      error: `No fresh ${platform} auth state found and missing ${missingCredentials.join(', ')}. Add credentials or run authentication first.`,
    };
  }

  const flaresolverrStatus = await checkFlaresolverr();
  if (!flaresolverrStatus.reachable) {
    return {
      success: false,
      error: `FlareSolverr is not reachable at ${flaresolverrStatus.url}: ${flaresolverrStatus.error ?? 'unknown error'}`,
    };
  }

  return { success: true };
}

/**
 * Start a new scraper job
 */
/**
 * Check and clean up stale lock files (lock file exists but process is dead)
 * Returns cleanup results
 */
async function _checkAndCleanStaleLocks(): Promise<{ cleaned: number; errors: string[] }> {
  const errors: string[] = [];
  let cleaned = 0;

  const platforms = ['propertyguru', 'edgeprop'] as const;

  for (const platform of platforms) {
    const lockFile = path.join(process.cwd(), 'storage',
      platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');

    if (!fs.existsSync(lockFile)) {
      continue; // No lock file, nothing to clean
    }

    try {
      const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      const pid = lockData.pid;

      if (!pid || typeof pid !== 'number') {
        // Lock file exists but no valid PID - stale lock
        console.log(`🧹 Cleaning stale lock file (no PID): ${lockFile}`);
        fs.unlinkSync(lockFile);
        cleaned++;

        // Also check if there's a job in database that should be marked as completed/failed
        const { data: jobs } = await supabase
          .from('scraper_jobs')
          .select('id, status')
          .eq('platform', platform)
          .in('status', ['queued', 'running'])
          .order('started_at', { ascending: false })
          .limit(1);

        if (jobs && jobs.length > 0) {
          // Mark as failed since lock file exists but no process
          await supabase
            .from('scraper_jobs')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: 'Lock file found but no process running - stale lock cleaned'
            })
            .eq('id', jobs[0].id);
        }
        continue;
      }

      // Check if process is actually running
      const isRunning = await isProcessRunning(pid);

      if (!isRunning) {
        // Process is dead but lock file exists - stale lock
        console.log(`🧹 Cleaning stale lock file (process ${pid} not running): ${lockFile}`);
        fs.unlinkSync(lockFile);
        cleaned++;

        // Mark corresponding job as failed
        const { data: jobs } = await supabase
          .from('scraper_jobs')
          .select('id, status')
          .eq('platform', platform)
          .in('status', ['queued', 'running'])
          .order('started_at', { ascending: false })
          .limit(1);

        if (jobs && jobs.length > 0) {
          await supabase
            .from('scraper_jobs')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: `Process ${pid} not running - stale lock cleaned`
            })
            .eq('id', jobs[0].id);
        }
      }
    } catch (error) {
      const errorMsg = `Error checking lock file ${lockFile}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(errorMsg);
      errors.push(errorMsg);

      // If we can't read the lock file, try to remove it anyway (might be corrupted)
      try {
        fs.unlinkSync(lockFile);
        cleaned++;
        console.log(`🧹 Removed corrupted lock file: ${lockFile}`);
      } catch (removeError) {
        errors.push(`Could not remove corrupted lock file ${lockFile}`);
      }
    }
  }

  return { cleaned, errors };
}

export async function startScrapeJob(
  config: ScraperConfig,
  source: ScraperJobPayload['source'] = 'manual'
) {
  try {
    // First, check and clean up any stale locks
    const cleanupResult = await reconcileScraperRuntimeState(runtimeDbClient);
    if (cleanupResult.cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleanupResult.cleaned} stale lock file(s)`);
    }

    // Validate config
    if (config.platform === 'propertyguru' && !config.district) {
      return {
        success: false,
        error: 'District is required for PropertyGuru scraper'
      };
    }

    if (config.platform === 'propertyguru') {
      // Validate district format
      const districtNum = config.district?.replace('D', '');
      const num = parseInt(districtNum || '0', 10);
      if (num < 1 || num > 28) {
        return {
          success: false,
          error: 'Invalid district. Must be D01-D28'
        };
      }
    }

    const runtimeValidation = await validateScraperRuntime(config.platform);
    if (!runtimeValidation.success) {
      return runtimeValidation;
    }

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from('scraper_jobs')
      .insert({
        platform: config.platform,
        status: 'queued',
        config: config,
        total_pages: config.pages * (config.platform === 'propertyguru' ? 1 : 1), // 1 district at a time
      })
      .select()
      .single();

    if (jobError) {
      throw jobError;
    }

    // Starvation guard: keep priorities close so scheduled jobs still run under manual load
    const priority = source === 'manual' ? 1 : source === 'scheduled' ? 3 : 5;
    const enqueueResult = await enqueueScraperJob({
      platform: config.platform,
      config: {
        district: config.district,
        pages: config.pages,
        maxListings: config.maxListings,
        minPrice: config.minPrice,
        maxPrice: config.maxPrice,
      },
      jobId: job.id,
      priority,
      source,
      idempotencyKey: job.id,
    });

    if (!enqueueResult.success) {
      await supabase
        .from('scraper_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: enqueueResult.error,
        })
        .eq('id', job.id);

      return {
        success: false,
        error: `Failed to enqueue scraper job: ${enqueueResult.error}`,
      };
    }

    safeRevalidatePath('/admin/scraper');

    return {
      success: true,
      jobId: job.id,
      message: `Queued scraper for ${config.platform}${config.district ? ` - District ${config.district}` : ''}`
    };

  } catch (error) {
    console.error('Error starting scraper:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error) || 'Failed to start scraper'
    };
  }
}

/**
 * Check if a process is actually running
 */
async function isProcessRunning(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`kill -0 ${pid}`, (error) => {
      resolve(!error); // Process exists if no error
    });
  });
}

// Cache to track last sync time and prevent excessive queries
const lastSyncCache = new Map<string, number>();
const SYNC_COOLDOWN = 10000; // Only sync once every 10 seconds per platform

/**
 * Get current active scraper job status
 */
export async function getActiveJob(): Promise<ScraperJobStatus | null> {
  try {
    const now = Date.now();

    if (now - (lastSyncCache.get('all') || 0) >= SYNC_COOLDOWN) {
      await reconcileScraperRuntimeState(runtimeDbClient);
      lastSyncCache.set('all', now);
    }

    const statusPayload = await buildScraperStatusPayload(runtimeDbClient, { reconcile: false });
    if (statusPayload.status !== 'active') return null;
    const job = statusPayload.job;

    return {
      id: job.id,
      platform: job.platform,
      status: job.status,
      currentDistrict: job.currentDistrict ?? undefined,
      currentPage: job.currentPage ?? undefined,
      totalPages: job.totalPages ?? undefined,
      listingsProcessed: job.listingsProcessed ?? undefined,
      stats: (job.stats ?? undefined) as ScraperJobStatus['stats'],
      startedAt: job.startedAt,
      error: job.error ?? undefined,
    };

  } catch (error) {
    console.error('Error getting active job:', error);
    return null;
  }
}

/**
 * Get scraper job history
 */
export async function getJobHistory(limit: number = 10) {
  try {
    const { data: jobs, error } = await supabase
      .from('scraper_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return { success: true, jobs: jobs || [] };

  } catch (error) {
    console.error('Error getting job history:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error), jobs: [] };
  }
}

/**
 * Get district metadata
 */
export async function getDistrictMetadata() {
  try {
    const { data: districts, error } = await supabase
      .from('district_metadata')
      .select('*')
      .order('district', { ascending: true });

    if (error) throw error;

    return { success: true, districts: (districts || []) as DistrictMetadata[] };

  } catch (error) {
    console.error('Error getting district metadata:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error), districts: [] };
  }
}

// Cache for quality metrics to reduce queries
let qualityMetricsCache: { data: QualityMetricsResult; timestamp: number } | null = null;
const QUALITY_METRICS_CACHE_TTL = 60000; // Cache for 60 seconds

/**
 * Get data quality metrics (with caching to reduce rate limits)
 */
export async function getDataQualityMetrics() {
  try {
    // Use cache if available and fresh
    const now = Date.now();
    if (qualityMetricsCache && (now - qualityMetricsCache.timestamp) < QUALITY_METRICS_CACHE_TTL) {
      return qualityMetricsCache.data;
    }

    // Get latest metrics for each platform
    const { data: _metrics, error } = await supabase
      .from('scraper_metrics')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(2);

    if (error) throw error;

    // Calculate stale listings (not seen in 7+ days) - use estimate to reduce query cost
    const { count: staleCount } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .lt('scraped_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    // Get today's duplicates (upserted listings)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: totalToday } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .gte('scraped_at', today.toISOString());

    // Calculate completeness score - reduce sample size to 50 instead of 100
    const { data: recentListings } = await supabase
      .from('listings')
      .select('*')
      .order('scraped_at', { ascending: false })
      .limit(50);

    let completenessScore = 0;
    let phoneValidationRate = 0;

    if (recentListings && recentListings.length > 0) {
      const requiredFields = ['address', 'price', 'beds', 'baths', 'size_sqft'];
      const optionalFields = ['price_psf', 'year_built', 'tenure', 'property_type'];

      let totalScore = 0;
      let phoneCount = 0;

      recentListings.forEach((listing: unknown) => {
        const listingObj = listing as Record<string, unknown>;
        let listingScore = 0;

        // Required fields: 70% weight
        requiredFields.forEach(field => {
          if (listingObj[field] != null) listingScore += (0.7 / requiredFields.length);
        });

        // Optional fields: 30% weight
        optionalFields.forEach(field => {
          if (listingObj[field] != null) listingScore += (0.3 / optionalFields.length);
        });

        totalScore += listingScore;
      });

      completenessScore = (totalScore / recentListings.length);

      // Get agents for these listings and check phone rate - only if we have listings
      const agentIds = recentListings.map((l: unknown) => (l as Record<string, unknown>).agent_id).filter(Boolean);
      if (agentIds.length > 0) {
        const { data: agents } = await supabase
          .from('agents')
          .select('phone')
          .in('id', agentIds);

        if (agents) {
          phoneCount = agents.filter(a => a.phone && a.phone.length > 0).length;
          phoneValidationRate = phoneCount / agents.length;
        }
      }
    }

    const result = {
      success: true,
      metrics: {
        completenessScore: Math.round(completenessScore * 100),
        phoneValidationRate: Math.round(phoneValidationRate * 100),
        duplicatesToday: totalToday || 0,
        staleListings: staleCount || 0
      }
    };

    // Cache the result
    qualityMetricsCache = { data: result, timestamp: now };

    return result;

  } catch (error) {
    console.error('Error getting data quality metrics:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      metrics: {
        completenessScore: 0,
        phoneValidationRate: 0,
        duplicatesToday: 0,
        staleListings: 0
      }
    };
  }
}

/**
 * Trigger re-authentication for a platform
 */
export async function triggerReAuth(platform: 'propertyguru' | 'edgeprop') {
  try {
    const cwd = path.join(process.cwd());
    const authScript = platform === 'propertyguru' ? 'auth.pg.ts' : 'auth.ep.ts';
    const cmd = `cd ${cwd} && bun src/workers/${authScript}`;

    await execAsync(cmd);

    return {
      success: true,
      message: `Re-authentication completed for ${platform}`
    };

  } catch (error) {
    console.error('Error re-authenticating:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error) || 'Re-authentication failed'
    };
  }
}

/**
 * Check authentication status by reading state files
 */
export async function checkAuthStatus() {
  try {
    const pgStatus = inspectAuthState('propertyguru');
    const epStatus = inspectAuthState('edgeprop');

    return {
      success: true,
      auth: {
        propertyguru: {
          exists: pgStatus.exists,
          isAuthenticated: pgStatus.isAuthenticated,
          isFresh: pgStatus.isFresh,
          cookieCount: pgStatus.cookieCount,
          lastModified: pgStatus.lastModified,
          lastAuth: pgStatus.lastModified,
          stateAgeHours: pgStatus.stateAgeHours,
          failureReason: pgStatus.failureReason,
        },
        edgeprop: {
          exists: epStatus.exists,
          isAuthenticated: epStatus.isAuthenticated,
          isFresh: epStatus.isFresh,
          cookieCount: epStatus.cookieCount,
          lastModified: epStatus.lastModified,
          lastAuth: epStatus.lastModified,
          stateAgeHours: epStatus.stateAgeHours,
          failureReason: epStatus.failureReason,
        }
      } satisfies AuthStatus
    };

  } catch (error) {
    console.error('Error checking auth status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      auth: {
        propertyguru: { exists: false, isAuthenticated: false, isFresh: false, cookieCount: 0, lastModified: null, lastAuth: null, stateAgeHours: null, failureReason: 'Auth check failed' },
        edgeprop: { exists: false, isAuthenticated: false, isFresh: false, cookieCount: 0, lastModified: null, lastAuth: null, stateAgeHours: null, failureReason: 'Auth check failed' }
      } satisfies AuthStatus
    };
  }
}

/**
 * Get recent listings
 */
export async function getRecentListings(limit: number = 5) {
  try {
    const { data: listings, error } = await supabase
      .from('listings')
      .select(`
        *,
        agents:agent_id (name, phone, agency)
      `)
      .order('scraped_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return { success: true, listings: listings || [] };

  } catch (error) {
    console.error('Error getting recent listings:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error), listings: [] };
  }
}

/**
 * Stop active scraper job
 */
export async function stopScraperJob() {
  try {
    // Find active jobs
    const { data: activeJobs } = await supabase
      .from('scraper_jobs')
      .select('id, platform')
      .in('status', ['queued', 'running'])
      .limit(1);

    if (!activeJobs || activeJobs.length === 0) {
      return {
        success: false,
        error: 'No active scraper jobs found'
      };
    }

    const job = activeJobs[0];

    // Try to get PID from lock file and kill the process
    let pid: number | null = null;
    const lockFile = path.join(process.cwd(), 'storage',
      job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');

    try {
      if (fs.existsSync(lockFile)) {
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
        pid = lockData.pid || null;
      }
    } catch (error) {
      console.log(`Could not read lock file for job ${job.id}:`, error);
    }

    // Always try pkill first (most reliable for detached processes)
    try {
      const { execSync } = await import('child_process');
      const scriptPattern = job.platform === 'propertyguru' ? 'pg.districts.ts' : 'ep.live.ts';
      // Kill processes matching the script and job ID
      execSync(`pkill -f "${scriptPattern}.*${job.id}" || pkill -f "${scriptPattern}" || true`, {
        stdio: 'ignore',
        timeout: 5000
      });
      console.log(`Used pkill to stop ${job.platform} scraper processes for job ${job.id}`);
    } catch (pkillError) {
      console.log(`pkill attempt failed: ${pkillError}`);
    }

    if (pid && typeof pid === 'number' && pid > 0) {
      try {
        // Try to kill the process and its children (process group)
        // On Linux, negative PID kills the process group
        try {
          process.kill(-pid, 'SIGTERM'); // Kill process group
          console.log(`Sent SIGTERM to process group ${pid} for job ${job.id}`);
        } catch (pgError) {
          // Fallback: try killing just the process
          try {
            process.kill(pid, 'SIGTERM');
            console.log(`Sent SIGTERM to process ${pid} for job ${job.id}`);
          } catch (killError) {
            console.log(`Process ${pid} may have already stopped`);
          }
        }

        // Wait a bit, then force kill if still running
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check if process is still running and force kill
        try {
          const { execSync } = await import('child_process');
          // Check if process exists
          try {
            execSync(`ps -p ${pid} > /dev/null 2>&1`);
            // Process still exists, force kill
            try {
              process.kill(-pid, 'SIGKILL');
              console.log(`Force killed process group ${pid}`);
            } catch {
              process.kill(pid, 'SIGKILL');
              console.log(`Force killed process ${pid}`);
            }
          } catch {
            // Process doesn't exist, already stopped
            console.log(`Process ${pid} already stopped`);
          }
        } catch (checkError) {
          console.log(`Could not check/kill process: ${checkError}`);
        }
      } catch (killError) {
        console.log(`Error killing process ${pid}: ${killError}`);
        // Try using kill command as fallback
        try {
          const { execSync } = await import('child_process');
          execSync(`pkill -f "ep.live.ts.*${job.id}" || true`, { stdio: 'ignore' });
          console.log(`Used pkill to stop scraper processes for job ${job.id}`);
        } catch (pkillError) {
          console.log(`Could not use pkill: ${pkillError}`);
        }
      }
    } else {
      // No PID in lock file, try to find and kill by process name
      try {
        const { execSync } = await import('child_process');
        execSync(`pkill -f "ep.live.ts.*${job.id}" || true`, { stdio: 'ignore' });
        console.log(`Used pkill to stop scraper processes for job ${job.id}`);
      } catch (pkillError) {
        console.log(`Could not use pkill: ${pkillError}`);
      }
    }

    // Update job status to failed
    const { error: updateError } = await supabase
      .from('scraper_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: 'Stopped by user'
      })
      .eq('id', job.id);

    if (updateError) throw updateError;

    // Remove lock file (already declared above)
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
      console.log(`Removed lock file: ${lockFile}`);
    }

    safeRevalidatePath('/admin/scraper');

    return {
      success: true,
      message: `Stopped ${job.platform} scraper job`
    };

  } catch (error) {
    console.error('Error stopping scraper:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Delete scraper job history
 */
export async function deleteScraperHistory() {
  try {
    // First, get all jobs that will be deleted
    const { data: jobsToDelete } = await supabase
      .from('scraper_jobs')
      .select('id')
      .in('status', ['completed', 'failed']);

    if (jobsToDelete && jobsToDelete.length > 0) {
      const jobIds = jobsToDelete.map(job => job.id);

      // Clear foreign key references in district_metadata before deleting
      const { error: updateError } = await supabase
        .from('district_metadata')
        .update({ last_job_id: null })
        .in('last_job_id', jobIds);

      if (updateError) {
        console.error('Error clearing foreign key references:', updateError);
        // Continue anyway - might not have any references
      }
    }

    // Now delete all completed and failed jobs
    const { error, data: _data } = await supabase
      .from('scraper_jobs')
      .delete()
      .in('status', ['completed', 'failed']);

    if (error) {
      // Handle Supabase PostgrestError
      const errorMessage = error.message || error.details || 'Failed to delete scraper history';
      console.error('Error deleting scraper history:', error);
      return {
        success: false,
        error: errorMessage
      };
    }

    safeRevalidatePath('/admin/scraper');

    return {
      success: true,
      message: 'Scraper history deleted successfully'
    };

  } catch (error) {
    console.error('Error deleting scraper history:', error);
    // Handle various error types
    let errorMessage = 'Failed to delete scraper history';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === 'object' && 'message' in error) {
      errorMessage = getErrorMessage(error, errorMessage);
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Delete specific scraper job
 */
export async function deleteScraperJob(jobId: string) {
  try {
    // First, clear foreign key references in district_metadata
    const { error: updateError } = await supabase
      .from('district_metadata')
      .update({ last_job_id: null })
      .eq('last_job_id', jobId);

    if (updateError) {
      console.error('Error clearing foreign key references:', updateError);
      // Continue anyway - might not have any references
    }

    // Now delete the job
    const { error } = await supabase
      .from('scraper_jobs')
      .delete()
      .eq('id', jobId);

    if (error) {
      // Handle Supabase PostgrestError
      const errorMessage = error.message || error.details || 'Failed to delete scraper job';
      console.error('Error deleting scraper job:', error);
      return {
        success: false,
        error: errorMessage
      };
    }

    safeRevalidatePath('/admin/scraper');

    return {
      success: true,
      message: 'Scraper job deleted successfully'
    };

  } catch (error) {
    console.error('Error deleting scraper job:', error);
    // Handle various error types
    let errorMessage = 'Failed to delete scraper job';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === 'object' && 'message' in error) {
      errorMessage = getErrorMessage(error, errorMessage);
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Force reset stuck jobs - marks all queued/running jobs as failed and removes lock files
 * Use this when jobs are stuck and can't be stopped normally
 */
export async function forceResetStuckJobs() {
  try {
    // Find all stuck jobs
    // Note: pid column may not exist in database, so we'll get it from lock files instead
    const { data: stuckJobs, error: queryError } = await supabase
      .from('scraper_jobs')
      .select('id, platform')
      .in('status', ['queued', 'running']);

    if (queryError) {
      console.error('Error querying stuck jobs:', queryError);
    }

    const jobsToReset = stuckJobs || [];
    const pidsToKill: Array<{ pid: number; jobId: string }> = [];

    // Collect PIDs and verify processes are actually running
    for (const job of jobsToReset) {
      let pid: number | null | undefined = null;

      // Try to get PID from lock file if not in database
      if (!pid) {
        try {
          const lockFile = path.join(process.cwd(), 'storage',
            job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');

          if (fs.existsSync(lockFile)) {
            const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
            pid = lockData.pid || null;
          }
        } catch (error) {
          console.log(`Could not read lock file for job ${job.id}:`, error);
        }
      }

      if (pid && typeof pid === 'number' && pid > 0) {
        // Verify process is actually running before adding to kill list
        const isRunning = await isProcessRunning(pid);
        if (isRunning) {
          pidsToKill.push({ pid, jobId: job.id });
        } else {
          console.log(`Process ${pid} for job ${job.id} is not running, will just clean up database and lock file`);
        }
      }
    }

    // Kill all processes that are actually running
    const killPromises = pidsToKill.map(({ pid, jobId }) => {
      return new Promise<void>((resolve) => {
        // Try SIGTERM first
        exec(`kill -TERM ${pid}`, async (error) => {
          if (error) {
            // Try SIGKILL if TERM fails
            exec(`kill -KILL ${pid}`, async () => {
              // Wait a moment and verify it's gone
              await new Promise(resolve => setTimeout(resolve, 500));
              const stillRunning = await isProcessRunning(pid);
              if (!stillRunning) {
                console.log(`Successfully killed process ${pid} for job ${jobId}`);
              }
              resolve();
            });
          } else {
            // Wait a moment and check if still running
            await new Promise(resolve => setTimeout(resolve, 1000));
            const stillRunning = await isProcessRunning(pid);
            if (stillRunning) {
              // Try SIGKILL
              exec(`kill -KILL ${pid}`, () => {
                console.log(`Sent SIGKILL to process ${pid} for job ${jobId}`);
                resolve();
              });
            } else {
              console.log(`Process ${pid} for job ${jobId} terminated successfully`);
              resolve();
            }
          }
        });
      });
    });

    // Wait for all kills to complete
    await Promise.all(killPromises);

    // Mark all stuck jobs as failed - update by specific job IDs for reliability
    if (jobsToReset.length > 0) {
      const jobIds = jobsToReset.map(job => job.id);

      // Update each job individually to ensure they all get updated
      let updateCount = 0;
      for (const jobId of jobIds) {
        // Try update without pid first (pid column may not exist)
        const updateData: JobUpdate = {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: 'Force reset by user - job was stuck'
        };

        const { error: updateError } = await supabase
          .from('scraper_jobs')
          .update(updateData)
          .eq('id', jobId);

        if (updateError) {
          console.error(`Error updating job ${jobId}:`, updateError);
        } else {
          updateCount++;
        }
      }

      console.log(`Successfully marked ${updateCount}/${jobsToReset.length} job(s) as failed`);

      // Wait a moment for database to propagate
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify the updates worked by checking the database multiple times
      let verificationAttempts = 0;
      const maxAttempts = 5;

      while (verificationAttempts < maxAttempts) {
        const { data: verifyJobs } = await supabase
          .from('scraper_jobs')
          .select('id, status')
          .in('id', jobIds);

        const stillActive = verifyJobs?.filter(j => j.status === 'queued' || j.status === 'running');

        if (!stillActive || stillActive.length === 0) {
          // All jobs successfully updated
          break;
        }

        console.warn(`Attempt ${verificationAttempts + 1}: ${stillActive.length} job(s) still show as active, retrying...`);

        // Force update again for jobs that are still active
        for (const job of stillActive) {
          const retryUpdateData: JobUpdate = {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: 'Force reset by user - job was stuck'
          };

          await supabase
            .from('scraper_jobs')
            .update(retryUpdateData)
            .eq('id', job.id);
        }

        // Wait before next verification
        await new Promise(resolve => setTimeout(resolve, 500));
        verificationAttempts++;
      }
    }

    // Remove all lock files
    const pgLockFile = path.join(process.cwd(), 'storage', 'pg-scraper.lock');
    const epLockFile = path.join(process.cwd(), 'storage', 'ep-scraper.lock');

    try {
      if (fs.existsSync(pgLockFile)) {
        fs.unlinkSync(pgLockFile);
        console.log('Removed PG lock file');
      }
    } catch (error) {
      console.error('Error removing PG lock file:', error);
    }

    try {
      if (fs.existsSync(epLockFile)) {
        fs.unlinkSync(epLockFile);
        console.log('Removed EP lock file');
      }
    } catch (error) {
      console.error('Error removing EP lock file:', error);
    }

    safeRevalidatePath('/admin/scraper');

    // Final verification - make sure no jobs are still active
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for final propagation

    const { data: finalCheck } = await supabase
      .from('scraper_jobs')
      .select('id, status')
      .in('status', ['queued', 'running']);
      // Check ALL active jobs, not just 10

    if (finalCheck && finalCheck.length > 0) {
      console.warn(`⚠️  Still found ${finalCheck.length} active job(s) after reset. Force updating individually...`);
      // Update each remaining job individually
      for (const job of finalCheck) {
        const finalUpdateData: JobUpdate = {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: 'Force reset by user - job was stuck'
        };

        await supabase
          .from('scraper_jobs')
          .update(finalUpdateData)
          .eq('id', job.id);
      }
    }

    // One final check to confirm all jobs are reset
    await new Promise(resolve => setTimeout(resolve, 500));
    const { data: ultimateCheck } = await supabase
      .from('scraper_jobs')
      .select('id, status, platform, started_at')
      .in('status', ['queued', 'running'])
      .limit(10);

    const finalActiveCount = ultimateCheck?.length || 0;
    if (finalActiveCount > 0) {
      console.error(`⚠️  CRITICAL: ${finalActiveCount} job(s) still active after all reset attempts.`);
      console.error('Stuck jobs:', JSON.stringify(ultimateCheck, null, 2));

      // Try one more time with even more aggressive approach - direct SQL update
      const stuckJobIds = ultimateCheck?.map(j => j.id) || [];

      // Try using RPC or direct update with explicit error handling
      for (const stuckJob of ultimateCheck || []) {
        try {
          // Try updating with explicit where clause (without pid field)
          const finalUpdateData: JobUpdate = {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: 'Force reset by user - job was stuck (final attempt)'
          };

          const { error: finalError, data: _finalData } = await supabase
            .from('scraper_jobs')
            .update(finalUpdateData)
            .eq('id', stuckJob.id)
            .eq('status', stuckJob.status) // Only update if status hasn't changed
            .select();

          if (finalError) {
            console.error(`Failed to update job ${stuckJob.id}:`, finalError);
          } else {
            console.log(`Successfully updated job ${stuckJob.id} in final attempt`);
          }
        } catch (err) {
          console.error(`Exception updating job ${stuckJob.id}:`, err);
        }
      }

      // One more verification after final attempt
      await new Promise(resolve => setTimeout(resolve, 1000));
      const { data: lastCheck } = await supabase
        .from('scraper_jobs')
        .select('id, status, platform')
        .in('id', stuckJobIds);

      const stillStuck = lastCheck?.filter(j => j.status === 'queued' || j.status === 'running') || [];

      if (stillStuck.length > 0) {
        const stuckJobDetails = stillStuck.map(j => ({
          id: j.id,
          platform: j.platform,
          status: j.status
        }));

        return {
          success: false,
          error: `${stillStuck.length} job(s) could not be reset after multiple attempts. Job IDs: ${stillStuck.map(j => j.id).join(', ')}. Try using the diagnostic function or check database manually.`,
          jobsReset: jobsToReset.length - stillStuck.length,
          stuckJobs: stuckJobDetails
        };
      }
    }

    return {
      success: true,
      message: `Reset ${jobsToReset.length} stuck job(s)`,
      jobsReset: jobsToReset.length
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error force resetting stuck jobs:', errorMsg);
    return {
      success: false,
      error: errorMsg || 'Unknown error occurred'
    };
  }
}

/**
 * Diagnose stuck jobs - returns detailed information about jobs that can't be reset
 */
export async function diagnoseStuckJobs() {
  try {
    // Get all active jobs
    const { data: activeJobs, error: queryError } = await supabase
      .from('scraper_jobs')
      .select('id, platform, status, started_at, error_message')
      .in('status', ['queued', 'running'])
      .order('started_at', { ascending: false });

    if (queryError) {
      return {
        success: false,
        error: `Error querying jobs: ${queryError.message}`,
        stuckJobs: []
      };
    }

    const stuckJobs = [];

    for (const job of activeJobs || []) {
      let pid: number | null | undefined = null;

      // Try to get PID from lock file
      try {
        const lockFile = path.join(process.cwd(), 'storage',
          job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');

        if (fs.existsSync(lockFile)) {
          const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
          pid = lockData.pid || pid;
        }
      } catch (error) {
        // Ignore lock file errors
      }

      let isProcessRunningValue = false;
      if (pid && typeof pid === 'number' && pid > 0) {
        isProcessRunningValue = await isProcessRunning(pid);
      }

      stuckJobs.push({
        id: job.id,
        platform: job.platform,
        status: job.status,
        startedAt: job.started_at,
        pid: pid,
        isProcessRunning: isProcessRunningValue,
        hasLockFile: fs.existsSync(path.join(process.cwd(), 'storage',
          job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock')),
        errorMessage: job.error_message,
        sqlFix: `UPDATE scraper_jobs SET status = 'failed', completed_at = NOW(), error_message = 'Manually fixed - job was stuck' WHERE id = '${job.id}';`
      });
    }

    return {
      success: true,
      stuckJobs: stuckJobs,
      count: stuckJobs.length
    };

  } catch (error) {
    console.error('Error diagnosing stuck jobs:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stuckJobs: []
    };
  }
}

/**
 * Force fix a specific stuck job by ID - uses multiple approaches
 */
export async function forceFixStuckJob(jobId: string) {
  try {
    // First, get the job details
    const { data: job, error: jobError } = await supabase
      .from('scraper_jobs')
      .select('id, platform, status')
      .eq('id', jobId)
      .maybeSingle();

    if (jobError) {
      // Handle 406 errors gracefully
      if (jobError.message?.includes('406') || jobError.code === 'PGRST116') {
        return {
          success: false,
          error: `Job ${jobId} not found (406 error)`
        };
      }
      return {
        success: false,
        error: `Job ${jobId} not found: ${jobError.message || 'Unknown error'}`
      };
    }

    if (!job) {
      return {
        success: false,
        error: `Job ${jobId} not found`
      };
    }

    // Kill process if PID exists and process is running
    // Get PID from lock file (pid column doesn't exist in database)
    let pid: number | null | undefined = null;

      try {
        const lockFile = path.join(process.cwd(), 'storage',
          job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');

        if (fs.existsSync(lockFile)) {
          const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
          pid = lockData.pid || null;
        }
      } catch (error) {
        // Ignore
    }

    if (pid && typeof pid === 'number' && pid > 0) {
      const processRunning = await isProcessRunning(pid);
      if (processRunning) {
        try {
          exec(`kill -TERM ${pid}`, async (error) => {
            if (error) {
              exec(`kill -KILL ${pid}`, () => {});
            } else {
              await new Promise(resolve => setTimeout(resolve, 1000));
              const stillRunning = await isProcessRunning(pid);
              if (stillRunning) {
                exec(`kill -KILL ${pid}`, () => {});
              }
            }
          });
        } catch (killError) {
          console.error(`Error killing process ${pid}:`, killError);
        }
      }
    }

    // Remove lock file
    try {
      const lockFile = path.join(process.cwd(), 'storage',
        job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');

      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
    } catch (lockError) {
      console.error('Error removing lock file:', lockError);
    }

    // Try multiple update approaches
    const updateData: JobUpdate = {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: 'Manually fixed - job was stuck'
    };

    // Only try to set pid if column might exist (will fail silently if it doesn't)
    try {
      updateData.pid = null;
    } catch (e) {
      // Ignore if pid column doesn't exist
    }

    // Approach 1: Standard update
    const { error: updateError } = await supabase
      .from('scraper_jobs')
      .update(updateData)
      .eq('id', jobId);

    if (updateError) {
      console.error('Standard update failed:', updateError);

      // Approach 2: Update without pid field
      const { pid: _, ...updateWithoutPid } = updateData;
      const { error: updateError2 } = await supabase
        .from('scraper_jobs')
        .update(updateWithoutPid)
        .eq('id', jobId);

      if (updateError2) {
        console.error('Update without pid also failed:', updateError2);
        return {
          success: false,
          error: `Could not update job. Database error: ${updateError2.message}. You may need to run SQL manually: UPDATE scraper_jobs SET status = 'failed', completed_at = NOW(), error_message = 'Manually fixed' WHERE id = '${jobId}';`,
          sqlFix: `UPDATE scraper_jobs SET status = 'failed', completed_at = NOW(), error_message = 'Manually fixed - job was stuck' WHERE id = '${jobId}';`
        };
      }
    }

    // Verify update worked
    await new Promise(resolve => setTimeout(resolve, 500));
    const { data: verifyJob, error: verifyError } = await supabase
      .from('scraper_jobs')
      .select('id, status')
      .eq('id', jobId)
      .maybeSingle();

    // Ignore 406 errors during verification (job might not exist anymore)
    if (verifyError && !verifyError.message?.includes('406') && verifyError.code !== 'PGRST116') {
      console.warn(`[forceFixStuckJob] Error verifying job ${jobId}:`, verifyError);
    }

    if (verifyJob && (verifyJob.status === 'queued' || verifyJob.status === 'running')) {
      return {
        success: false,
        error: `Job status still shows as '${verifyJob.status}' after update. This may indicate a database constraint issue. Please run SQL manually: UPDATE scraper_jobs SET status = 'failed', completed_at = NOW(), error_message = 'Manually fixed' WHERE id = '${jobId}';`,
        sqlFix: `UPDATE scraper_jobs SET status = 'failed', completed_at = NOW(), error_message = 'Manually fixed - job was stuck' WHERE id = '${jobId}';`
      };
    }

    safeRevalidatePath('/admin/scraper');

    return {
      success: true,
      message: `Successfully fixed stuck job ${jobId}`
    };

  } catch (error) {
    console.error('Error force fixing stuck job:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Sync completed.json files with database
 * This fixes cases where scraper completed successfully but database update failed
 */
export async function syncCompletedJobs() {
  try {
    const storageDir = path.join(process.cwd(), 'storage');
    const completedFiles: Array<{ platform: 'propertyguru' | 'edgeprop'; data: CompletedRuntimeData }> = [];

    // Check for completed.json files
    const pgCompletedFile = path.join(storageDir, 'pg-scraper.completed.json');
    const epCompletedFile = path.join(storageDir, 'ep-scraper.completed.json');

    if (fs.existsSync(pgCompletedFile)) {
      try {
        const data = parseRuntimeFile(pgCompletedFile);
        if (data) {
          completedFiles.push({ platform: 'propertyguru', data });
        }
      } catch (error) {
        console.error('Error reading pg-scraper.completed.json:', error);
      }
    }

    if (fs.existsSync(epCompletedFile)) {
      try {
        const data = parseRuntimeFile(epCompletedFile);
        if (data) {
          completedFiles.push({ platform: 'edgeprop', data });
        }
      } catch (error) {
        console.error('Error reading ep-scraper.completed.json:', error);
      }
    }

    if (completedFiles.length === 0) {
      return {
        success: true,
        message: 'No completed.json files found',
        synced: 0
      };
    }

    let syncedCount = 0;
    const errors: string[] = [];

    for (const { platform, data } of completedFiles) {
      try {
        // Find matching job by platform and started_at time (within 1 hour window)
        const startedAt = new Date(data.startedAt);
        const windowStart = new Date(startedAt.getTime() - 60 * 60 * 1000); // 1 hour before
        const windowEnd = new Date(startedAt.getTime() + 60 * 60 * 1000); // 1 hour after

        const { data: matchingJobs, error: queryError } = await supabase
          .from('scraper_jobs')
          .select('id, status, started_at')
          .eq('platform', platform)
          .in('status', ['running', 'queued'])
          .gte('started_at', windowStart.toISOString())
          .lte('started_at', windowEnd.toISOString())
          .order('started_at', { ascending: false })
          .limit(1);

        if (queryError) {
          errors.push(`Error querying jobs for ${platform}: ${queryError.message}`);
          continue;
        }

        if (!matchingJobs || matchingJobs.length === 0) {
          // No matching job found - might already be updated or job ID mismatch
          console.log(`No matching running job found for ${platform} completed.json (started: ${data.startedAt})`);
          continue;
        }

        const job = matchingJobs[0];

        // Update job to completed status
        const updateData: JobUpdate = {
          status: 'completed',
          completed_at: data.completedAt || new Date().toISOString(),
          listings_processed: data.progress?.listingsProcessed || data.stats?.totalSuccess || 0,
          stats: data.stats || null,
          current_page: data.progress?.currentPage || null,
          current_district: data.progress?.currentDistrict || null
        };

        const { error: updateError } = await supabase
          .from('scraper_jobs')
          .update(updateData)
          .eq('id', job.id);

        if (updateError) {
          errors.push(`Error updating job ${job.id} for ${platform}: ${updateError.message}`);
        } else {
          syncedCount++;
          console.log(`✅ Synced completed job ${job.id} for ${platform}`);
        }
      } catch (error) {
        errors.push(`Error processing ${platform} completed.json: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    safeRevalidatePath('/admin/scraper');

    return {
      success: syncedCount > 0 || errors.length === 0,
      message: syncedCount > 0
        ? `Synced ${syncedCount} completed job(s) from completed.json files`
        : 'No jobs needed syncing',
      synced: syncedCount,
      errors: errors.length > 0 ? errors : undefined
    };

  } catch (error) {
    console.error('Error syncing completed jobs:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      synced: 0
    };
  }
}

// ============================================================
// Scheduled Jobs Management
// ============================================================

export interface ScheduledJob {
  id: string;
  name: string;
  platform: 'propertyguru' | 'edgeprop';
  cron_expression: string;
  timezone: string;
  config: {
    districts?: string[];
    pages: number;
  };
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_status: 'success' | 'failed' | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get all scheduled jobs
 */
export async function getScheduledJobs(): Promise<ScheduledJob[]> {
  try {
    const { data: jobs, error } = await supabase
      .from('scheduled_jobs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      // Check for rate limit errors
      if (error.message?.includes('rate limit') || error.message?.includes('quota') || error.message?.includes('exceeded')) {
        console.warn('Rate limit hit when fetching scheduled jobs. Returning empty array.');
        return [];
      }
      console.error('Error fetching scheduled jobs:', error);
      return [];
    }

    return (jobs || []) as ScheduledJob[];
  } catch (error) {
    // Check for rate limit errors
    const message = getErrorMessage(error, '');
    if (message.includes('rate limit') || message.includes('quota') || message.includes('exceeded')) {
      console.warn('Rate limit exception when fetching scheduled jobs.');
      return [];
    }
    console.error('Error fetching scheduled jobs:', error);
    return [];
  }
}

/**
 * Create a new scheduled job
 */
export async function createScheduledJob(job: {
  name: string;
  platform: 'propertyguru' | 'edgeprop';
  cron_expression: string;
  timezone?: string;
  config: {
    districts?: string[];
    pages: number;
  };
  enabled?: boolean;
}): Promise<{ success: boolean; job?: ScheduledJob; error?: string }> {
  try {
    // Validate cron expression
    if (!cron.validate(job.cron_expression)) {
      return {
        success: false,
        error: `Invalid cron expression: ${job.cron_expression}`,
      };
    }

    // Calculate next run time
    const tempTask = cron.schedule(job.cron_expression, () => {}, {
      timezone: job.timezone || 'Asia/Singapore',
      name: 'temp',
    });
    const nextRun = tempTask.getNextRun() || new Date();
    tempTask.destroy();

    const { data, error } = await supabase
      .from('scheduled_jobs')
      .insert({
        name: job.name,
        platform: job.platform,
        cron_expression: job.cron_expression,
        timezone: job.timezone || 'Asia/Singapore',
        config: job.config,
        enabled: job.enabled !== undefined ? job.enabled : true,
        next_run_at: nextRun.toISOString(),
      })
      .select()
      .single();

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    // Reload scheduler
    try {
      const { reloadScheduler } = await import('@/lib/scheduler/scraper-scheduler');
      await reloadScheduler();
    } catch (reloadError) {
      console.error('Failed to reload scheduler:', reloadError);
    }

    safeRevalidatePath('/admin/scraper');

    return {
      success: true,
      job: data as ScheduledJob,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Update a scheduled job
 */
export async function updateScheduledJob(
  id: string,
  updates: Partial<{
    name: string;
    platform: 'propertyguru' | 'edgeprop';
    cron_expression: string;
    timezone: string;
    config: {
      districts?: string[];
      pages: number;
    };
    enabled: boolean;
  }>
): Promise<{ success: boolean; job?: ScheduledJob; error?: string }> {
  try {
    // Validate cron expression if provided
    if (updates.cron_expression) {
      if (!cron.validate(updates.cron_expression)) {
        return {
          success: false,
          error: `Invalid cron expression: ${updates.cron_expression}`,
        };
      }
    }

    // Get existing job to calculate next run time
    const { data: existingJob, error: existingJobError } = await supabase
      .from('scheduled_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (existingJobError) {
      // Handle 406 errors gracefully
      if (existingJobError.message?.includes('406') || existingJobError.code === 'PGRST116') {
        return {
          success: false,
          error: 'Scheduled job not found (406 error)',
        };
      }
      return {
        success: false,
        error: `Error fetching scheduled job: ${existingJobError.message}`,
      };
    }

    if (!existingJob) {
      return {
        success: false,
        error: 'Scheduled job not found',
      };
    }

    // Calculate next run time if cron or timezone changed
    const updateData: Record<string, unknown> = { ...updates };
    if (updates.cron_expression || updates.timezone) {
      const finalCron = updates.cron_expression || existingJob.cron_expression;
      const finalTimezone = updates.timezone || existingJob.timezone;
      const tempTask = cron.schedule(finalCron, () => {}, {
        timezone: finalTimezone,
        name: 'temp',
      });
      const nextRun = tempTask.getNextRun() || new Date();
      tempTask.destroy();
      updateData.next_run_at = nextRun.toISOString();
    }

    const { data, error } = await supabase
      .from('scheduled_jobs')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    // Reload scheduler
    try {
      const { reloadScheduler } = await import('@/lib/scheduler/scraper-scheduler');
      await reloadScheduler();
    } catch (reloadError) {
      console.error('Failed to reload scheduler:', reloadError);
    }

    safeRevalidatePath('/admin/scraper');

    return {
      success: true,
      job: data as ScheduledJob,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Delete a scheduled job
 */
export async function deleteScheduledJob(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Remove from scheduler
    const { getScheduler } = await import('@/lib/scheduler/scraper-scheduler');
    const scheduler = getScheduler();
    scheduler.removeSchedule(id);

    // Delete from database
    const { error } = await supabase
      .from('scheduled_jobs')
      .delete()
      .eq('id', id);

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    safeRevalidatePath('/admin/scraper');

    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Toggle scheduled job enabled/disabled
 */
export async function toggleScheduledJob(id: string, enabled: boolean): Promise<{ success: boolean; job?: ScheduledJob; error?: string }> {
  return updateScheduledJob(id, { enabled });
}

/**
 * Reload scheduler
 */
export async function reloadScheduler(): Promise<{ success: boolean; error?: string }> {
  try {
    const { reloadScheduler: reload } = await import('@/lib/scheduler/scraper-scheduler');
    await reload();
    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
