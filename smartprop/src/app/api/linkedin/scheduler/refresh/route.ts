import { NextRequest, NextResponse } from 'next/server';
import { refreshLinkedInScheduler } from '@/lib/linkedin/scheduler';

/**
 * POST /api/linkedin/scheduler/refresh
 * Manually refresh/restart the LinkedIn automation scheduler
 */
export async function POST(request: NextRequest) {
  try {
    await refreshLinkedInScheduler();
    
    return NextResponse.json({
      success: true,
      message: 'LinkedIn scheduler refreshed successfully'
    });
  } catch (error: any) {
    console.error('Error refreshing LinkedIn scheduler:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to refresh scheduler' },
      { status: 500 }
    );
  }
}
