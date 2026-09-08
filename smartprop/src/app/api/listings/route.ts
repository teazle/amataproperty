import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { applyListingBrowseFilters, FilterQuery, parseListingBrowseParams } from '@/lib/admin-browsing';

const supabase = getSupabaseClient();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const params = parseListingBrowseParams(searchParams);
    const { page, limit } = params;
    const offset = (page - 1) * limit;
    let matchingAgentIds: string[] = [];
    if (params.search) {
      const { data: matchingAgents, error: matchingAgentsError } = await supabase
        .from('agents')
        .select('id')
        .ilike('name', `%${params.search}%`)
        .limit(200);
      if (matchingAgentsError) return NextResponse.json({ error: matchingAgentsError.message }, { status: 500 });
      matchingAgentIds = (matchingAgents || []).map((agent) => agent.id);
    }

    // Get total count
    let countQuery = supabase
      .from('listings')
      .select('*', { count: 'exact', head: true });
    countQuery = applyListingBrowseFilters(countQuery as unknown as FilterQuery, params, matchingAgentIds) as never;
    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error('Error counting listings:', countError);
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    let query = supabase
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
      .order('scraped_at', { ascending: false });
    query = applyListingBrowseFilters(query as unknown as FilterQuery, params, matchingAgentIds) as never;
    const { data, error } = await query.range(offset, offset + limit - 1);

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
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
