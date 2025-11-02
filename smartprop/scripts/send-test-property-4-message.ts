#!/usr/bin/env bun
/**
 * Script to send initial WhatsApp message for Test Property 4
 * Sends co-broking inquiry to agent with phone 6591051399
 */

import { createClient } from '@supabase/supabase-js';
import { sendCoBrokingInquiry, generateCoBrokingInquiryMessage } from '../src/lib/wa/waha';
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

async function sendTestProperty4Message() {
  console.log('🏠 Sending initial message for Test Property 4...\n');

  try {
    // Find Test Property 4 with agent details
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

    console.log('📋 Property Details:');
    console.log(`   Title: ${property.title}`);
    console.log(`   Price: $${property.price?.toLocaleString()}`);
    console.log(`   District: ${property.district}`);
    console.log(`   Type: ${property.property_type}`);
    console.log(`   URL: ${property.url}`);
    console.log();

    console.log('👤 Agent Details:');
    console.log(`   ID: ${property.agents.id}`);
    console.log(`   Name: ${property.agents.name}`);
    console.log(`   Phone: ${property.agents.phone}`);
    console.log();

    // Verify this is the correct agent (should be 6591051399)
    if (property.agents.phone !== '6591051399') {
      console.error(`❌ Agent phone mismatch. Expected: 6591051399, Found: ${property.agents.phone}`);
      return;
    }

    // Send the WhatsApp message
    console.log('📱 Sending WhatsApp co-broking inquiry...');
    const messageText = generateCoBrokingInquiryMessage(
      property.agents.name,
      property.title,
      property.url
    );

    const result = await sendCoBrokingInquiry(
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
      console.log(messageText);

      const now = new Date().toISOString();
      const messageEntry = {
        role: 'user',
        message: messageText,
        timestamp: now,
      };

      // Ensure an outreach record exists with conversation history
      const { data: existingOutreach } = await supabase
        .from('outreach')
        .select('id, conversation_history, conversation_phase, auto_reply_count, first_message_sent_at')
        .eq('agent_id', property.agents.id)
        .eq('listing_id', property.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingOutreach) {
        console.log(`ℹ️  Found existing outreach record ${existingOutreach.id}, resetting conversation state`);
        const history = [messageEntry];

        const { error: updateError } = await supabase
          .from('outreach')
          .update({
            channel: 'whatsapp',
            status: 'sent',
            message_text: messageText,
            conversation_history: history,
            conversation_phase: 'initial_request',
            conversation_state: 'awaiting_timeslots',
            co_broking_status: 'unknown',
            auto_reply_count: 0,
            deflection_count: 0,
            first_message_sent_at: now,
            last_message_at: now,
            replied_at: null,
            reply_text: null,
            wa_conversation_id: result.messageId || null,
          })
          .eq('id', existingOutreach.id);
        if (updateError) {
          console.error('⚠️  Failed to update existing outreach record:', updateError);
        } else {
          console.log('✅ Outreach state reset for new conversation');
        }
      } else {
        console.log('ℹ️  Creating new outreach record for this agent/listing');
        const { error: insertError } = await supabase
          .from('outreach')
          .insert({
            agent_id: property.agents.id,
            listing_id: property.id,
            channel: 'whatsapp',
            status: 'sent',
            message_text: messageText,
            conversation_history: [messageEntry],
            conversation_phase: 'initial_request',
            auto_reply_count: 0,
            first_message_sent_at: now,
            last_message_at: now,
            wa_conversation_id: result.messageId || null,
          });
        if (insertError) {
          console.error('⚠️  Failed to create outreach record:', insertError);
        } else {
          console.log('✅ Outreach record created');
        }
      }

      // Update listing status for completeness
      const { error: listingUpdateError } = await supabase
        .from('listings')
        .update({
          viewing_status: 'requested',
          viewing_requested_at: now,
        })
        .eq('id', property.id);
      if (listingUpdateError) {
        console.error('⚠️  Failed to update listing status:', listingUpdateError);
      }
    } else {
      console.error('❌ Failed to send WhatsApp message:', result.error);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the script
sendTestProperty4Message().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
