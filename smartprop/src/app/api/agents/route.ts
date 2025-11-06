import { NextResponse } from 'next/server';
import { getSupabaseClient } from '../../../workers/supa';

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
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
      .order('last_seen_at', { ascending: false });

    if (error) {
      console.error('Error fetching agents:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ agents: data || [] });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


