import { NextResponse } from 'next/server';

/** Manual sends remain disabled until the delivery path has release approval. */
export async function POST() {
  return NextResponse.json(
    { error: 'Manual outreach sending is disabled pending delivery-path authorization' },
    { status: 409 },
  );
}
