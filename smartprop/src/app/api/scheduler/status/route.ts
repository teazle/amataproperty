/**
 * API Route to Get Scheduler Status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getScheduler } from '@/lib/scheduler/scraper-scheduler';

/**
 * GET /api/scheduler/status
 * Get scheduler status and active jobs
 */
export async function GET(request: NextRequest) {
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

