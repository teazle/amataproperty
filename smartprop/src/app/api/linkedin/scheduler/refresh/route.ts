import { refreshLinkedInScheduler } from '@/lib/linkedin/scheduler';
import { NextRequest,NextResponse } from 'next/server';

/**
 * POST /api/linkedin/scheduler/refresh
 * Manually refresh/restart the LinkedIn automation scheduler
 */
export async function POST(_request: NextRequest) {
  try {
    await refreshLinkedInScheduler();
    
    return NextResponse.json({
      success: true,
      message: 'LinkedIn scheduler refreshed successfully'
    });
  } catch (error) {
    console.error('Error refreshing LinkedIn scheduler:', error);
    return NextResponse.json(
      { error: (error instanceof Error ? error.message : String(error)) || 'Failed to refresh scheduler' },
      { status: 500 }
    );
  }
}
