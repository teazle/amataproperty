/**
 * API Endpoint for Resetting Outreach Conversations
 * Resets outreach records to initial state instead of deleting them
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { outreachIds } = body;

    if (!outreachIds || !Array.isArray(outreachIds) || outreachIds.length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid outreachIds array' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Delete outreach records to reset to "no outreach" state
    const { data, error } = await supabase
      .from('outreach')
      .delete()
      .in('id', outreachIds)
      .select();

    if (error) {
      console.error('Error resetting outreach records:', error);
      return NextResponse.json(
        { error: 'Failed to reset outreach records', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: `Successfully reset ${data.length} outreach records to "no outreach" state`,
      resetCount: data.length,
      resetIds: data.map(record => record.id)
    });

  } catch (error) {
    console.error('Error in reset outreach API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
