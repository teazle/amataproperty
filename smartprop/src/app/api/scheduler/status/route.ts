/**
 * API Route to Get Scheduler Status
 */

import { getScheduler } from '@/lib/scheduler/scraper-scheduler';
import { NextRequest,NextResponse } from 'next/server';

/**
 * GET /api/scheduler/status
 * Get scheduler status and active jobs
 */
export async function GET(_request: NextRequest) {
  try {
    const scheduler = getScheduler();
    const status = scheduler.getStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Error getting scheduler status:', error);
    return NextResponse.json(
      { error: 'Failed to get scheduler status' },
      { status: 500 }
    );
  }
}

