import { NextRequest, NextResponse } from 'next/server';
import { processOutreachMessages } from '@/jobs/match';

/**
 * POST /api/outreach/process
 * Processes queued outreach messages and sends WhatsApp messages
 */
export async function POST(request: NextRequest) {
  try {
    console.log('📨 [API] Processing queued outreach messages...');
    
    const result = await processOutreachMessages();
    
    console.log('📊 [API] Outreach processing completed:', {
      processed: result.processed,
      sent: result.sent,
      failed: result.failed
    });
    
    return NextResponse.json({
      success: true,
      message: 'Outreach messages processed successfully',
      stats: result,
      timestamp: new Date().toISOString()
    }, { status: 200 });

  } catch (error: any) {
    console.error('❌ [API] Error processing outreach:', error);
    console.error('❌ [API] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json(
      { 
        error: 'Failed to process outreach messages',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
