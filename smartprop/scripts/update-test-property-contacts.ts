#!/usr/bin/env bun
/**
 * Update contact numbers for test properties 2, 3, and 5
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// New contact numbers for each test property
const contactUpdates = {
  'Test Property 2 - 3 Bedroom Condo': '6599123456',
  'Test Property 3 - 2 Bedroom Apartment': '6592380195', 
  'Test Property 5 - 1 Bedroom Studio': '6598111111'
};

async function updateTestPropertyContacts() {
  console.log('📞 Updating contact numbers for test properties...\n');

  try {
    // First, get all test properties to find their agent IDs
    const { data: listings, error: fetchError } = await supabase
      .from('listings')
      .select('id, title, agent_id, agents!inner(id, name, phone)')
      .or('title.ilike.%Test Property 2%,title.ilike.%Test Property 3%,title.ilike.%Test Property 5%');

    if (fetchError) {
      console.error('❌ Error fetching test properties:', fetchError);
      process.exit(1);
    }

    if (!listings || listings.length === 0) {
      console.log('❌ No test properties found');
      process.exit(1);
    }

    console.log(`📊 Found ${listings.length} test properties to update:\n`);

    // Update each test property's agent contact number
    for (const listing of listings) {
      const propertyTitle = listing.title;
      const newPhone = contactUpdates[propertyTitle];
      
      if (!newPhone) {
        console.log(`⚠️  No new phone number defined for: ${propertyTitle}`);
        continue;
      }

      const agentId = listing.agent_id;
      const currentPhone = listing.agents?.phone;

      console.log(`📱 Updating ${propertyTitle}:`);
      console.log(`   Agent ID: ${agentId}`);
      console.log(`   Current Phone: ${currentPhone}`);
      console.log(`   New Phone: ${newPhone}`);

      // Update the agent's phone number
      const { error: updateError } = await supabase
        .from('agents')
        .update({ phone: newPhone })
        .eq('id', agentId);

      if (updateError) {
        console.error(`   ❌ Failed to update agent phone:`, updateError);
      } else {
        console.log(`   ✅ Successfully updated agent phone number\n`);
      }
    }

    console.log('🎉 Contact number updates completed!');
    
    // Verify the updates
    console.log('\n🔍 Verifying updates...');
    const { data: updatedListings, error: verifyError } = await supabase
      .from('listings')
      .select('id, title, agents!inner(name, phone)')
      .or('title.ilike.%Test Property 2%,title.ilike.%Test Property 3%,title.ilike.%Test Property 5%');

    if (verifyError) {
      console.error('❌ Error verifying updates:', verifyError);
      return;
    }

    console.log('\n📋 Updated contact numbers:');
    updatedListings?.forEach(listing => {
      console.log(`   ${listing.title}: ${listing.agents?.phone}`);
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

updateTestPropertyContacts();
