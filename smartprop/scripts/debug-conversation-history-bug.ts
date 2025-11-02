#!/usr/bin/env bun

/**
 * Debug script to reproduce the conversation history bug
 * where decision objects are being stored instead of replyMessage strings
 */

import { getSupabaseClient } from '../src/workers/supa';

async function debugConversationHistoryBug() {
  console.log('🔍 [DEBUG] Starting conversation history bug investigation...');
  
  const supabase = getSupabaseClient();
  
  // First, let's check the current state of problematic entries
  console.log('\n📊 [DEBUG] Checking current problematic entries...');
  
  const { data: allEntries, error } = await supabase
    .from('outreach')
    .select('id, conversation_history, reply_text, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
    
  if (error) {
    console.error('❌ [DEBUG] Error fetching entries:', error);
    return;
  }
  
  // Filter problematic entries in JavaScript
  const problematicEntries = allEntries?.filter(entry => {
    const historyStr = typeof entry.conversation_history === 'string' 
      ? entry.conversation_history 
      : JSON.stringify(entry.conversation_history);
    return historyStr.includes('shouldReply') || 
           historyStr.includes('replyMessage') || 
           historyStr.includes('newPhase');
  }) || [];
  
  console.log(`\n📋 [DEBUG] Found ${problematicEntries?.length || 0} problematic entries:`);
  
  problematicEntries?.forEach((entry, index) => {
    console.log(`\n--- Entry ${index + 1} ---`);
    console.log(`ID: ${entry.id}`);
    console.log(`Created: ${entry.created_at}`);
    console.log(`Reply Text: ${entry.reply_text}`);
    
    // Parse and display conversation history
    let conversationHistory;
    try {
      conversationHistory = typeof entry.conversation_history === 'string' 
        ? JSON.parse(entry.conversation_history) 
        : entry.conversation_history;
    } catch (e) {
      console.log('❌ Failed to parse conversation_history');
      return;
    }
    
    console.log('Conversation History:');
    conversationHistory?.forEach((msg: any, msgIndex: number) => {
      console.log(`  ${msgIndex + 1}. ${msg.role}: ${typeof msg.message === 'string' ? msg.message.substring(0, 100) : JSON.stringify(msg.message).substring(0, 100)}...`);
      
      // Check if message contains decision object properties
      if (typeof msg.message === 'string' && (
        msg.message.includes('shouldReply') || 
        msg.message.includes('replyMessage') || 
        msg.message.includes('newPhase')
      )) {
        console.log('    ⚠️  PROBLEMATIC: Contains decision object properties');
        try {
          const parsed = JSON.parse(msg.message);
          console.log(`    📝 Actual replyMessage should be: "${parsed.replyMessage}"`);
        } catch (e) {
          console.log('    ❌ Failed to parse as JSON');
        }
      }
    });
  });
  
  // Now let's send a test message to see if we can reproduce the bug
  console.log('\n🧪 [DEBUG] Sending test message to reproduce bug...');
  
  try {
    const testResponse = await fetch('http://localhost:3000/api/wa/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: 'message',
        payload: {
          from: '+6591234567', // Test agent phone
          body: 'I can do Tuesday 2pm or Wednesday 3pm for viewing',
          timestamp: new Date().toISOString(),
          id: `test_${Date.now()}`
        }
      })
    });
    
    if (testResponse.ok) {
      console.log('✅ [DEBUG] Test message sent successfully');
      
      // Wait a moment for processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check the latest entry for this agent
      const { data: latestEntry } = await supabase
        .from('outreach')
        .select('id, conversation_history, reply_text, created_at')
        .eq('agent_phone', '+6591234567')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
        
      if (latestEntry) {
        console.log('\n📊 [DEBUG] Latest entry after test message:');
        console.log(`ID: ${latestEntry.id}`);
        console.log(`Reply Text: ${latestEntry.reply_text}`);
        
        let conversationHistory;
        try {
          conversationHistory = typeof latestEntry.conversation_history === 'string' 
            ? JSON.parse(latestEntry.conversation_history) 
            : latestEntry.conversation_history;
        } catch (e) {
          console.log('❌ Failed to parse conversation_history');
          return;
        }
        
        // Check the last message in conversation history
        const lastMessage = conversationHistory?.[conversationHistory.length - 1];
        if (lastMessage) {
          console.log(`Last message role: ${lastMessage.role}`);
          console.log(`Last message content: ${typeof lastMessage.message === 'string' ? lastMessage.message.substring(0, 200) : JSON.stringify(lastMessage.message).substring(0, 200)}...`);
          
          if (typeof lastMessage.message === 'string' && (
            lastMessage.message.includes('shouldReply') || 
            lastMessage.message.includes('replyMessage') || 
            lastMessage.message.includes('newPhase')
          )) {
            console.log('🚨 [DEBUG] BUG REPRODUCED: Last message contains decision object!');
            try {
              const parsed = JSON.parse(lastMessage.message);
              console.log(`🔧 [DEBUG] The replyMessage should be: "${parsed.replyMessage}"`);
            } catch (e) {
              console.log('❌ Failed to parse decision object');
            }
          } else {
            console.log('✅ [DEBUG] Last message looks correct');
          }
        }
      }
    } else {
      console.log('❌ [DEBUG] Failed to send test message:', testResponse.status);
    }
  } catch (error) {
    console.log('❌ [DEBUG] Error sending test message:', error);
  }
  
  console.log('\n🏁 [DEBUG] Investigation complete');
}

// Run the debug script
debugConversationHistoryBug().catch(console.error);