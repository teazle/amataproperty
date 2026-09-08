import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { applyAgentBrowseFilters, FilterQuery, mapAgentRelationCounts, parseAgentBrowseParams } from '@/lib/admin-browsing';

/**
 * GET /api/admin/agents
 * Fetch all agents with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = parseAgentBrowseParams(searchParams);
    const { page, limit } = params;
    
    const supabase = getSupabaseClient();
    
    let query = supabase
      .from('agents')
      .select(`
        *,
        listings:listings(count),
        outreach:outreach(count)
      `)
      .order('name', { ascending: params.sort === 'asc' });

    query = applyAgentBrowseFilters(query as unknown as FilterQuery, params) as never;

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: agents, error } = await query;

    if (error) {
      throw error;
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('agents')
      .select('*', { count: 'exact', head: true });

    countQuery = applyAgentBrowseFilters(countQuery as unknown as FilterQuery, params) as never;

    const { count: totalCount } = await countQuery;

    return NextResponse.json({ 
      agents: (agents || []).map(mapAgentRelationCounts),
      pagination: {
        page,
        limit,
        total: totalCount || 0,
        totalPages: Math.ceil((totalCount || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}
