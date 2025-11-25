/**
 * API Route to Validate Cron Expression and Get Next Run Time
 */

import { NextRequest, NextResponse } from 'next/server';
import cron from 'node-cron';

/**
 * GET /api/scheduler/validate
 * Validate cron expression and return next run time
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const expression = searchParams.get('expression');
    const timezone = searchParams.get('timezone') || 'Asia/Singapore';

    if (!expression) {
      return NextResponse.json(
        { valid: false, error: 'Cron expression is required' },
        { status: 400 }
      );
    }

    // Validate cron expression
    const isValid = cron.validate(expression);
    
    if (!isValid) {
      return NextResponse.json({
        valid: false,
        error: 'Invalid cron expression',
      });
    }

    // Calculate next run time
    const tempTask = cron.schedule(expression, () => {}, {
      timezone,
      name: 'temp',
    });
    const nextRun = tempTask.getNextRun();
    tempTask.destroy();

    return NextResponse.json({
      valid: true,
      nextRun: nextRun?.toISOString() || null,
    });
  } catch (error) {
    console.error('Error validating cron expression:', error);
    return NextResponse.json(
      { valid: false, error: 'Failed to validate cron expression' },
      { status: 500 }
    );
  }
}

