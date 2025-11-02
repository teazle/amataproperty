import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://pfdsmpfgwbbeijdzevpu.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmZHNtcGZnd2JiZWlqZHpldnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTcwMzkyOCwiZXhwIjoyMDc1Mjc5OTI4fQ.placeholder';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testOutreachQuery() {
  try {
    console.log('Testing the exact query used in outreach page...');
    
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
      console.error('Query error:', error);
      return;
    }

    console.log('Query successful!');
    console.log('Total results:', data?.length);
    
    if (data && data.length > 0) {
      console.log('\nFirst listing:');
      console.log('Title:', data[0].title);
      console.log('Agent:', data[0].agents ? `${data[0].agents.name} (${data[0].agents.phone})` : 'No agent');
      console.log('Outreach records:', data[0].outreach?.length || 0);
      
      // Find the Beautiful 3BR Condo listing
      const beautifulCondo = data.find(l => l.title.includes('Beautiful 3BR Condo'));
      if (beautifulCondo) {
        console.log('\nBeautiful 3BR Condo found:');
        console.log('Title:', beautifulCondo.title);
        console.log('Agent:', beautifulCondo.agents ? `${beautifulCondo.agents.name} (${beautifulCondo.agents.phone})` : 'No agent');
        console.log('District:', beautifulCondo.district);
        console.log('Price:', beautifulCondo.price);
        console.log('Outreach records:', beautifulCondo.outreach?.length || 0);
      } else {
        console.log('\nBeautiful 3BR Condo not in first 5 results. Checking all listings...');
        const { data: allData } = await supabase
          .from('listings')
          .select('id, title')
          .ilike('title', '%Beautiful 3BR Condo%');
        console.log('Found:', allData?.length || 0, 'listings with that title');
      }
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

testOutreachQuery();
