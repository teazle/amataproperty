#!/usr/bin/env bun
/**
 * Test script to simulate the "Are you a bot?" scenario
 * This will help us understand why the AI responded when analysis said it shouldn't
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import type { ConversationContext,ConversationMessage } from '../src/lib/ai/conversation';
import { analyzeConversationWithAdvancedContext } from '../src/lib/ai/conversation';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const _supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function testBotQuestionScenario() {
  console.log('🤖 Testing "Are you a bot?" scenario...\n');

  // Simulate the conversation history up to the point where agent asks "Are you a bot?"
  const conversationHistory: ConversationMessage[] = [
    {
      role: 'user',
      message: 'Hi Test, Jeremy here\n\nI have a buyer who is interested in your Beautiful 3BR Condo in District 9.\n\nWould you be open to co-broking?\n\n🔗 https://www.propertyguru.com.sg/listing/test-property-12345678',
      timestamp: '2025-10-30T00:55:00.540Z'
    },
    {
      role: 'agent',
      message: 'Sat 9p.',
      timestamp: '2025-10-30T00:55:34.956Z'
    },
    {
      role: 'user',
      message: 'Thanks for sharing the availability. The slots you suggested (Saturday, 9pm) work great. I\'ll coordinate with my buyer and confirm the exact timing shortly. Would you be open to co-broking on this one?',
      timestamp: '2025-10-30T00:55:38.646Z'
    },
    {
      role: 'agent',
      message: 'Ok',
      timestamp: '2025-10-30T00:55:44.943Z'
    },
    {
      role: 'user',
      message: '"Awesome, thanks for confirming! Looking forward to meeting you on Saturday at 9pm to check out the property. Let\'s discuss the details in person then, sounds good?"',
      timestamp: '2025-10-30T00:55:48.767Z'
    },
    {
      role: 'agent',
      message: 'Ok',
      timestamp: '2025-10-30T00:55:58.220Z'
    },
    {
      role: 'user',
      message: '"Awesome, thanks for confirming! I\'m looking forward to checking out the property on Saturday at 9pm. Shall we discuss the details then, it\'ll be great to see the place in person and go from there. See you Saturday!"',
      timestamp: '2025-10-30T00:56:02.095Z'
    },
    {
      role: 'agent',
      message: 'Why are you repeating yourseld',
      timestamp: '2025-10-30T00:56:15.793Z'
    },
    {
      role: 'user',
      message: '"No worries at all, I think I might have miscommunicated something. Let\'s catch up on all the details in person on Saturday at 9pm. I\'m really looking forward to meeting you then and discussing everything in more depth. See you then."',
      timestamp: '2025-10-30T00:56:19.652Z'
    }
  ];

  // The problematic message
  const agentMessage = 'Are you a bot ?';

  // Build conversation context
  const context: ConversationContext = {
    agentMessage,
    conversationHistory,
    currentPhase: 'timeslots_received',
    daysElapsed: 0,
    deflectionCount: 0,
    autoReplyCount: 5,
    firstMessageSentAt: new Date('2025-10-30T00:55:00.540Z'),
    lastMessageAt: new Date('2025-10-30T00:56:19.652Z'),
    previousCoBrokingStatus: 'willing',
    objectivesStatus: {
      timeslotsReceived: true,
      coBrokingConfirmed: true,
      coBrokingStatus: 'willing'
    }
  };

  const agentProfile = {
    name: 'Test Agent',
    agency: 'Test Agency',
    experience: 'Unknown'
  };
  
  const propertyContext = {
    title: 'Beautiful 3BR Condo in District 9',
    price: 0,
    district: 'District 9',
    propertyType: 'Condo'
  };

  console.log('📊 Context:', {
    phase: context.currentPhase,
    autoReplyCount: context.autoReplyCount,
    objectivesStatus: context.objectivesStatus
  });

  console.log('\n🤖 Analyzing with AI...');
  
  try {
    const decision = await analyzeConversationWithAdvancedContext(
      context, 
      agentProfile, 
      propertyContext
    );

    console.log('\n🎯 AI Decision:');
    console.log('  shouldReply:', decision.shouldReply);
    console.log('  reason:', decision.reason);
    console.log('  replyMessage:', decision.replyMessage);
    console.log('  coBrokingStatus:', decision.coBrokingStatus);
    console.log('  timeslotsReceived:', decision.timeslotsReceived);
    console.log('  gracefulExit:', decision.gracefulExit);
    console.log('  newPhase:', decision.newPhase);

    if (decision.shouldReply) {
      console.log('\n✅ AI would reply with:', decision.replyMessage);
    } else {
      console.log('\n❌ AI would NOT reply because:', decision.reason);
    }

  } catch (error) {
    console.error('❌ Error during AI analysis:', error);
  }
}

// Run the test
testBotQuestionScenario().catch(console.error);