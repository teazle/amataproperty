import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { applyAgentBrowseFilters, FilterQuery, parseAgentBrowseParams } from '@/lib/admin-browsing';

const supabase = getSupabaseClient();

export async function GET(request: Request) {
  try {
    const params = parseAgentBrowseParams(new URL(request.url).searchParams);
    const offset = (params.page - 1) * params.limit;
    let countQuery = supabase.from('agents').select('*', { count: 'exact', head: true });
    countQuery = applyAgentBrowseFilters(countQuery as unknown as FilterQuery, params) as never;
    const { count, error: countError } = await countQuery;
    if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });

    let query = supabase
      .from('agents')
      .select(`
        id,
        name,
        phone,
        email,
        agency,
        cea_reg_no,
        source,
        source_url,
        last_seen_at,
        typically_co_brokes,
        co_broking_notes
      `)
      .order('name', { ascending: params.sort === 'asc' });
    query = applyAgentBrowseFilters(query as unknown as FilterQuery, params) as never;
    const { data, error } = await query.range(offset, offset + params.limit - 1);

    if (error) {
      console.error('Error fetching agents:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const total = count || 0;
    return NextResponse.json({
      agents: data || [],
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
