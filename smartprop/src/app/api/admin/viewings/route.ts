import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';

/**
 * GET /api/admin/viewings
 * Fetch viewing data for calendar
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // YYYY-MM format
    const status = searchParams.get('status') || 'received';
    
    const supabase = getSupabaseClient();
    
    let query = supabase
      .from('listings')
      .select(`
        id,
        title,
        address,
        price,
        viewing_status,
        viewing_timeslots,
        viewing_timeslots_structured,
        viewing_requested_at,
        agents (
          id,
          name,
          phone,
          agency
        )
      `)
      .eq('viewing_status', status)
      .not('viewing_timeslots_structured', 'is', null);

    // If month filter is provided, filter by viewing_requested_at
    if (month) {
      const startDate = new Date(`${month}-01`);
      const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      
      query = query
        .gte('viewing_requested_at', startDate.toISOString())
        .lte('viewing_requested_at', endDate.toISOString());
    }

    query = query.order('viewing_requested_at', { ascending: false });

    const { data: viewings, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({ viewings: viewings || [] });
  } catch (error) {
    console.error('Error fetching viewings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch viewings' },
      { status: 500 }
    );
  }
}
