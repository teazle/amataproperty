import { getSchedulerStatus } from '@/lib/linkedin/scheduler';
import {
getLinkedInMaxRunMs,
getLockAgeMs,
hasStorageState,
isLinkedInLockExpired,
isProcessRunning,
readLockFile
} from '@/lib/linkedin/storage';
import { getLinkedInSettings,getTodayMessageCount } from '@/lib/linkedin/tracker';
import { getSupabaseClient } from '@/workers/supa';
import { NextRequest,NextResponse } from 'next/server';

/**
 * GET /api/linkedin/status
 * Get current LinkedIn automation status
 */
export async function GET(_request: NextRequest) {
  try {
    const supabase = getSupabaseClient();

    // Get settings
    const settings = await getLinkedInSettings();

    // Get today's stats
    const todayCount = await getTodayMessageCount();

    // Get lock file status
    const lockData = readLockFile();
    let isRunning = false;
    if (lockData && lockData.status === 'running') {
      isRunning = await isProcessRunning(lockData.pid);
    }
    const requiresReauth = lockData?.status === 'reauth_required';
    const reauth = requiresReauth
      ? {
          liveUrl: lockData?.reauthLiveUrl || null,
          browserId: lockData?.reauthBrowserId || null,
          startedAt: lockData?.reauthStartedAt || null,
          deadlineAt: lockData?.reauthDeadlineAt || null,
          verifiedAt: lockData?.authVerifiedAt || null,
          check: lockData?.authCheck || null,
          error: lockData?.error || null,
        }
      : null;
    const lockAgeMs = lockData ? getLockAgeMs(lockData) : null;
    const maxRunMs = getLinkedInMaxRunMs();
    const lockExpired = lockData ? isLinkedInLockExpired(lockData) : false;

    // Get recent stats from daily_stats
    const today = new Date().toISOString().split('T')[0];
    const { data: dailyStats } = await supabase
      .from('linkedin_daily_stats')
      .select('*')
      .eq('date', today)
      .single();

    // Get last scan time (from lock file or last sent message)
    let lastScanTime = null;
    if (lockData?.startedAt) {
      lastScanTime = lockData.startedAt;
    } else {
      const { data: lastMessage } = await supabase
        .from('linkedin_messages')
        .select('sent_at')
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (lastMessage?.sent_at) {
        lastScanTime = lastMessage.sent_at;
      }
    }

    // Check session validity
    const hasSession = hasStorageState() && !requiresReauth;

    // Get scheduler status
    const schedulerStatus = getSchedulerStatus();
    const configuredSchedule = settings?.auto_run_schedule?.trim() || null;

    return NextResponse.json({
      success: true,
      settings: settings || null,
      isRunning,
      hasSession,
      requiresReauth,
      scheduler: {
        ...schedulerStatus,
        isActive: schedulerStatus.isActive || Boolean(configuredSchedule),
        memoryActive: schedulerStatus.isActive,
        configured: Boolean(configuredSchedule),
        effectiveSchedule: configuredSchedule,
        timezone: settings?.timezone || 'Asia/Singapore',
      },
      today: {
        messagesSent: todayCount,
        messagesLimit: settings?.messages_per_job || settings?.daily_limit || 50,
        dailyLimit: settings?.daily_limit || 50,
        messagesPerJob: settings?.messages_per_job || 50,
        dailyStats: dailyStats || null
      },
      lastScanTime,
      runtime: {
        lockAgeMs,
        maxRunMs,
        lockExpired
      },
      reauth,
      lockData: lockData || null
    });
  } catch (error) {
    console.error('Error getting LinkedIn status:', error);
    return NextResponse.json(
      { error: (error instanceof Error ? error.message : String(error)) || 'Failed to get status' },
      { status: 500 }
    );
  }
}
