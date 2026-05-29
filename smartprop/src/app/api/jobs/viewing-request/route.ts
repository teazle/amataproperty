import { NextRequest, NextResponse } from 'next/server';
import { sendViewingRequests } from '@/jobs/viewing-request';

/**
 * POST /api/jobs/viewing-request
 * Trigger the viewing request job manually
 * 
 * Query params:
 * - limit: Maximum number of messages to send (default: 10)
 * 
 * Example:
 * POST /api/jobs/viewing-request?limit=20
 */
export async function POST(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10');

    console.log(`[API] Triggering viewing request job (limit: ${limit})...`);

    const results = await sendViewingRequests(limit);

    return NextResponse.json(results);
  } catch (error) {
    console.error('[API] Error in viewing request job:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        sent: 0,
        failed: 0,
        skipped: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/jobs/viewing-request
 * Get status of pending viewing requests
 */
export async function GET() {
  try {
    const { getSupabaseClient } = await import('@/workers/supa');
    const supabase = getSupabaseClient();

    // Count listings by viewing status
    const { data, error } = await supabase
      .from('listings')
      .select('viewing_status')
      .not('agent_id', 'is', null);

    if (error) {
      throw error;
    }

    const stats = {
      pending: 0,
      requested: 0,
      received: 0,
      failed: 0,
    };

    if (data) {
      for (const row of data) {
        const status = row.viewing_status || 'pending';
        if (status in stats) {
          stats[status as keyof typeof stats]++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      stats,
      message: `${stats.pending} listings waiting for viewing requests`,
    });
  } catch (error) {
    console.error('Error fetching viewing request:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

