import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL || 'https://pfdsmpfgwbbeijdzevpu.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmZHNtcGZnd2JiZWlqZHpldnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTcwMzkyOCwiZXhwIjoyMDc1Mjc5OTI4fQ.placeholder';

const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('listings')
      .select(`
        id,
        url,
        title,
        price,
        district,
        property_type,
        portal,
        posted_at,
        scraped_at,
        address,
        beds,
        baths,
        size_sqft,
        viewing_timeslots,
        viewing_status,
        agents!left(
          id,
          name,
          phone,
          email,
          agency,
          cea_reg_no
        ),
        outreach!listing_id(
          id,
          status,
          conversation_phase,
          co_broking_status,
          conversation_history,
          auto_reply_count,
          last_message_at,
          created_at
        )
      `)
      .order('scraped_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('Error fetching listings:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform the data to match our interface
    const transformedData = (data || []).map((item: any) => ({
      ...item,
      agents: item.agents || null, // agents is already an object from the JOIN
      outreach: item.outreach || []
    }));

    return NextResponse.json({ 
      success: true, 
      count: transformedData.length,
      data: transformedData 
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
