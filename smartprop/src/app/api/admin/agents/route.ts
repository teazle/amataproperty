import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '../../../../workers/supa';

/**
 * GET /api/admin/agents
 * Fetch all agents with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';
    
    const supabase = getSupabaseClient();
    
    let query = supabase
      .from('agents')
      .select(`
        *,
        listings:listings(count),
        outreach:outreach(count)
      `)
      .order('last_seen_at', { ascending: false });

    // Apply search filter
    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,agency.ilike.%${search}%`);
    }

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

    if (search) {
      countQuery = countQuery.or(`name.ilike.%${search}%,phone.ilike.%${search}%,agency.ilike.%${search}%`);
    }

    const { count: totalCount } = await countQuery;

    return NextResponse.json({ 
      agents: agents || [], 
      pagination: {
        page,
        limit,
        total: totalCount || 0,
        totalPages: Math.ceil((totalCount || 0) / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}
