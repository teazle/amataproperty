import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 });
    }

    const select = [
      'id',
      'portal',
      'url',
      'title',
      'price',
      'district',
      'property_type',
      'agent_id',
      'posted_at',
      'scraped_at',
      'address',
      'beds',
      'baths',
      'size_sqft',
      'price_psf',
      'year_built',
      'tenure',
      'viewing_requested_at',
      'viewing_timeslots',
      'viewing_status',
      'viewing_timeslots_structured',
      'agents!left(id,name,phone,email,agency,cea_reg_no,source,source_url,last_seen_at)',
      'outreach!left(id,status,conversation_phase,co_broking_status,co_broking_notes,last_message_at,auto_reply_count)',
    ].join(',');

    const url = new URL(`${supabaseUrl}/rest/v1/listings`);
    url.searchParams.set('select', select);
    url.searchParams.set('order', 'scraped_at.desc');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const res = await fetch(url.toString(), {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Error fetching listings via REST:', res.status, text);
      return NextResponse.json({ error: `Failed to fetch listings (${res.status})` }, { status: res.status });
    }

    const data = await res.json().catch(() => null);
    const range = res.headers.get('content-range');
    let total = 0;
    if (range) {
      const parts = range.split('/');
      const totalStr = parts[1] || '0';
      total = parseInt(totalStr, 10) || 0;
    }
    const hasMore = offset + limit < total;

    return NextResponse.json({
      listings: Array.isArray(data) ? data : [],
      page,
      limit,
      total,
      hasMore,
      method: 'undici-rest',
    });
  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
