import { NextRequest, NextResponse } from 'next/server';
import { processOutreachMessages } from '@/jobs/match';

/**
 * Processes only operator-selected, explicitly confirmed rows. The matcher
 * never calls this endpoint, and the job itself claims delivery before send.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (body.confirmed !== true || !Array.isArray(body.confirmedOutreachIds) || body.confirmedOutreachIds.length === 0 || !body.confirmedOutreachIds.every((id: unknown) => typeof id === 'string' && id.trim())) {
    return NextResponse.json(
      { error: 'Sending requires explicit confirmation and selected outreach ids' },
      { status: 400 },
    );
  }

  const selectedOutreachIds = Array.from(new Set((body.confirmedOutreachIds as string[]).map((id) => id.trim())));
  if (selectedOutreachIds.length > 20) {
    return NextResponse.json(
      { error: 'Select at most 20 outreach rows per send' },
      { status: 400 },
    );
  }
  try {
    const stats = await processOutreachMessages(selectedOutreachIds.length, undefined, { selectedOutreachIds });
    return NextResponse.json({
      success: true,
      message: 'Selected outreach rows processed',
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error processing selected outreach:', error);
    return NextResponse.json(
      { error: 'Failed to process selected outreach', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
