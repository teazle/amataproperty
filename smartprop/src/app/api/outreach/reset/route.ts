import { NextResponse } from 'next/server';

/** Resetting previously prepared outreach would delete delivery history. */
export async function POST() {
  return NextResponse.json(
    { error: 'Outreach reset is not supported because it would delete delivery history' },
    { status: 409 },
  );
}
