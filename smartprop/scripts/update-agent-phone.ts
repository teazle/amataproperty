#!/usr/bin/env bun
/**
 * Script to update Test Property 4 agent phone to 6591051399
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

async function updateAgentPhone() {
  console.log('📱 Updating Test Property 4 agent phone to 6591051399...\n');

  try {
    // First, find Test Property 4
    const { data: property, error: propertyError } = await supabase
      .from('listings')
      .select('id, title, agent_id')
      .eq('title', 'Test Property 4 - 4 Bedroom House')
      .single();

    if (propertyError) {
      console.error('❌ Error finding Test Property 4:', propertyError);
      return;
    }

    if (!property) {
      console.error('❌ Test Property 4 not found');
      return;
    }

    console.log(`✅ Found Test Property 4 with agent_id: ${property.agent_id}`);

    // Update the agent's phone number
    const { error: updateError } = await supabase
      .from('agents')
      .update({ phone: '6591051399' })
      .eq('id', property.agent_id);

    if (updateError) {
      console.error('❌ Error updating agent phone:', updateError);
      return;
    }

    console.log('✅ Test Property 4 agent phone updated to 6591051399\n');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the script
updateAgentPhone().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});


