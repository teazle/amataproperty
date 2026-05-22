import cron, { type ScheduledTask } from 'node-cron';
import { getLinkedInSettings } from '@/lib/linkedin/tracker';
import { startLinkedInAutomation } from '@/lib/linkedin/automation';
import { readLockFile, isProcessRunning, isLinkedInLockExpired } from '@/lib/linkedin/storage';

let scheduledTask: ScheduledTask | null = null;
let currentSchedule: string | null = null;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;
const INIT_RETRY_DELAY_MS = 5000; // 5 seconds

/**
 * Get scheduler status for health checks
 */
export function getSchedulerStatus(): { isActive: boolean; schedule: string | null; error?: string } {
  return {
    isActive: scheduledTask !== null && currentSchedule !== null,
    schedule: currentSchedule,
    ...(scheduledTask === null && initializationAttempts >= MAX_INIT_ATTEMPTS ? { error: 'Max initialization attempts reached' } : {})
  };
}

async function shouldSkipRun(): Promise<boolean> {
  const lockData = readLockFile();
  if (!lockData) {
    return false;
  }
  const stillRunning = await isProcessRunning(lockData.pid);
  if (lockData.status === 'running' && stillRunning && isLinkedInLockExpired(lockData)) {
    console.warn('⚠️  Scheduled LinkedIn automation found an expired running lock; start flow will clean it up');
    return false;
  }
  return lockData.status === 'running' && stillRunning;
}

/**
 * Refresh/restart the LinkedIn automation scheduler
 * With retry logic for database connection issues
 */
export async function refreshLinkedInScheduler(retryCount: number = 0): Promise<void> {
  try {
    const settings = await getLinkedInSettings();

    // If settings don't exist or database error, retry with exponential backoff
    if (!settings && retryCount < MAX_INIT_ATTEMPTS) {
      const delay = INIT_RETRY_DELAY_MS * (retryCount + 1);
      console.warn(`⚠️  LinkedIn settings not available, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_INIT_ATTEMPTS})...`);
      setTimeout(() => {
        refreshLinkedInScheduler(retryCount + 1).catch(err => {
          console.error('❌ Failed to retry LinkedIn scheduler initialization:', err);
        });
      }, delay);
      return;
    }

    const schedule = settings?.auto_run_schedule?.trim();

    // No schedule configured - stop any existing task and return
    if (!schedule) {
      if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
        currentSchedule = null;
        console.log('ℹ️  LinkedIn scheduler stopped: no schedule configured');
      }
      initializationAttempts = 0; // Reset on successful "no schedule" state
      return;
    }

    // Validate cron schedule
    if (!cron.validate(schedule)) {
      console.error(`❌ Invalid cron schedule for LinkedIn automation: ${schedule}`);
      initializationAttempts = 0; // Reset on validation error (user config issue)
      return;
    }

    // Schedule hasn't changed and task is running - nothing to do
    if (currentSchedule === schedule && scheduledTask) {
      console.log(`✅ LinkedIn scheduler already running: ${schedule}`);
      initializationAttempts = 0; // Reset on successful state
      return;
    }

    // Stop existing task if schedule changed
    if (scheduledTask) {
      scheduledTask.stop();
      scheduledTask = null;
      console.log('🔄 Stopping existing LinkedIn scheduler task...');
    }

    // Create and start new scheduled task
    scheduledTask = cron.schedule(
      schedule,
      async () => {
        if (await shouldSkipRun()) {
          console.log('⚠️  Scheduled LinkedIn automation skipped because another run is already active');
          return;
        }
        console.log('📅 Scheduled LinkedIn automation triggered');
        try {
          const pid = await startLinkedInAutomation({ dryRun: false, reason: 'scheduled run' });
          console.log(`✅ LinkedIn automation process started successfully (PID: ${pid})`);
        } catch (error: any) {
          console.error('❌ Failed to start scheduled LinkedIn automation:', error);
          console.error('   Error details:', {
            message: error?.message,
            stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
            name: error?.name
          });
        }
      },
      {
        timezone: settings?.timezone || 'Asia/Singapore'
      }
    );

    currentSchedule = schedule;
    scheduledTask.start();
    initializationAttempts = 0; // Reset on successful initialization

    // Note: scheduledTask.start() doesn't throw, so if we get here, the task is scheduled
    // The task will run according to the cron schedule
    console.log(`✅ Scheduled LinkedIn automation started: ${schedule} (${settings?.timezone || 'Asia/Singapore'})`);
  } catch (error: any) {
    initializationAttempts++;
    const errorMsg = error?.message || String(error);
    console.error(`❌ Unable to refresh LinkedIn scheduler (attempt ${initializationAttempts}):`, errorMsg);

    // Retry on database/connection errors
    if (retryCount < MAX_INIT_ATTEMPTS && (
      errorMsg.includes('database') ||
      errorMsg.includes('connection') ||
      errorMsg.includes('timeout') ||
      errorMsg.includes('ECONNREFUSED') ||
      errorMsg.includes('PGRST')
    )) {
      const delay = INIT_RETRY_DELAY_MS * (retryCount + 1);
      console.warn(`⚠️  Retrying LinkedIn scheduler initialization in ${delay}ms...`);
      setTimeout(() => {
        refreshLinkedInScheduler(retryCount + 1).catch(err => {
          console.error('❌ Failed to retry LinkedIn scheduler initialization:', err);
        });
      }, delay);
    } else if (initializationAttempts >= MAX_INIT_ATTEMPTS) {
      console.error(`❌ LinkedIn scheduler failed after ${MAX_INIT_ATTEMPTS} attempts. Please check database connection and settings.`);
    }
  }
}
