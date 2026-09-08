import { NextRequest, NextResponse } from 'next/server';

type MatcherJobResult = {
  success: boolean;
  message: string;
  stats: object;
  dryRun?: boolean;
  previews?: unknown[];
};

type RunMatcherJob = (outreachLimit?: number, options?: { confirmedListingIds?: string[] }) => Promise<MatcherJobResult>;
type ProcessOutreachMessages = (limit: number, delay: number | undefined, options: { selectedOutreachIds: string[] }) => Promise<unknown>;

async function runMatcherJob(outreachLimit?: number, options?: { confirmedListingIds?: string[] }): Promise<MatcherJobResult> {
  const { runMatchingJob } = await import('@/jobs/match');
  return runMatchingJob(outreachLimit, options);
}

async function processSelectedOutreach(limit: number, delay: number | undefined, options: { selectedOutreachIds: string[] }): Promise<unknown> {
  const { processOutreachMessages } = await import('@/jobs/match');
  return processOutreachMessages(limit, delay, options);
}

export function createMatcherPostHandler(runJob: RunMatcherJob = runMatcherJob) {
  return async function POST(request: NextRequest) {
    try {
      console.log('Received request to run matching job');

      let outreachLimit: number | undefined;
      let confirmedListingIds: string[] | undefined;
      try {
        const body = await request.json().catch(() => ({}));
        if (typeof body.limit === 'number') outreachLimit = body.limit;
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
        // Body parsing failed or no body, use defaults.
      }

      const result = await runJob(outreachLimit, { confirmedListingIds });
      return NextResponse.json(
        { ...result, timestamp: new Date().toISOString() },
        { status: result.success ? 200 : 500 },
      );
    } catch (error) {
      console.error('Error in matcher job endpoint:', error);
      return NextResponse.json(
        { error: 'Failed to run matcher job', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 },
      );
    }
  };
}

export function createOutreachProcessHandler(processMessages: ProcessOutreachMessages = processSelectedOutreach) {
  return async function POST(request: NextRequest) {
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
      const stats = await processMessages(selectedOutreachIds.length, undefined, { selectedOutreachIds });
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
  };
}
