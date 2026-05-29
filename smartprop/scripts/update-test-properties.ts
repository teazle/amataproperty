#!/usr/bin/env bun
/**
 * Update specific test properties:
 * - Change Test Property 4 agent contact number to 6596612002
 * - Rename Test Property 2345 to Test Property 2
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local only
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  console.error('❌ Missing required environment variables');
  console.error('Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function updateTestProperties() {
  console.log('🔄 Updating test properties...\n');
  
  // 1. Update Test Property 4 agent contact number
  console.log('📱 Updating Test Property 4 agent contact number to 6596612002...');
  
  const { data: property4, error: property4Error } = await supabase
    .from('listings')
    .select('id, title, agent_id')
    .eq('url', 'https://test.example.com/property/4')
    .single();
  
  if (property4Error) {
    console.error('❌ Error finding Test Property 4:', property4Error);
    process.exit(1);
  }
  
  if (!property4) {
    console.error('❌ Test Property 4 not found');
    process.exit(1);
  }
  
  // Update the agent's phone number
  const { error: agentUpdateError } = await supabase
    .from('agents')
    .update({ phone: '6596612002' })
    .eq('id', property4.agent_id);
  
  if (agentUpdateError) {
    console.error('❌ Error updating agent phone:', agentUpdateError);
    process.exit(1);
  }
  
  console.log('✅ Test Property 4 agent contact number updated to 6596612002\n');
  
  // 2. Rename Test Property 2345 to Test Property 2
  console.log('🏷️  Renaming Test Property 2345 to Test Property 2...');
  
  const { data: property2345, error: property2345Error } = await supabase
    .from('listings')
    .select('id, title, url, address, beds, baths, size_sqft, price_psf, year_built, tenure')
    .eq('url', 'https://test.example.com/property/2345')
    .single();
  
  if (property2345Error) {
    console.error('❌ Error finding Test Property 2345:', property2345Error);
    process.exit(1);
  }
  
  if (!property2345) {
    console.error('❌ Test Property 2345 not found');
    process.exit(1);
  }
  
  // Update the listing title and URL
  const { error: listingUpdateError } = await supabase
    .from('listings')
    .update({
      title: 'Test Property 2 - 3 Bedroom Condo',
      url: 'https://test.example.com/property/2',
      address: '123 River Valley Road, Singapore 238123',
      beds: 3,
      baths: 2,
      size_sqft: 1200,
      price_psf: 4.17,
      year_built: 2018,
      tenure: 'Freehold'
    })
    .eq('id', property2345.id);
  
  if (listingUpdateError) {
    console.error('❌ Error updating listing:', listingUpdateError);
    process.exit(1);
  }
  
  console.log('✅ Test Property 2345 renamed to Test Property 2\n');
  
  // Verify the changes
  console.log('🔍 Verifying changes...\n');
  
  const { data: allTestProperties, error: verifyError } = await supabase
    .from('listings')
    .select(`
      id,
      title,
      url,
      agents!inner(name, phone)
    `)
    .or('url.ilike.%test%,title.ilike.%test%')
    .order('title');
  
  if (verifyError) {
    console.error('❌ Error verifying changes:', verifyError);
    process.exit(1);
  }
  
  console.log('📋 Updated test properties:');
  allTestProperties?.forEach((property, index) => {
    const agent = property.agents as unknown;
    console.log(`${index + 1}. ${property.title}`);
    console.log(`   URL: ${property.url}`);
    console.log(`   Agent: ${agent?.name} (${agent?.phone})`);
    console.log();
  });
  
  console.log('🎉 All updates completed successfully!');
}

// Run the updates
updateTestProperties().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
