import cron from 'node-cron';
import { getLinkedInSettings } from '@/lib/linkedin/tracker';
import { startLinkedInAutomation } from '@/lib/linkedin/automation';
import { readLockFile, isProcessRunning } from '@/lib/linkedin/storage';

let scheduledTask: cron.ScheduledTask | null = null;
let currentSchedule: string | null = null;

async function shouldSkipRun(): Promise<boolean> {
  const lockData = readLockFile();
  if (!lockData) {
    return false;
  }
  const stillRunning = await isProcessRunning(lockData.pid);
  return lockData.status === 'running' && stillRunning;
}

export async function refreshLinkedInScheduler(): Promise<void> {
  try {
    const settings = await getLinkedInSettings();
    const schedule = settings?.auto_run_schedule?.trim();

    if (!schedule) {
      if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
        currentSchedule = null;
      }
      return;
    }

    if (!cron.validate(schedule)) {
      console.warn(`⚠️  Invalid cron schedule for LinkedIn automation: ${schedule}`);
      return;
    }

    if (currentSchedule === schedule && scheduledTask) {
      return;
    }

    if (scheduledTask) {
      scheduledTask.stop();
      scheduledTask = null;
    }

    scheduledTask = cron.schedule(
      schedule,
      async () => {
        if (await shouldSkipRun()) {
          console.log('⚠️  Scheduled LinkedIn automation skipped because another run is already active');
          return;
        }
        console.log('📅 Scheduled LinkedIn automation triggered');
        try {
          await startLinkedInAutomation({ dryRun: false, reason: 'scheduled run' });
        } catch (error) {
          console.error('❌ Failed to start scheduled LinkedIn automation:', error);
        }
      },
      {
        timezone: settings?.timezone || 'Asia/Singapore'
      }
    );

    currentSchedule = schedule;
    scheduledTask.start();
    console.log(`✅ Scheduled LinkedIn automation updated: ${schedule} (${settings?.timezone || 'Asia/Singapore'})`);
  } catch (error) {
    console.error('❌ Unable to refresh LinkedIn scheduler:', error);
  }
}

void refreshLinkedInScheduler();

