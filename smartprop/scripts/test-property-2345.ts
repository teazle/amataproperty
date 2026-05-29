#!/usr/bin/env bun
/**
 * Test script for property 2345 with viewing timeslots
 * Sets up Monday to Friday, 6pm to 9pm viewing slots
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  console.error('❌ Missing required environment variables');
  console.error('Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Generate next 5 weekdays (Mon-Fri) with dates in Singapore timezone
 */
function generateWeekdaySlots(): Array<{
  day: string;
  date: string;
  time: string;
  formatted: string;
}> {
  const slots = [];
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  
  // Get current date in Singapore timezone
  const now = new Date();
  const _currentDay = now.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'long'
  });
  
  // Start from next Monday (or today if it's Monday and early)
  const checkDate = new Date(now);
  let slotsAdded = 0;
  let daysChecked = 0;
  const maxDaysToCheck = 14; // Check up to 2 weeks ahead
  
  while (slotsAdded < 5 && daysChecked < maxDaysToCheck) {
    const dayName = checkDate.toLocaleString('en-SG', { 
      timeZone: 'Asia/Singapore', 
      weekday: 'long' 
    });
    
    // Only add weekdays (Mon-Fri)
    if (weekdays.includes(dayName)) {
      const dateStr = checkDate.toISOString().split('T')[0]; // YYYY-MM-DD format
      const formattedDate = checkDate.toLocaleDateString('en-SG', {
        timeZone: 'Asia/Singapore',
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      
      slots.push({
        day: dayName,
        date: dateStr,
        time: '6pm to 9pm',
        formatted: `${formattedDate} 6pm to 9pm`
      });
      
      slotsAdded++;
    }
    
    // Move to next day
    checkDate.setDate(checkDate.getDate() + 1);
    daysChecked++;
  }
  
  return slots;
}

async function setupTestProperty() {
  console.log('🏠 Setting up test property 2345...\n');
  
  // Generate viewing slots
  const slots = generateWeekdaySlots();
  
  console.log('📅 Generated viewing slots:');
  slots.forEach((slot, idx) => {
    console.log(`   ${idx + 1}. ${slot.formatted}`);
  });
  console.log();
  
  // Create structured viewing timeslots
  const viewingTimeslotsStructured = {
    available: true,
    slots: slots,
    notes: 'Available for viewing Monday to Friday, 6pm to 9pm',
    raw_text: 'Monday to Friday, 6pm to 9pm'
  };
  
  // Format for text version
  const viewingTimeslots = slots.map(s => s.formatted).join(', ');
  
  // First, check if property URL exists
  const testUrl = 'https://test.example.com/property/2345';
  
  // Create a test agent first
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .upsert({
      name: 'Test Agent',
      phone: '6512345678',
      email: 'test@example.com',
      agency: 'Test Agency',
      cea_reg_no: 'R012345A',
      source: 'edgeprop',
      source_url: 'https://test.example.com/agent/test',
    }, {
      onConflict: 'source,phone',
      ignoreDuplicates: false
    })
    .select('id')
    .single();
  
  if (agentError) {
    console.error('❌ Error creating test agent:', agentError);
    process.exit(1);
  }
  
  console.log('✅ Test agent created:', agent.id);
  
  // Create/update the listing
  const { data: listing, error: listingError } = await supabase
    .from('listings')
    .upsert({
      portal: 'edgeprop',
      url: testUrl,
      title: 'Test Property 2345 - 3 Bedroom Condo',
      price: 5000,
      district: 'District 10',
      property_type: 'Condo',
      address: '123 Test Street, Singapore',
      beds: 3,
      baths: 2,
      size_sqft: 1200,
      agent_id: agent.id,
      viewing_timeslots: viewingTimeslots,
      viewing_timeslots_structured: viewingTimeslotsStructured,
      viewing_status: 'received',
      viewing_requested_at: new Date().toISOString(),
    }, {
      onConflict: 'url',
      ignoreDuplicates: false
    })
    .select('id')
    .single();
  
  if (listingError) {
    console.error('❌ Error creating listing:', listingError);
    process.exit(1);
  }
  
  console.log('✅ Listing created/updated:', listing.id);
  
  // Query to verify
  const { data: verifyListing, error: verifyError } = await supabase
    .from('listings')
    .select('id, title, viewing_timeslots, viewing_timeslots_structured, viewing_status')
    .eq('id', listing.id)
    .single();
  
  if (verifyError) {
    console.error('❌ Error verifying listing:', verifyError);
    process.exit(1);
  }
  
  console.log('\n✅ Property 2345 test setup complete!\n');
  console.log('📋 Summary:');
  console.log(`   Listing ID: ${verifyListing.id}`);
  console.log(`   Title: ${verifyListing.title}`);
  console.log(`   Status: ${verifyListing.viewing_status}`);
  console.log(`   Viewing Slots: ${verifyListing.viewing_timeslots}`);
  console.log('\n📊 Structured Timeslots:');
  console.log(JSON.stringify(verifyListing.viewing_timeslots_structured, null, 2));
  console.log('\n🔗 You can now view this property in the admin panel:');
  console.log('   http://localhost:3000/admin/listings');
  console.log('   http://localhost:3000/admin/viewings');
}

// Run the setup
setupTestProperty().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
