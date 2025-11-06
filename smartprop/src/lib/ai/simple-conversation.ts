/**
 * Simple Conversation System - Based on Rasa patterns
 * 
 * This is a simplified, robust conversation system that:
 * 1. Saves every message immediately to database
 * 2. Analyzes conversation state simply
 * 3. Updates state and sends reply
 * 4. No complex async processing - just simple, reliable flow
 */

import { getSupabaseClient } from '../../workers/supa';
import { sendAutoReply } from './conversation';

export interface SimpleConversationState {
  agentPhone: string;
  conversationHistory: Array<{
    role: 'user' | 'agent';
    message: string;
    timestamp: string;
  }>;
  coBrokingStatus: 'unknown' | 'willing' | 'not_willing' | 'needs_discussion';
  timeslotsReceived: boolean;
  timeslotsText?: string;
  conversationPhase: 'initial_request' | 'agent_engaging' | 'timeslots_received' | 'gracefully_ended';
  lastMessageAt: string;
}

export async function processSimpleConversation(
  agentPhone: string,
  messageText: string,
  timestamp: string
): Promise<void> {
  console.log(`🔇 [SIMPLE] Handler disabled for ${agentPhone} - delegating to advanced pipeline`);
  return;
}

async function getConversationState(agentPhone: string): Promise<SimpleConversationState & { outreachId: string; autoReplyCount: number }> {
  const supabase = getSupabaseClient();
  
  // Find agent
  const { data: agents } = await supabase
    .from('agents')
    .select('id')
    .or(`phone.eq.${agentPhone},phone.eq.65${agentPhone}`)
    .limit(1);
  
  if (!agents || agents.length === 0) {
    throw new Error(`Agent not found for phone ${agentPhone}`);
  }
  
  const agentId = agents[0].id;
  
  // Get outreach record
  const { data: outreachRecords } = await supabase
    .from('outreach')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (!outreachRecords || outreachRecords.length === 0) {
    throw new Error(`No outreach record found for agent ${agentId}`);
  }
  
  const outreach = outreachRecords[0];
  
  // Parse conversation history
  const conversationHistory = Array.isArray(outreach.conversation_history)
    ? outreach.conversation_history
    : (typeof outreach.conversation_history === 'string'
      ? JSON.parse(outreach.conversation_history)
      : []);
  
  return {
    agentPhone,
    conversationHistory,
    coBrokingStatus: outreach.co_broking_status || 'unknown',
    timeslotsReceived: outreach.timeslots_detected || false,
    timeslotsText: outreach.timeslots_text,
    conversationPhase: outreach.conversation_phase || 'initial_request',
    lastMessageAt: outreach.last_message_at || new Date().toISOString(),
    outreachId: outreach.id,
    autoReplyCount: outreach.auto_reply_count || 0
  };
}

function analyzeConversationState(state: SimpleConversationState): {
  coBrokingStatus: 'unknown' | 'willing' | 'not_willing' | 'needs_discussion';
  timeslotsReceived: boolean;
  timeslotsText?: string;
  conversationPhase: 'initial_request' | 'agent_engaging' | 'timeslots_received' | 'gracefully_ended';
  shouldReply: boolean;
} {
  const latestMessage = state.conversationHistory[state.conversationHistory.length - 1]?.message.toLowerCase() || '';
  
  // Simple pattern matching for co-broking status
  let coBrokingStatus = state.coBrokingStatus;
  if (latestMessage.includes('yes') || latestMessage.includes('sure') || latestMessage.includes('agree') || latestMessage.includes('willing')) {
    coBrokingStatus = 'willing';
  } else if (latestMessage.includes('no') || latestMessage.includes('not willing') || latestMessage.includes('decline')) {
    coBrokingStatus = 'not_willing';
  }
  
  // Simple pattern matching for timeslots
  const timeslotPatterns = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'am', 'pm', 'morning', 'afternoon', 'evening',
    'available', 'free', 'can show'
  ];
  
  const timeslotsReceived = timeslotPatterns.some(pattern => latestMessage.includes(pattern));
  const timeslotsText = timeslotsReceived ? latestMessage : undefined;
  
  // Determine conversation phase
  let conversationPhase = state.conversationPhase;
  if (coBrokingStatus === 'willing' && timeslotsReceived) {
    conversationPhase = 'timeslots_received';
  } else if (coBrokingStatus === 'willing') {
    conversationPhase = 'agent_engaging';
  } else if (timeslotsReceived) {
    conversationPhase = 'timeslots_received';
  } else if (coBrokingStatus === 'not_willing') {
    conversationPhase = 'gracefully_ended';
  }
  
  // Determine if we should reply
  const shouldReply = conversationPhase !== 'gracefully_ended' && 
                     !(coBrokingStatus === 'willing' && timeslotsReceived);
  
  return {
    coBrokingStatus,
    timeslotsReceived,
    timeslotsText,
    conversationPhase,
    shouldReply
  };
}

function generateReply(state: SimpleConversationState, analysis: any): string {
  if (analysis.coBrokingStatus === 'willing' && !analysis.timeslotsReceived) {
    return "Great. When would be a good time for viewing this week?";
  }
  
  if (analysis.coBrokingStatus === 'not_willing') {
    return "I understand. Thank you for your time and for letting me know about your policy. I appreciate your honesty. Best of luck with the listing.";
  }
  
  if (analysis.timeslotsReceived && analysis.coBrokingStatus === 'willing') {
    return "Perfect. Thank you for confirming co-broking and providing the viewing times. I'll coordinate with my buyer and get back to you shortly.";
  }
  
  if (analysis.coBrokingStatus === 'unknown') {
    return "Are you open to co-broking arrangements?";
  }
  
  return "Thank you for your message. I'd be happy to discuss this further with you.";
}

async function saveConversationState(state: SimpleConversationState & { outreachId: string; autoReplyCount: number }): Promise<void> {
  const supabase = getSupabaseClient();
  
  const updateData = {
    conversation_history: state.conversationHistory,
    co_broking_status: state.coBrokingStatus,
    conversation_phase: state.conversationPhase,
    last_message_at: state.lastMessageAt,
    auto_reply_count: state.autoReplyCount,
    conversation_state: state.conversationPhase === 'gracefully_ended' ? 'failed' : 'awaiting_timeslots'
  };
  
  const { error } = await supabase
    .from('outreach')
    .update(updateData)
    .eq('id', state.outreachId);
  
  if (error) {
    throw new Error(`Failed to save conversation state: ${error.message}`);
  }
}
