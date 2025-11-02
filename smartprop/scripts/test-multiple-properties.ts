#!/usr/bin/env bun
/**
 * Test script for multiple properties with viewing timeslots
 * Creates properties: 2345, 3, 4, 5
 * All with Monday to Friday, 6pm to 9pm viewing slots
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
    checkDate.setDate(checkDate.getDate() +1);
    daysChecked++;
  }
  
  return slots;
}

async function createTestProperty(propertyNumber: number, agentId: string) {
  // Generate viewing slots
  const slots = generateWeekdaySlots();
  
  // Create structured viewing timeslots
  const viewingTimeslotsStructured = {
    available: true,
    slots: slots,
    notes: 'Available for viewing Monday to Friday, 6pm to 9pm',
    raw_text: 'Monday to Friday, 6pm to 9pm'
  };
  
  // Format for text version
  const viewingTimeslots = slots.map(s => s.formatted).join(', ');
  
  const testUrl = `https://test.example.com/property/${propertyNumber}`;
  
  // Define property-specific details
  const propertyDetails = {
    2345: {
      title: 'Test Property 2345 - 3 Bedroom Condo',
      price: 5000,
      district: 'District 10',
      property_type: 'Condo',
      address: '123 River Valley Road, Singapore 238123',
      beds: 3,
      baths: 2,
      size_sqft: 1200,
      price_psf: 4.17,
      year_built: 2018,
      tenure: 'Freehold'
    },
    3: {
      title: 'Test Property 3 - 2 Bedroom Apartment',
      price: 3500,
      district: 'District 9',
      property_type: 'Condo',
      address: '45 Orchard Boulevard, Singapore 248649',
      beds: 2,
      baths: 2,
      size_sqft: 950,
      price_psf: 3.68,
      year_built: 2020,
      tenure: 'Freehold'
    },
    4: {
      title: 'Test Property 4 - 4 Bedroom House',
      price: 8000,
      district: 'District 11',
      property_type: 'Landed',
      address: '78 Bukit Timah Road, Singapore 589721',
      beds: 4,
      baths: 3,
      size_sqft: 2200,
      price_psf: 3.64,
      year_built: 2015,
      tenure: 'Freehold'
    },
    5: {
      title: 'Test Property 5 - 1 Bedroom Studio',
      price: 2800,
      district: 'District 1',
      property_type: 'Condo',
      address: '12 Marina Boulevard, Singapore 018982',
      beds: 1,
      baths: 1,
      size_sqft: 650,
      price_psf: 4.31,
      year_built: 2022,
      tenure: '99 years'
    }
  };
  
  const details = propertyDetails[propertyNumber as keyof typeof propertyDetails];
  
  // Create/update the listing
  const { data: listing, error: listingError } = await supabase
    .from('listings')
    .upsert({
      portal: 'edgeprop',
      url: testUrl,
      title: details.title,
      price: details.price,
      district: details.district,
      property_type: details.property_type,
      address: details.address,
      beds: details.beds,
      baths: details.baths,
      size_sqft: details.size_sqft,
      price_psf: details.price_psf,
      year_built: details.year_built,
      tenure: details.tenure,
      agent_id: agentId,
      viewing_timeslots: viewingTimeslots,
      viewing_timeslots_structured: viewingTimeslotsStructured,
      viewing_status: 'received',
      viewing_requested_at: new Date().toISOString(),
    }, {
      onConflict: 'url',
      ignoreDuplicates: false
    })
    .select('id, title')
    .single();
  
  if (listingError) {
    console.error(`❌ Error creating property ${propertyNumber}:`, listingError);
    return null;
  }
  
  return listing;
}

async function setupTestProperties() {
  console.log('🏠 Setting up multiple test properties...\n');
  
  const propertyNumbers = [2345, 3, 4, 5];
  
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
  console.log();
  
  // Show the viewing slots once (same for all properties)
  const slots = generateWeekdaySlots();
  console.log('📅 Viewing slots (same for all properties):');
  slots.forEach((slot, idx) => {
    console.log(`   ${idx + 1}. ${slot.formatted}`);
  });
  console.log();
  
  // Create all properties
  const createdProperties = [];
  for (const propNum of propertyNumbers) {
    console.log(`Creating Test Property ${propNum}...`);
    const listing = await createTestProperty(propNum, agent.id);
    if (listing) {
      createdProperties.push(listing);
      console.log(`✅ Property ${propNum} created: ${listing.title}`);
    }
    console.log();
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ All test properties setup complete!\n');
  console.log('📋 Summary:');
  createdProperties.forEach((prop, idx) => {
    console.log(`   ${idx + 1}. ${prop.title}`);
    console.log(`      ID: ${prop.id}`);
  });
  
  console.log('\n🔗 View these properties in the admin panel:');
  console.log('   http://localhost:3000/admin/listings');
  console.log('   http://localhost:3000/admin/viewings');
}

// Run the setup
setupTestProperties().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

