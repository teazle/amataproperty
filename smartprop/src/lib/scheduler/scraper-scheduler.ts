/**
 * Scraper Scheduler Service
 * Manages scheduled scraper jobs using node-cron
 */

import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { createClient } from '@supabase/supabase-js';
// Import startScrapeJob dynamically to avoid circular dependencies
// We'll import it when needed in the executeJob method

// Create Supabase client lazily to ensure env vars are loaded
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE are required');
  }
  
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
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
}

interface ScheduledJob {
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
}

class ScraperScheduler {
  private jobs: Map<string, ScheduledTask> = new Map();
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Initialize the scheduler by loading all enabled schedules from database
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[Scheduler] Already initialized');
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize();
    await this.initializationPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      console.log('[Scheduler] Initializing...');

      // Skip in Edge runtime
      if (process.env.NEXT_RUNTIME === 'edge') {
        console.log('[Scheduler] Skipping initialization in Edge runtime');
        return;
      }

      // Check environment variables
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
        console.error('[Scheduler] Missing Supabase environment variables');
        console.error('[Scheduler] NEXT_PUBLIC_SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
        console.error('[Scheduler] SUPABASE_SERVICE_ROLE:', !!process.env.SUPABASE_SERVICE_ROLE);
        // Don't throw - allow graceful degradation
        console.warn('[Scheduler] Will retry initialization when environment is available');
        return;
      }

      // Try to load enabled schedules from database
      // If this fails (e.g., rate limits), we'll initialize with empty schedules and allow manual reload
      let schedules: ScheduledJob[] = [];
      
      try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
          .from('scheduled_jobs')
          .select('*')
          .eq('enabled', true);

        if (error) {
          // Check if it's a rate limit error
          if (error.message?.includes('rate limit') || error.message?.includes('quota') || error.message?.includes('exceeded')) {
            console.warn('[Scheduler] Rate limit hit when loading schedules. Will retry later or use manual reload.');
            console.warn('[Scheduler] Scheduler initialized with empty schedules. Use /api/scheduler/reload to load schedules manually.');
          } else {
            console.error('[Scheduler] Error loading schedules:', error.message || error);
          }
          // Don't throw - allow graceful degradation
          schedules = [];
        } else {
          schedules = (data || []) as ScheduledJob[];
        }
      } catch (error: any) {
        // Check if it's a rate limit error
        if (error?.message?.includes('rate limit') || error?.message?.includes('quota') || error?.message?.includes('exceeded')) {
          console.warn('[Scheduler] Rate limit hit. Will initialize with empty schedules.');
          console.warn('[Scheduler] Use /api/scheduler/reload to load schedules manually once rate limits reset.');
        } else {
          console.error('[Scheduler] Exception loading schedules:', error);
        }
        schedules = [];
      }

      if (!schedules || schedules.length === 0) {
        console.log('[Scheduler] No enabled schedules found');
        this.initialized = true;
        return;
      }

      console.log(`[Scheduler] Loading ${schedules.length} enabled schedule(s)...`);

      // Create cron jobs for each schedule
      for (const schedule of schedules) {
        try {
          await this.addSchedule(schedule);
        } catch (error) {
          console.error(`[Scheduler] Failed to add schedule ${schedule.id}:`, error);
          // Continue with other schedules
        }
      }

      this.initialized = true;
      console.log(`[Scheduler] Initialized with ${this.jobs.size} active job(s)`);
    } catch (error) {
      console.error('[Scheduler] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Add a schedule and start its cron job
   */
  async addSchedule(schedule: ScheduledJob): Promise<void> {
    try {
      // Validate cron expression
      if (!cron.validate(schedule.cron_expression)) {
        console.error(`[Scheduler] Invalid cron expression for schedule ${schedule.id}: ${schedule.cron_expression}`);
        throw new Error(`Invalid cron expression: ${schedule.cron_expression}`);
      }

      // Stop existing job if it exists
      if (this.jobs.has(schedule.id)) {
        this.removeSchedule(schedule.id);
      }

      // Calculate next run time
      const nextRun = this.calculateNextRun(schedule.cron_expression, schedule.timezone);

      // Track if job is currently running to prevent overlaps
      let isRunning = false;

      // Create cron job using node-cron v4 API
      const task = cron.schedule(
        schedule.cron_expression,
        async () => {
          // Prevent overlapping executions
          if (isRunning) {
            console.log(`[Scheduler] Job ${schedule.name} (${schedule.id}) skipped - previous execution still running`);
            return;
          }

          isRunning = true;
          try {
            await this.executeJob(schedule);
          } catch (error) {
            console.error(`[Scheduler] Error in job ${schedule.name} (${schedule.id}):`, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            await this.updateJobStatus(schedule.id, 'failed', errorMessage);
          } finally {
            isRunning = false;
          }
        },
        {
          timezone: schedule.timezone,
          name: schedule.name,
          noOverlap: true, // Prevent overlapping executions
        }
      );

      // Start the task
      task.start();

      // Store the task
      this.jobs.set(schedule.id, task);

      // Update next_run_at in database (with rate limit handling)
      try {
        const supabase = getSupabaseClient();
        await supabase
          .from('scheduled_jobs')
          .update({ next_run_at: nextRun.toISOString() })
          .eq('id', schedule.id);
      } catch (dbError: any) {
        // If rate limited, log but continue
        if (dbError?.message?.includes('rate limit') || dbError?.message?.includes('quota')) {
          console.warn(`[Scheduler] Rate limit hit updating next_run_at for ${schedule.id}. Schedule will still work.`);
        } else {
          console.error(`[Scheduler] Failed to update next_run_at for ${schedule.id}:`, dbError);
        }
      }

      console.log(`[Scheduler] Added schedule: ${schedule.name} (${schedule.id}) - Next run: ${nextRun.toISOString()}`);
    } catch (error) {
      console.error(`[Scheduler] Failed to add schedule ${schedule.id}:`, error);
      throw error;
    }
  }

  /**
   * Remove a schedule and stop its cron job
   */
  removeSchedule(scheduleId: string): void {
    const job = this.jobs.get(scheduleId);
    if (job) {
      job.stop();
      this.jobs.delete(scheduleId);
      console.log(`[Scheduler] Removed schedule: ${scheduleId}`);
    }
  }

  /**
   * Execute a scheduled job
   */
  private async executeJob(schedule: ScheduledJob): Promise<void> {
    const startTime = new Date();
    console.log(`[Scheduler] Executing job: ${schedule.name} (${schedule.id})`);
    const supabase = getSupabaseClient();

    try {
      // Update last_run_at (with rate limit handling)
      try {
        await supabase
          .from('scheduled_jobs')
          .update({ last_run_at: startTime.toISOString() })
          .eq('id', schedule.id);
      } catch (dbError: any) {
        // If rate limited, log but continue
        if (dbError?.message?.includes('rate limit') || dbError?.message?.includes('quota')) {
          console.warn(`[Scheduler] Rate limit hit updating last_run_at for ${schedule.id}. Continuing execution.`);
        } else {
          throw dbError;
        }
      }

      // Dynamically import startScrapeJob to avoid circular dependencies
      const { startScrapeJob } = await import('@/app/admin/scraper/actions');

      // Prepare scraper config
      const scraperConfig = {
        platform: schedule.platform,
        pages: schedule.config.pages,
      } as const;

      // Add platform-specific config
      if (schedule.platform === 'propertyguru' && schedule.config.districts) {
        // For PG, we need to handle multiple districts
        // The startScrapeJob function expects a single district, so we'll call it for each district
        for (const district of schedule.config.districts) {
          const result = await startScrapeJob({
            ...scraperConfig,
            district: `D${district}`,
          });
          
          if (!result.success) {
            throw new Error(result.error || 'Failed to start scraper job');
          }
        }
      } else {
        // For EP, just call once
        const result = await startScrapeJob(scraperConfig);
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to start scraper job');
        }
      }

      // Update status to success (with rate limit handling)
      const nextRun = this.calculateNextRun(schedule.cron_expression, schedule.timezone);
      try {
        await supabase
          .from('scheduled_jobs')
          .update({
            last_run_status: 'success',
            last_error: null,
            next_run_at: nextRun.toISOString(),
          })
          .eq('id', schedule.id);
      } catch (dbError: any) {
        // If rate limited, log but don't fail the job
        if (dbError?.message?.includes('rate limit') || dbError?.message?.includes('quota')) {
          console.warn(`[Scheduler] Rate limit hit updating success status for ${schedule.id}. Job completed successfully.`);
        } else {
          throw dbError;
        }
      }

      console.log(`[Scheduler] Job completed successfully: ${schedule.name} (${schedule.id})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Scheduler] Job failed: ${schedule.name} (${schedule.id}):`, errorMessage);

      // Update status to failed (with rate limit handling)
      const nextRun = this.calculateNextRun(schedule.cron_expression, schedule.timezone);
      try {
        await supabase
          .from('scheduled_jobs')
          .update({
            last_run_status: 'failed',
            last_error: errorMessage,
            next_run_at: nextRun.toISOString(),
          })
          .eq('id', schedule.id);
      } catch (dbError: any) {
        // If rate limited, log but don't fail again
        if (dbError?.message?.includes('rate limit') || dbError?.message?.includes('quota')) {
          console.warn(`[Scheduler] Rate limit hit updating failed status for ${schedule.id}. Error was: ${errorMessage}`);
        } else {
          console.error(`[Scheduler] Failed to update error status for ${schedule.id}:`, dbError);
        }
      }
    }
  }

  /**
   * Reload all schedules from database
   */
  async reload(): Promise<void> {
    console.log('[Scheduler] Reloading schedules...');

    // Stop all existing jobs
    for (const [scheduleId, job] of this.jobs.entries()) {
      job.stop();
    }
    this.jobs.clear();

    // Reset initialization flag
    this.initialized = false;
    this.initializationPromise = null;

    // Wait a bit to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Re-initialize
    await this.initialize();
  }

  /**
   * Calculate next run time from cron expression
   */
  private calculateNextRun(cronExpression: string, timezone: string): Date {
    // Create a temporary task to get next run time
    const tempTask = cron.schedule(cronExpression, () => {}, {
      timezone,
      name: 'temp',
    });
    const nextRun = tempTask.getNextRun();
    tempTask.destroy();
    
    // If no next run, calculate manually (fallback)
    if (!nextRun) {
      // Simple calculation: assume it's daily at the specified hour
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0); // Default to 10am
      return tomorrow;
    }
    
    return nextRun;
  }

  /**
   * Update job status in database
   */
  private async updateJobStatus(
    scheduleId: string,
    status: 'success' | 'failed',
    error?: string
  ): Promise<void> {
    try {
      const update: { last_run_status: string; last_error?: string | null } = {
        last_run_status: status,
      };

      if (error) {
        update.last_error = error;
      } else if (status === 'success') {
        update.last_error = null;
      }

      try {
        const supabase = getSupabaseClient();
        await supabase.from('scheduled_jobs').update(update).eq('id', scheduleId);
      } catch (dbError: any) {
        // If rate limited, log but don't throw
        if (dbError?.message?.includes('rate limit') || dbError?.message?.includes('quota')) {
          console.warn(`[Scheduler] Rate limit hit updating job status for ${scheduleId}.`);
        } else {
          throw dbError;
        }
      }
    } catch (error) {
      console.error(`[Scheduler] Failed to update job status for ${scheduleId}:`, error);
    }
  }

  /**
   * Get status of all active jobs
   */
  getStatus(): {
    initialized: boolean;
    activeJobs: number;
    jobDetails: Array<{
      id: string;
      name: string;
      status: string;
      nextRun: Date | null;
    }>;
  } {
    const jobDetails = Array.from(this.jobs.entries()).map(([id, task]) => ({
      id,
      name: task.name || 'Unknown',
      status: task.getStatus(),
      nextRun: task.getNextRun(),
    }));

    return {
      initialized: this.initialized,
      activeJobs: this.jobs.size,
      jobDetails,
    };
  }
}

// Singleton instance
let schedulerInstance: ScraperScheduler | null = null;

export function getScheduler(): ScraperScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new ScraperScheduler();
  }
  return schedulerInstance;
}

export async function initializeScheduler(): Promise<void> {
  const scheduler = getScheduler();
  await scheduler.initialize();
}

export async function reloadScheduler(): Promise<void> {
  const scheduler = getScheduler();
  await scheduler.reload();
}

