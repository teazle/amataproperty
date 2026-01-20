import { NextRequest, NextResponse } from 'next/server';
import { getLinkedInSettings, getTodayMessageCount } from '@/lib/linkedin/tracker';
import { readLockFile, getStorageStatePath, hasStorageState, isProcessRunning } from '@/lib/linkedin/storage';
import { getSchedulerStatus } from '@/lib/linkedin/scheduler';
import { getSupabaseClient } from '@/workers/supa';

/**
 * GET /api/linkedin/status
 * Get current LinkedIn automation status
 */
export async function GET(request: NextRequest) {
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
    const hasSession = hasStorageState();
    
    // Get scheduler status
    const schedulerStatus = getSchedulerStatus();
    
    return NextResponse.json({
      success: true,
      settings: settings || null,
      isRunning,
      hasSession,
      scheduler: schedulerStatus,
      today: {
        messagesSent: todayCount,
        messagesLimit: settings?.daily_limit || 25,
        dailyStats: dailyStats || null
      },
      lastScanTime,
      lockData: lockData || null
    });
  } catch (error: any) {
    console.error('Error getting LinkedIn status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get status' },
      { status: 500 }
    );
  }
}

