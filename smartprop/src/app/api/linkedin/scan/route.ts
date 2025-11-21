import { NextRequest, NextResponse } from 'next/server';
import { startLinkedInAutomation } from '@/lib/linkedin/automation';
import '@/lib/linkedin/scheduler';

/**
 * POST /api/linkedin/scan
 * Trigger LinkedIn automation scan
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dryRun, headed } = body;
    const pid = startLinkedInAutomation({
      dryRun,
      headed,
      reason: 'manual scan'
    });

    return NextResponse.json({
      success: true,
      message: 'LinkedIn automation started',
      pid,
      dryRun
    });
  } catch (error: any) {
    console.error('Error starting LinkedIn automation:', error);
    if (error.message?.includes('already running')) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: error.message || 'Failed to start LinkedIn automation' },
      { status: 500 }
    );
  }
}

