import { NextRequest, NextResponse } from 'next/server';
import { withAdvisoryLock, advisoryUnlock } from '@/jobs/lock';
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

    // Parse optional limit and dry-run mode from request body
    let outreachLimit: number | undefined;
    let dryRun = false;
    let preview = true;
    try {
      const body = await request.json().catch(() => ({}));
      if (typeof body.limit === 'number') {
        outreachLimit = body.limit;
        console.log(`Using custom outreach limit: ${outreachLimit}`);
      }
      if (body.dryRun === true) {
        dryRun = true;
        console.log('Running matching job in dry-run mode');
      }
      if (body.preview === false) {
        preview = false;
      }
    } catch {
      // Body parsing failed or no body, use defaults
    }

    // Run the matching job with advisory lock (key 10101)
    const result = await withAdvisoryLock(10101, async () => {
      return await runMatchingJob(outreachLimit, { dryRun, preview });
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

/**
 * DELETE /api/jobs/match
 * Stops the matching job by releasing the advisory lock
 * 
 * Releases advisory lock key 10101 to allow new jobs to run
 */
export async function DELETE(request: NextRequest) {
  try {
    console.log('Received request to stop matching job');

    // Release the advisory lock (key 10101)
    const unlocked = await advisoryUnlock(10101);

    if (unlocked) {
      return NextResponse.json({
        success: true,
        message: 'Matching job lock released successfully',
        lockKey: 10101,
        timestamp: new Date().toISOString()
      }, { status: 200 });
    } else {
      return NextResponse.json({
        success: false,
        message: 'No matching job lock found to release (may not be running)',
        lockKey: 10101,
        timestamp: new Date().toISOString()
      }, { status: 200 });
    }

  } catch (error: any) {
    console.error('Error stopping matcher job:', error);
    return NextResponse.json(
      { 
        error: 'Failed to stop matcher job',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
