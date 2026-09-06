import { NextRequest, NextResponse } from 'next/server';

import { getServiceStatus } from '@/lib/services/status';

export async function GET(_request: NextRequest) {
  try {
    return NextResponse.json(await getServiceStatus(), { status: 200 });
  } catch (error) {
    console.error('Error checking service status:', error);
    return NextResponse.json(
      {
        error: 'Failed to check service status',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
