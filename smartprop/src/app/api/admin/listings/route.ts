import { getSupabaseClient } from '@/workers/supa';
import { NextRequest,NextResponse } from 'next/server';

/**
 * GET /api/admin/listings
 * Fetch all listings with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    
    const supabase = getSupabaseClient();
    
    let query = supabase
      .from('listings')
      .select(`
        *,
        agents (
          id,
          name,
          phone,
          agency
        )
      `)
      .order('scraped_at', { ascending: false });

    // Apply search filter
    if (search) {
      query = query.or(`title.ilike.%${search}%,address.ilike.%${search}%`);
    }

    // Apply status filter
    if (status) {
      query = query.eq('viewing_status', status);
    }

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: listings, error, count: _count } = await query;

    if (error) {
      throw error;
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('listings')
      .select('*', { count: 'exact', head: true });

    if (search) {
      countQuery = countQuery.or(`title.ilike.%${search}%,address.ilike.%${search}%`);
    }

    if (status) {
      countQuery = countQuery.eq('viewing_status', status);
    }

    const { count: totalCount } = await countQuery;

    return NextResponse.json({ 
      listings: listings || [], 
      pagination: {
        page,
        limit,
        total: totalCount || 0,
        totalPages: Math.ceil((totalCount || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching listings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch listings' },
      { status: 500 }
    );
  }
}
