import { createMatcherPostHandler } from '@/lib/matcher/job-handlers';
import { NextRequest, NextResponse } from 'next/server';

export const POST = createMatcherPostHandler();

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
