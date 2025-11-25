/**
 * API Route to Reload Scheduler
 */

import { NextRequest, NextResponse } from 'next/server';
import { reloadScheduler } from '@/lib/scheduler/scraper-scheduler';

/**
 * POST /api/scheduler/reload
 * Reload all schedules from database
 */
export async function POST(request: NextRequest) {
  try {
    await reloadScheduler();
    return NextResponse.json({ success: true, message: 'Scheduler reloaded successfully' });
  } catch (error) {
    console.error('Error reloading scheduler:', error);
    return NextResponse.json(
      { error: 'Failed to reload scheduler' },
      { status: 500 }
    );
  }
}

