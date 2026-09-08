import { getSupabaseClient } from '@/workers/supa';
import { NextRequest,NextResponse } from 'next/server';
import { ADMIN_LISTING_ROW_SELECT, applyListingBrowseFilters, FilterQuery, parseListingBrowseParams } from '@/lib/admin-browsing';

/**
 * GET /api/admin/listings
 * Fetch all listings with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = parseListingBrowseParams(searchParams);
    const { page, limit } = params;
    
    const supabase = getSupabaseClient();
    
    let query = supabase
      .from('listings')
      .select(ADMIN_LISTING_ROW_SELECT)
      .order('scraped_at', { ascending: false });

    query = applyListingBrowseFilters(query as unknown as FilterQuery, params) as never;

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
      .select('*, matched_agent:agents()', { count: 'exact', head: true });
    countQuery = applyListingBrowseFilters(countQuery as unknown as FilterQuery, params) as never;

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
