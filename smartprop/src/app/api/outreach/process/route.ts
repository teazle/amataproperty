import { NextResponse } from 'next/server';

/**
 * Sending is deliberately disabled for this launch. The matcher only prepares
 * operator-selected rows; delivery requires a separately authorized release.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Outreach sending is disabled pending delivery-path authorization' },
    { status: 409 },
  );
}
