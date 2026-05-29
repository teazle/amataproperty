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
    const pid = await startLinkedInAutomation({
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
  } catch (error) {
    console.error('Error starting LinkedIn automation:', error);
    if ((error instanceof Error ? error.message : String(error))?.includes('already running')) {
      return NextResponse.json(
        { error: (error instanceof Error ? error.message : String(error)) },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: (error instanceof Error ? error.message : String(error)) || 'Failed to start LinkedIn automation' },
      { status: 500 }
    );
  }
}

