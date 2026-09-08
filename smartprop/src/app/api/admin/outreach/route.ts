import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

/**
 * Auth is enforced by the /api/admin middleware matcher. Keeping private
 * outreach reads on this service-role route prevents browser-side Supabase
 * access from bypassing RLS.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = positiveInteger(searchParams.get('page'), 1, 100_000);
    const limit = positiveInteger(searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
    const status = searchParams.get('status');
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const supabase = getSupabaseClient();

    let query = supabase
      .from('outreach')
      .select(`
        id,
        agent_id,
        listing_id,
        status,
        channel,
        template_name,
        created_at,
        first_message_sent_at,
        last_message_at,
        agents!left(id, name, phone, agency),
        listings!left(id, title, url, district, price, scraped_at)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({
      outreach: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('Failed to load admin outreach:', error);
    return NextResponse.json({ error: 'Failed to load outreach' }, { status: 500 });
  }
}
