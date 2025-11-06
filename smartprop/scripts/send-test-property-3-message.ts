#!/usr/bin/env bun
/**
 * Script to send initial WhatsApp message for Test Property 3
 * Sends viewing request to agent with phone 6597280195
 */

import { createClient } from '@supabase/supabase-js';
import { sendViewingRequest } from '../src/lib/wa/waha';
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

async function sendTestProperty3Message() {
  console.log('🏠 Sending initial message for Test Property 3...\n');

  try {
    // Find Test Property 3 with agent details
    const { data: property, error: propertyError } = await supabase
      .from('listings')
      .select(`
        id,
        title,
        url,
        price,
        district,
        property_type,
        agents!inner(
          id,
          name,
          phone
        )
      `)
      .eq('title', 'Test Property 3 - 2 Bedroom Apartment')
      .single();

    if (propertyError) {
      console.error('❌ Error finding Test Property 3:', propertyError);
      return;
    }

    if (!property) {
      console.error('❌ Test Property 3 not found');
      return;
    }

    console.log('📋 Property Details:');
    console.log(`   Title: ${property.title}`);
    console.log(`   Price: $${property.price?.toLocaleString()}`);
    console.log(`   District: ${property.district}`);
    console.log(`   Type: ${property.property_type}`);
    console.log(`   URL: ${property.url}`);
    console.log();

    console.log('👤 Agent Details:');
    console.log(`   Name: ${property.agents.name}`);
    console.log(`   Phone: ${property.agents.phone}`);
    console.log();

    // Verify this is the correct agent (should be 6592380195)
    if (property.agents.phone !== '6592380195') {
      console.error(`❌ Agent phone mismatch. Expected: 6592380195, Found: ${property.agents.phone}`);
      return;
    }

    // Send the WhatsApp message
    console.log('📱 Sending WhatsApp message...');
    const result = await sendViewingRequest(
      property.agents.phone,
      property.agents.name,
      property.title,
      property.url
    );

    if (result.success) {
      console.log('✅ WhatsApp message sent successfully!');
      console.log(`   Message ID: ${result.messageId}`);
      
      // Log the message that was sent
      console.log('\n📝 Message sent:');
      console.log(`Hi ${property.agents.name.split(' ')[0]}, Jeremy here

I've got a buyer interested in your ${property.title}.

Would you be open to co-broking?

What viewing times do you have available this week?

Thanks!
🔗 ${property.url}`);
    } else {
      console.error('❌ Failed to send WhatsApp message:', result.error);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the script
sendTestProperty3Message().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
