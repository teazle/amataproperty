import { runMatchingJob } from '@/jobs/match';
import { NextRequest,NextResponse } from 'next/server';

/**
 * POST /api/jobs/match
 * Runs the property matching job. Preparing rows relies on the database's
 * unique (agent_id, listing_id) constraint, so concurrent confirmations cannot
 * create duplicate outreach records.
 */
export async function POST(request: NextRequest) {
  try {
    console.log('Received request to run matching job');

    // Preview is the only default. Preparing outreach rows requires both an
    // explicit confirmation and selected listing ids; this endpoint never
    // processes or sends those rows.
    let outreachLimit: number | undefined;
    let confirmedListingIds: string[] | undefined;
    try {
      const body = await request.json().catch(() => ({}));
      if (typeof body.limit === 'number') {
        outreachLimit = body.limit;
      }
      if (body.confirmed === true) {
        if (!Array.isArray(body.confirmedListingIds) || body.confirmedListingIds.length === 0 || !body.confirmedListingIds.every((id: unknown) => typeof id === 'string' && id.trim())) {
          return NextResponse.json(
            { error: 'Confirmation requires one or more selected listing ids' },
            { status: 400 },
          );
        }
        confirmedListingIds = Array.from(new Set(body.confirmedListingIds.map((id: string) => id.trim())));
      }
    } catch {
      // Body parsing failed or no body, use defaults
    }

    const result = await runMatchingJob(outreachLimit, { confirmedListingIds });

    // Return the job results
    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
    }, { status: 200 });

  } catch (error) {
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
 * Matcher runs are synchronous. There is no cancellation API because releasing
 * an advisory lock cannot cancel a running process.
 */
export async function DELETE(_request: NextRequest) {
  return NextResponse.json(
    { error: 'Matcher cancellation is not supported' },
    { status: 405 },
  );
}
