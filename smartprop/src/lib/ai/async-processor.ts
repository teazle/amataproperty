/**
 * Asynchronous AI Message Processing
 * Handles AI analysis and response generation without blocking webhook
 */

import { getSupabaseClient } from '@/workers/supa';
import { analyzeConversationWithAdvancedContext } from './conversation';
import { sendAutoReply } from './conversation';
import { ConversationContext, ConversationMessage } from './conversation';

export interface AsyncMessagePayload {
  agentPhone: string;
  messageText: string;
  timestamp: string;
  messageId?: string;
}

/**
 * Process message asynchronously without blocking webhook
 */
export async function processMessageAsync(payload: AsyncMessagePayload): Promise<void> {
  console.log(`🚀 [ASYNC] Starting background processing for ${payload.agentPhone}`);
  
  try {
    const supabase = getSupabaseClient();
    
    // Find the agent
    const { data: agents } = await supabase
      .from('agents')
      .select('id')
      .or(`phone.eq.${payload.agentPhone},phone.eq.65${payload.agentPhone}`)
      .limit(1);

    if (!agents || agents.length === 0) {
      console.log('⚠️  [ASYNC] No agent found, skipping processing');
      return;
    }

    const agentId = agents[0].id;
    console.log(`🔍 [ASYNC] Processing for agent ID: ${agentId}`);

    // Get the most recent outreach record
    const { data: outreachRecords } = await supabase
      .from('outreach')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!outreachRecords || outreachRecords.length === 0) {
      console.log('⚠️  [ASYNC] No outreach records found, skipping processing');
      return;
    }

    const outreach = outreachRecords[0];
    console.log(`📋 [ASYNC] Found outreach record: ${outreach.id}`);

    // Calculate days elapsed
    const firstMessageDate = outreach.first_message_sent_at 
      ? new Date(outreach.first_message_sent_at)
      : new Date(outreach.created_at);
    const now = new Date();
    const daysElapsed = Math.floor((now.getTime() - firstMessageDate.getTime()) / (1000 * 60 * 60 * 24));

    // Get conversation history
    const conversationHistory: ConversationMessage[] = Array.isArray(outreach.conversation_history)
      ? outreach.conversation_history
      : (typeof outreach.conversation_history === 'string'
        ? JSON.parse(outreach.conversation_history)
        : []);
    
    // Add agent's message to history
    conversationHistory.push({
      role: 'agent',
      message: payload.messageText,
      timestamp: new Date().toISOString()
    });

    // Build conversation context with proper objectives status from database
    const context: ConversationContext = {
      agentMessage: payload.messageText,
      conversationHistory,
      currentPhase: outreach.conversation_phase || 'initial_request',
      daysElapsed,
      deflectionCount: outreach.deflection_count || 0,
      autoReplyCount: outreach.auto_reply_count || 0,
      firstMessageSentAt: outreach.first_message_sent_at,
      lastMessageAt: outreach.last_message_at,
      previousCoBrokingStatus: outreach.co_broking_status || 'unknown',
      objectivesStatus: {
        timeslotsReceived: outreach.conversation_phase === 'timeslots_received' || 
                          outreach.conversation_phase === 'viewing_confirmed' ||
                          outreach.conversation_phase === 'completed',
        coBrokingConfirmed: outreach.co_broking_status === 'willing' || 
                           outreach.co_broking_status === 'not_willing',
        coBrokingStatus: outreach.co_broking_status || 'unknown'
      }
    };

    console.log('📊 [ASYNC] Conversation Context:', {
      phase: context.currentPhase,
      daysElapsed: context.daysElapsed,
      historyLength: context.conversationHistory.length
    });

    // Get agent and property context for advanced analysis
    const agentProfile = {
      name: outreach.agents?.name || 'Unknown Agent',
      agency: outreach.agents?.agency,
      experience: 'Unknown'
    };
    
    const propertyContext = {
      title: outreach.listings?.title || 'Property',
      price: outreach.listings?.price || 0,
      district: outreach.listings?.district || 'Unknown',
      propertyType: outreach.listings?.property_type || 'Unknown'
    };
    
    console.log('🤖 [ASYNC] Starting AI analysis...');
    
    // Analyze with advanced AI (this is the slow part)
    const decision = await analyzeConversationWithAdvancedContext(
      context, 
      agentProfile, 
      propertyContext
    );

    console.log('🎯 [ASYNC] AI Decision:', {
      shouldReply: decision.shouldReply,
      reason: decision.reason,
      coBrokingStatus: decision.coBrokingStatus
    });

    // Normalize conversation phase to valid database values
    const normalizePhase = (phase: string): string => {
      const validPhases = [
        'initial_request',
        'agent_engaging',
        'agent_checking',
        'agent_stalling',
        'timeslots_received',
        'gracefully_ended',
        'property_unavailable'
      ];
      
      // Map AI-returned phases to valid database phases
      const phaseMap: Record<string, string> = {
        'co-broking_agreed': 'agent_engaging',
        'co-broking_agreement': 'agent_engaging',
        'co_broking_agreed': 'agent_engaging',
        'co_broking_agreement': 'agent_engaging',
        'objectives_achieved': 'timeslots_received',
        'awaiting_cobroking_confirmation': 'agent_engaging',
        'awaiting_timeslots': 'agent_engaging',
      };
      
      // Check if phase is already valid
      if (validPhases.includes(phase)) {
        return phase;
      }
      
      // Check if we have a mapping
      if (phaseMap[phase]) {
        return phaseMap[phase];
      }
      
      // Default fallback based on objectives
      if (decision.timeslotsReceived && decision.coBrokingStatus === 'willing') {
        return 'timeslots_received';
      }
      if (decision.gracefulExit) {
        return 'gracefully_ended';
      }
      if (decision.coBrokingStatus === 'willing' || decision.coBrokingStatus === 'needs_discussion') {
        return 'agent_engaging';
      }
      
      // Default to current phase or initial_request
      return context.currentPhase || 'initial_request';
    };
    
    const normalizedPhase = normalizePhase(decision.newPhase);
    
    // Always update conversation history with incoming message first
    const baseUpdateData: Record<string, unknown> = {
      conversation_phase: normalizedPhase,
      conversation_history: conversationHistory,
      last_message_at: new Date().toISOString()
      // Note: reply_text and replied_at should only be set when we actually send a reply
    };

    console.log('📝 [ASYNC] Base update data prepared:', {
      originalPhase: decision.newPhase,
      normalizedPhase: normalizedPhase,
      historyLength: conversationHistory.length,
      lastMessage: conversationHistory[conversationHistory.length - 1]?.message?.substring(0, 50) + '...'
    });

    // Update co-broking status if detected
    if (decision.coBrokingStatus && decision.coBrokingStatus !== 'unknown') {
      baseUpdateData.co_broking_status = decision.coBrokingStatus;
      console.log(`🤝 [ASYNC] Co-broking status detected: ${decision.coBrokingStatus}`);
      
        if (decision.coBrokingStatus === 'not_willing') {
          baseUpdateData.status = 'opted_out';
          baseUpdateData.conversation_phase = 'gracefully_ended';
          baseUpdateData.conversation_state = 'failed'; // Use valid conversation_state value
          console.log('🚫 [ASYNC] Agent won\'t co-broke - marking as opted_out');
        }
    }
    
    if (decision.coBrokingNotes) {
      baseUpdateData.co_broking_notes = decision.coBrokingNotes;
    }

    // Handle the decision
    try {
      // Ensure replyMessage is not empty - check both existence and non-empty content
      const hasValidReply = decision.shouldReply && 
                           decision.replyMessage && 
                           decision.replyMessage.trim().length > 0;
      
      if (hasValidReply) {
      console.log(`✅ [ASYNC] Sending reply: ${decision.reason}`);
      console.log(`📝 [ASYNC] Reply message: "${decision.replyMessage}"`);
      
      // Prepare timing context
      const timingContext = {
        currentPhase: context.currentPhase,
        deflectionCount: context.deflectionCount,
        agentMessageLength: payload.messageText.length,
        hasQuestion: payload.messageText.includes('?'),
        isFirstReply: (outreach.auto_reply_count || 0) === 0
      };
      
      console.log('📤 [ASYNC] Calling sendAutoReply...');
      const sent = await sendAutoReply(
        payload.agentPhone,
        decision.replyMessage,
        outreach.id,
        outreach.auto_reply_count || 0,
        timingContext
      );
      console.log('📤 [ASYNC] sendAutoReply result:', sent);

      if (sent) {
        // IMPORTANT: Clean quotes again before storing in database (final safety check)
        // This ensures no quotes are stored even if they somehow got through earlier
        const { cleanQuotes } = await import('./quote-cleaner');
        const cleanedReplyMessage = cleanQuotes(decision.replyMessage);
        
        // Log if we cleaned quotes at this stage (shouldn't happen, but good to know)
        if (cleanedReplyMessage !== decision.replyMessage) {
          console.log('🧹 [ASYNC] Cleaned quotes before storing in database:', {
            before: decision.replyMessage.substring(0, 60),
            after: cleanedReplyMessage.substring(0, 60)
          });
        }
        
        // Add our reply to conversation history (with cleaned message)
        conversationHistory.push({
          role: 'user',
          message: cleanedReplyMessage,
          timestamp: new Date().toISOString()
        });

        // Add reply-specific data to base update
        const updateData = {
          ...baseUpdateData,
          auto_reply_count: (outreach.auto_reply_count || 0) + 1,
          last_auto_reply_at: new Date().toISOString(),
          conversation_state: decision.gracefulExit ? 'failed' : 'awaiting_timeslots',
          conversation_history: conversationHistory, // Updated with reply
          deflection_count: decision.deflectionDetected 
            ? (outreach.deflection_count || 0) + 1 
            : outreach.deflection_count || 0,
          first_message_sent_at: outreach.first_message_sent_at || new Date().toISOString(),
          reply_text: cleanedReplyMessage, // Set the cleaned AI reply message (no quotes)
          replied_at: new Date().toISOString() // Set when we actually replied
        };

        // Update outreach record
        console.log('💾 [ASYNC] Updating outreach record with reply data...');
        try {
          const { error: updateError } = await supabase
            .from('outreach')
            .update(updateData)
            .eq('id', outreach.id);

          if (updateError) {
            console.error('❌ [ASYNC] Error updating outreach record:', updateError);
          } else {
            console.log('✅ [ASYNC] Outreach record updated successfully with reply');
          }
        } catch (dbError) {
          console.error('❌ [ASYNC] Database update failed:', dbError);
        }
      } else {
        console.log('❌ [ASYNC] Failed to send reply');
      }
    } else {
      const reason = !decision.shouldReply 
        ? decision.reason 
        : (!decision.replyMessage || decision.replyMessage.trim().length === 0)
          ? 'Empty reply message - skipping'
          : decision.reason;
      console.log(`ℹ️  [ASYNC] Not replying: ${reason}`);
      
      // Use base update data with additional fields for no-reply case
      const updateData = {
        ...baseUpdateData,
        deflection_count: decision.deflectionDetected 
          ? (outreach.deflection_count || 0) + 1 
          : outreach.deflection_count || 0,
        status: decision.timeslotsReceived || decision.gracefulExit ? 'replied' : outreach.status
      };

      console.log('💾 [ASYNC] Updating outreach record without reply...');
      const { error: updateError } = await supabase
        .from('outreach')
        .update(updateData)
        .eq('id', outreach.id);

      if (updateError) {
        console.error('❌ [ASYNC] Error updating outreach record:', updateError);
      } else {
        console.log('✅ [ASYNC] Outreach record updated successfully without reply');
      }
    }
    } catch (decisionError) {
      console.error('❌ [ASYNC] Error in decision handling:', decisionError);
      console.error('❌ [ASYNC] Decision error stack:', (decisionError as Error)?.stack);
    }

  } catch (error: unknown) {
    console.error('❌ [ASYNC] Background processing failed:', error);
    console.error('❌ [ASYNC] Error stack:', (error as Error)?.stack);
  }
}
