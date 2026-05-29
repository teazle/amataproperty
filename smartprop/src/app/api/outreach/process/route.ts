import { NextRequest, NextResponse } from 'next/server';
import { processOutreachMessages } from '@/jobs/match';

/**
 * POST /api/outreach/process
 * Processes queued outreach messages and sends WhatsApp messages
 */
export async function POST(request: NextRequest) {
  try {
    console.log('Processing queued outreach messages...');
    
    // Parse optional limit, delay, and dry-run mode from request body
    let limit: number | undefined;
    let delay: number | undefined;
    let dryRun = false;
    let preview = true;
    try {
      const body = await request.json().catch(() => ({}));
      if (typeof body.limit === 'number') {
        limit = body.limit;
      }
      if (body.delay && typeof body.delay === 'number') {
        delay = body.delay;
      }
      if (body.dryRun === true) {
        dryRun = true;
      }
      if (body.preview === false) {
        preview = false;
      }
    } catch {
      // Body parsing failed or no body, use defaults
    }
    
    const result = await processOutreachMessages(limit, delay, { dryRun, preview });
    
    return NextResponse.json({
      success: true,
      message: 'Outreach messages processed successfully',
      stats: result,
      timestamp: new Date().toISOString()
    }, { status: 200 });

  } catch (error) {
    console.error('Error processing outreach:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process outreach messages',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
