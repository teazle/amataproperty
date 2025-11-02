import { NextRequest, NextResponse } from 'next/server';
import { processOutreachMessages } from '@/jobs/match';

/**
 * POST /api/outreach/process
 * Processes queued outreach messages and sends WhatsApp messages
 */
export async function POST(request: NextRequest) {
  try {
    console.log('Processing queued outreach messages...');
    
    const result = await processOutreachMessages();
    
    return NextResponse.json({
      success: true,
      message: 'Outreach messages processed successfully',
      stats: result,
      timestamp: new Date().toISOString()
    }, { status: 200 });

  } catch (error: any) {
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
