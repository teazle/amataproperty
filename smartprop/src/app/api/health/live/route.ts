import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    { status: 'live' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
