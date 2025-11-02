import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';

const supabase = getSupabaseClient();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    // Get total count
    const { count, error: countError } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('Error counting listings:', countError);
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    const { data, error } = await supabase
      .from('listings')
      .select(`
        id,
        portal,
        url,
        title,
        price,
        district,
        property_type,
        agent_id,
        posted_at,
        scraped_at,
        address,
        beds,
        baths,
        size_sqft,
        price_psf,
        year_built,
        tenure,
        viewing_requested_at,
        viewing_timeslots,
        viewing_status,
        viewing_timeslots_structured,
        agents!left(
          id,
          name,
          phone,
          email,
          agency,
          cea_reg_no,
          source,
          source_url,
          last_seen_at
        ),
        outreach!left(
          id,
          status,
          conversation_phase,
          co_broking_status,
          co_broking_notes,
          last_message_at,
          auto_reply_count
        )
      `)
      .order('scraped_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching listings:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const total = count || 0;
    const hasMore = offset + limit < total;

    return NextResponse.json({ 
      listings: data || [],
      page,
      limit,
      total,
      hasMore
    });
  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
