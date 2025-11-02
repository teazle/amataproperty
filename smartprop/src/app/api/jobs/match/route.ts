import { NextRequest, NextResponse } from 'next/server';
import { withAdvisoryLock } from '@/jobs/lock';
import { runMatchingJob } from '@/jobs/match';

/**
 * POST /api/jobs/match
 * Runs the property matching job with advisory locking
 * 
 * Uses advisory lock key 10101 to prevent concurrent execution
 */
export async function POST(request: NextRequest) {
  try {
    console.log('Received request to run matching job');

    // Run the matching job with advisory lock (key 10101)
    const result = await withAdvisoryLock(10101, async () => {
      return await runMatchingJob();
    });

    if (result === null) {
      // Lock was not acquired (another process is running)
      return NextResponse.json(
        { 
          message: 'Matching job is already running in another process',
          status: 'locked'
        },
        { status: 409 }
      );
    }

    // Return the job results
    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
      lockKey: 10101
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error in matcher job endpoint:', error);
    return NextResponse.json(
      { 
        error: 'Failed to run matcher job',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
