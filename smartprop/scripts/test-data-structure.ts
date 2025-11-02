import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://pfdsmpfgwbbeijdzevpu.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmZHNtcGZnd2JiZWlqZHpldnB1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTcwMzkyOCwiZXhwIjoyMDc1Mjc5OTI4fQ.placeholder';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testDataStructure() {
  try {
    console.log('Testing data structure...');
    
    // Test 1: Check if we have listings
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id, title, agent_id')
      .limit(3);
    
    console.log('\n1. Listings data:');
    console.log('Error:', listingsError);
    console.log('Count:', listings?.length);
    if (listings && listings.length > 0) {
      console.log('Sample:', listings[0]);
    }

    // Test 2: Check agents
    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('id, name, phone')
      .limit(3);
    
    console.log('\n2. Agents data:');
    console.log('Error:', agentsError);
    console.log('Count:', agents?.length);
    if (agents && agents.length > 0) {
      console.log('Sample:', agents[0]);
    }

    // Test 3: Check the JOIN query we're using
    const { data: joinedData, error: joinError } = await supabase
      .from('listings')
      .select(`
        id,
        title,
        agents!left(
          id,
          name,
          phone
        )
      `)
      .limit(1);
    
    console.log('\n3. JOIN query result:');
    console.log('Error:', joinError);
    if (joinedData && joinedData.length > 0) {
      console.log('Sample:', JSON.stringify(joinedData[0], null, 2));
    }

    // Test 4: Find the specific listing
    const { data: specificListing, error: specificError } = await supabase
      .from('listings')
      .select(`
        id,
        title,
        agents!left(
          id,
          name,
          phone
        )
      `)
      .ilike('title', '%Beautiful 3BR Condo%')
      .limit(1);
    
    console.log('\n4. Specific listing (Beautiful 3BR Condo):');
    console.log('Error:', specificError);
    if (specificListing && specificListing.length > 0) {
      console.log('Found:', JSON.stringify(specificListing[0], null, 2));
    } else {
      console.log('Not found - checking all titles...');
      const { data: allTitles } = await supabase
        .from('listings')
        .select('title')
        .limit(10);
      console.log('Available titles:', allTitles?.map(l => l.title));
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

testDataStructure();
