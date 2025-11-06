import { NextRequest, NextResponse } from 'next/server';
console.log('🌐 [WEBHOOK] Route module loaded');
import { parseViewingTimeslotsWithAI, formatParsedTimeslots } from '@/lib/ai/groq';
import type { ParsedViewingSlots } from '@/lib/ai/groq';
import { 
  generateThankYouMessage, 
  describeStructuredSlots,
  sendAutoReply,
  ConversationMessage,
  updateObjectivesStatus,
  ConversationDecision
} from '@/lib/ai/conversation';
import { 
  analyzeConversationWithAdvancedAI,
  ConversationContext
} from '@/lib/ai/conversation-analyzer';
import { getSupabaseClient } from '@/workers/supa';
import { useConversationStore } from '@/lib/stores/conversation-store';

// Type declarations for global properties
declare global {
  var processedMessages: Set<string> | undefined;
  var rateLimits: Map<string, number> | undefined;
}

// Helper function to convert new AI analysis result to old ConversationDecision format
function mapAdvancedAIToDecision(
  aiResult: {
    coBrokingAnalysis: any;
    timeslotsDetected: boolean;
    timeslotsText?: string;
    timeslotType?: 'provided' | 'requested';
    conversationTone: string;
    agentEngagement: string;
    recommendedResponse: string;
    shouldContinue: boolean;
    businessQuestionDetected?: boolean;
    businessQuestionType?: string;
  }
): ConversationDecision {
  return {
    shouldReply: aiResult.shouldContinue,
    replyMessage: aiResult.recommendedResponse,
    newPhase: 'ongoing', // Default phase
    reason: aiResult.coBrokingAnalysis.reasoning || 'AI analysis completed',
    deflectionDetected: aiResult.businessQuestionDetected || false,
    timeslotsReceived: aiResult.timeslotsDetected && aiResult.timeslotType === 'provided',
    timeslotsDetected: aiResult.timeslotsDetected,
    timeslotsText: aiResult.timeslotsText,
    gracefulExit: !aiResult.shouldContinue,
    agentAskedForAvailability: aiResult.timeslotsDetected && aiResult.timeslotType === 'requested',
    agentProvidedTimeslots: aiResult.timeslotsDetected && aiResult.timeslotType === 'provided',
    coBrokingStatus: aiResult.coBrokingAnalysis.status,
    coBrokingNotes: aiResult.coBrokingAnalysis.reasoning
  };
}

/**
 * Store outgoing message in conversation history
 */
async function storeOutgoingMessage(agentPhone: string, messageText: string) {
  const supabase = getSupabaseClient();
  
  try {
    // Find the agent
    const { data: agents } = await supabase
      .from('agents')
      .select('id')
      .or(`phone.eq.${agentPhone},phone.eq.65${agentPhone}`);

    if (!agents || agents.length === 0) {
      console.log('⚠️  No agent found for storing outgoing message');
      return;
    }

    const agentIds = agents.map(agent => agent.id);

    // Get the most recent outreach record
    const { data: outreachRecords } = await supabase
      .from('outreach')
      .select('*')
      .in('agent_id', agentIds)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!outreachRecords || outreachRecords.length === 0) {
      console.log('⚠️  No outreach records found for storing outgoing message');
      return;
    }

    const outreach = outreachRecords[0];

    // Get conversation history
    const conversationHistory: ConversationMessage[] = Array.isArray(outreach.conversation_history)
      ? outreach.conversation_history
      : (typeof outreach.conversation_history === 'string'
        ? JSON.parse(outreach.conversation_history)
        : []);
    
    // Add our message to history
    conversationHistory.push({
      role: 'user',
      message: messageText,
      timestamp: new Date().toISOString()
    });

    // Update the outreach record
    await supabase
      .from('outreach')
      .update({
        conversation_history: conversationHistory,
        last_message_at: new Date().toISOString()
      })
      .eq('id', outreach.id);

    console.log('✅ Stored outgoing message in conversation history');
  } catch (error: unknown) {
    console.error('Error storing outgoing message:', error);
  }
}

async function generateMeetingDeflectionMessage(
  agentMessage: string,
  timeslots?: string | null,
  structuredSlots?: ParsedViewingSlots | null
): Promise<string> {
  // Use AI to generate natural deflection responses when objectives are completed
  if (!process.env.GROQ_API_KEY) {
    return "Perfect! Let's cover any other details when we meet at the viewing. Feel free to message me if anything changes before then.";
  }

  try {
    const Groq = (await import('groq-sdk')).default;
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
    
    const friendlySummary =
      describeStructuredSlots(structuredSlots, timeslots || undefined) || 'the viewing';

    const prompt = `You are Jeremy, a professional buyer's agent. The property agent has already agreed to co-broke and provided viewing timeslots (${friendlySummary}). They just sent another message: "${agentMessage}"

Generate a brief, natural response that politely deflects further discussion to the in-person meeting. Keep it friendly and professional. The response should:
1. Acknowledge their message
2. Suggest discussing details at the viewing
3. Be conversational and natural (not template-like)

Response:`;

    const response = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.7,
      max_tokens: 100,
    });

    return response.choices[0]?.message?.content?.trim() || 
           `Perfect! Let's cover any other details when we meet during ${friendlySummary}. Feel free to message me if anything changes before then.`;
  } catch (error: unknown) {
    console.error('Error generating meeting deflection message:', error);
    const friendlySummary =
      describeStructuredSlots(structuredSlots, timeslots || undefined) || 'the viewing';
    return `Perfect! Let's cover any other details when we meet during ${friendlySummary}. Feel free to message me if anything changes before then.`;
  }
}

/**
 * POST /api/wa/webhook
 * Receives inbound WhatsApp messages from WAHA
 * 
 * Enhanced with:
 * - Full conversation history tracking
 * - Time-based tracking (days elapsed)
 * - Pattern recognition (deflection count)
 * - Graceful exit after 4 deflections or 7 days
 * - Thank you messages when timeslots received
 */
export async function POST(request: NextRequest) {
  console.log('🚨🚨🚨 [SUPER DEBUG] WEBHOOK POST FUNCTION CALLED 🚨🚨🚨');
  console.log('🚀 [WEBHOOK] POST request received');
  try {
    const body = await request.json();

    console.log('[WAHA Webhook] Received:', JSON.stringify(body, null, 2));

    const { event, session, payload } = body;
    
    console.log('🔍 [DEBUG] Event:', event);
    console.log('🔍 [DEBUG] Payload:', payload);
    console.log('🔍 [DEBUG] Body keys:', Object.keys(body));

    // WAHA can send messages in two formats:
    // 1. Wrapped: { event: "message", payload: { from, body, ... } }
    // 2. Direct: { from, body, ... } (message fields directly in body)
    
    let messageData = null;
    
    // Check wrapped format first
    if (event === 'message' && payload?.body) {
      console.log('✅ [DEBUG] Processing wrapped message format');
      messageData = {
        from: payload.from,
        to: payload.to,
        body: payload.body,
        id: payload.id,
        timestamp: payload.timestamp,
        fromMe: payload.fromMe,
      };
    }
    // Check direct format (message fields directly in body)
    else if (body.from && body.body && !body.event) {
      console.log('✅ [DEBUG] Processing direct message format');
      messageData = {
        from: body.from,
        to: body.to,
        body: body.body,
        id: body.id,
        timestamp: body.timestamp,
        fromMe: body.fromMe,
      };
    }

    // Handle incoming message events
    if (messageData) {
      console.log('✅ [DEBUG] Processing message event');
      const from = messageData.from; // Phone number (e.g., "6591234567@c.us")
      const to = messageData.to; // Who the message is sent to
      const messageText = messageData.body;
      const messageId = messageData.id;
      const timestamp = messageData.timestamp;
      const fromMe = messageData.fromMe; // Is this message from us?

      console.log('[WAHA Inbound Message]', {
        from,
        to,
        fromMe,
        text: messageText,
        id: messageId,
        timestamp,
      });

      // Handle messages sent by us (fromMe = true) - store them but don't trigger AI
      if (fromMe) {
        console.log('ℹ️  Message from ourselves - storing in conversation history');
        const cleanPhone = to.replace('@c.us', '').replace('@s.whatsapp.net', '');
        await storeOutgoingMessage(cleanPhone, messageText);
        
        // Also update Zustand store for real-time UI updates
        await useConversationStore.getState().processOutgoingMessage(cleanPhone, messageText);
        
        return NextResponse.json({ success: true });
      }

      // Agent is sending TO us, so agent phone is the 'from' field
      const cleanPhone = from.replace('@c.us', '').replace('@s.whatsapp.net', '');
      
      // Check for duplicate messages to prevent processing the same message multiple times
      console.log(`🔍 Processing message from ${cleanPhone}: "${messageText.substring(0, 50)}..."`);

      // Simple duplicate detection - check if we processed this exact message recently
      const messageHash = `${cleanPhone}-${messageText}-${timestamp}`;
      if (global.processedMessages && global.processedMessages.has(messageHash)) {
        console.log('⚠️  Duplicate message detected, skipping');
        return NextResponse.json({ success: true });
      }
      
      // Store message hash to prevent duplicates
      if (!global.processedMessages) {
        global.processedMessages = new Set();
      }
      global.processedMessages.add(messageHash);
      
      // DEBUG: Log message processing
      console.log(`🔍 [DEBUG] Processing message: "${messageText}" from ${cleanPhone}`);
      console.log(`🔍 [DEBUG] Message hash: ${messageHash}`);
      console.log(`🔍 [DEBUG] Global processed messages:`, global.processedMessages?.size || 0);
      console.log('🚨🚨🚨 [SUPER DEBUG] ABOUT TO PROCESS MESSAGE - THIS SHOULD ALWAYS APPEAR 🚨🚨🚨');
      
      // Clean up old message hashes (keep only last 100)
      if (global.processedMessages.size > 100) {
        const messagesArray = Array.from(global.processedMessages);
        global.processedMessages = new Set(messagesArray.slice(-50));
      }

      // Rate limiting removed - let AI handle natural conversation flow
      console.log(`📱 Processing message from ${cleanPhone} - no rate limiting`);

      // Try to parse viewing timeslots with AI first
      // We need to get the full conversation context for better parsing
      let parsedSlots: ParsedViewingSlots | null = null;
      let formattedTimeslots = messageText;

      if (process.env.GROQ_API_KEY) {
        console.log('🤖 Parsing with Groq AI using full conversation context...');
        
        const supabase = getSupabaseClient();
        
        // Get the agent and their conversation history for better context
        const { data: agents } = await supabase
          .from('agents')
          .select('id')
          .or(`phone.eq.${cleanPhone},phone.eq.65${cleanPhone}`)
          .limit(1);

        let conversationContext = messageText; // fallback to just current message
        
        if (agents && agents.length > 0) {
          const agentId = agents[0].id;
          const { data: outreachRecords } = await supabase
            .from('outreach')
            .select('conversation_history')
            .eq('agent_id', agentId)
            .order('created_at', { ascending: false })
            .limit(1);

          if (outreachRecords && outreachRecords.length > 0) {
            const history = outreachRecords[0].conversation_history;
            if (Array.isArray(history) && history.length > 0) {
              // Build conversation context from history + current message
              const recentHistory = history.slice(-6);
              const conversationText = recentHistory
                .map((msg: any) => `${msg.role === 'agent' ? 'Agent' : 'Buyer'}: ${msg.message}`)
                .join('\n');
              conversationContext = `${conversationText}\nAgent: ${messageText}`;
              console.log('📝 Using full conversation context for parsing');
            }
          }
        }
        
        parsedSlots = await parseViewingTimeslotsWithAI(conversationContext);
        
        if (parsedSlots && parsedSlots.available) {
          // Got actual timeslots!
          formattedTimeslots = formatParsedTimeslots(parsedSlots);
          console.log('✅ AI parsed viewing timeslots successfully');
          console.log('🤖 Letting natural AI conversation handle the response');
        } else if (parsedSlots && !parsedSlots.available) {
          // No timeslots, but got a reply - let AI handle naturally
          console.log('ℹ️  AI detected no viewing slots available');
          console.log('🤖 Letting natural AI conversation handle the response');
        } else {
          // AI parsing failed, let AI handle naturally
          console.log('⚠️  AI parsing failed, letting natural AI conversation handle the response');
        }
      } else {
        // No AI configured, let AI handle naturally
        console.log('🤖 Letting natural AI conversation handle the response');
      }

      if (parsedSlots && parsedSlots.available) {
        console.log('🧭 [PIPELINE] Using advanced timeslot handler');
        await handleTimeslotsReceived(
          cleanPhone,
          messageText,
          formattedTimeslots,
          parsedSlots
        );
      } else {
        console.log('🧭 [PIPELINE] Using advanced conversation handler');
        await handleNoTimeslotsReply(cleanPhone, messageText, parsedSlots);
      }

      // Update Zustand store for real-time UI updates
      useConversationStore.getState().processIncomingMessage(cleanPhone, messageText, messageId);
    }

    // Handle message status updates (sent, delivered, read)
    if (event === 'message.ack' || event === 'status') {
      console.log('[WAHA Message Status]', {
        id: payload?.id,
        status: payload?.status,
        timestamp: payload?.timestamp,
      });
    }

    // Handle session events (connected, disconnected, etc.)
    if (event === 'session.status') {
      console.log('[WAHA Session Status]', {
        session,
        status: payload?.status,
      });
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error processing WAHA webhook:', error);
    // Still return 200 to avoid webhook retries
    return NextResponse.json({ success: true });
  }
}

/**
 * Handle when timeslots are successfully received
 * Sends a thank you message and updates conversation state
 */
async function handleTimeslotsReceived(
  agentPhone: string,
  messageText: string,
  formattedTimeslots: string,
  structuredData?: ParsedViewingSlots | null
) {
  const supabase = getSupabaseClient();

  try {
    console.log(`✅ [TIMESLOTS] Received from ${agentPhone}: ${formattedTimeslots}`);
    
    // Find the agent
    const { data: agents } = await supabase
      .from('agents')
      .select('id')
      .or(`phone.eq.${agentPhone},phone.eq.65${agentPhone}`);

    if (!agents || agents.length === 0) {
      console.log('⚠️  Agent not found for phone:', agentPhone);
      return;
    }

    const agentIds = agents.map(agent => agent.id);

    // Get the most recent outreach record
    const { data: outreachRecords } = await supabase
      .from('outreach')
      .select('*')
      .in('agent_id', agentIds)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!outreachRecords || outreachRecords.length === 0) {
      console.log('⚠️  No outreach record found for agent');
      return;
    }

    const outreach = outreachRecords[0];

    // Check if this is an UPDATE to existing timeslots or first time
    const alreadyReceived = outreach.conversation_phase === 'timeslots_received';
    
    if (alreadyReceived) {
      console.log('ℹ️  Updating existing timeslots with new ones');
    }

    // Add agent message to conversation history (parse if it's a string)
    const conversationHistory = Array.isArray(outreach.conversation_history) 
      ? outreach.conversation_history 
      : (typeof outreach.conversation_history === 'string' 
        ? JSON.parse(outreach.conversation_history) 
        : []);
    conversationHistory.push({
      role: 'agent',
      message: messageText,
      timestamp: new Date().toISOString()
    });

    // Update outreach record
    await supabase
      .from('outreach')
      .update({
        status: 'replied',
        reply_text: messageText,
        replied_at: new Date().toISOString(),
        conversation_state: 'timeslots_received',
        conversation_phase: 'timeslots_received',
        conversation_history: conversationHistory,
        last_message_at: new Date().toISOString(),
        co_broking_status:
          outreach.co_broking_status === 'not_willing'
            ? outreach.co_broking_status
            : 'willing'
      })
      .eq('id', outreach.id);

    // Update listing with viewing timeslots
    if (outreach.listing_id) {
      const updateData: Record<string, unknown> = {
        viewing_timeslots: formattedTimeslots,
        viewing_status: 'received',
      };

      if (structuredData) {
        updateData.viewing_timeslots_structured = structuredData;
      }

      await supabase
        .from('listings')
        .update(updateData)
        .eq('id', outreach.listing_id);

      console.log(`✅ Updated listing ${outreach.listing_id} with timeslots`);
    }

    // Before sending any automatic message, check if AI wants to reply
    // Build conversation context for AI analysis
    const firstMessageDate = outreach.first_message_sent_at 
      ? new Date(outreach.first_message_sent_at)
      : new Date(outreach.created_at);
    const now = new Date();
    const daysElapsed = Math.floor((now.getTime() - firstMessageDate.getTime()) / (1000 * 60 * 60 * 24));

    const context: ConversationContext = {
      agentMessage: messageText,
      conversationHistory,
      currentPhase: 'timeslots_received',
      daysElapsed,
      agentProfile: outreach.agents,
      propertyContext: outreach.listings,
      objectivesStatus: {
        timeslotsReceived: true, // We just received timeslots
        coBrokingConfirmed: outreach.co_broking_status === 'willing',
        coBrokingStatus: outreach.co_broking_status || 'unknown'
      }
    };

    // Get agent and property context for AI analysis
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
    
    // Build conversation context with agent and property info
    const timeslotContext: ConversationContext = {
      agentMessage: messageText,
      conversationHistory,
      currentPhase: outreach.conversation_phase || 'initial_request',
      daysElapsed,
      timeslots: formattedTimeslots,
      timeslotsDetected: true,
      agentProfile,
      propertyContext,
      objectivesStatus: {
        timeslotsReceived: true,
        coBrokingConfirmed: false,
        coBrokingStatus: outreach.co_broking_status || 'unknown'
      }
    };
    
    // Analyze with AI to check if we should reply
    console.log('🤖 Analyzing timeslot message with AI before sending thank you...');
    const aiResult = await analyzeConversationWithAdvancedAI(timeslotContext);
    const decision = mapAdvancedAIToDecision(aiResult);

    console.log('🎯 AI Decision for timeslot message:', decision);

    // For timeslot responses, we should generally reply unless the AI explicitly decides not to
    // Only check for bot detection if the AI already decided not to reply
    const isBotDetection = !decision.shouldReply && decision.reason && (
      decision.reason.toLowerCase().includes('deflect') ||
      decision.reason.toLowerCase().includes('suspicious') ||
      (decision.reason.toLowerCase().includes('bot') && !decision.reason.toLowerCase().includes('asked'))
    );

    // Send reply if AI decides we should reply OR if it's not suspicious bot detection
    if (decision.shouldReply || !isBotDetection) {
      // Use AI-generated response for both first time and updates
      let replyMessage: string;
      if (decision.replyMessage) {
        // Use AI-generated response
        replyMessage = decision.replyMessage;
        console.log(`💌 Using AI-generated response: "${replyMessage}"`);
      } else if (!alreadyReceived) {
        // Fallback: Use AI to generate natural acknowledgment for first-time timeslots
        replyMessage = await generateMeetingDeflectionMessage(messageText, formattedTimeslots, structuredData);
        console.log(`💌 AI-generated acknowledgment for first-time timeslots: "${replyMessage}"`);
      } else {
        // Use AI to generate natural acknowledgment for timeslot updates
        replyMessage = await generateMeetingDeflectionMessage(messageText, formattedTimeslots, structuredData);
        console.log(`💌 AI-generated acknowledgment for timeslot update: "${replyMessage}"`);
      }
      
      // Prepare timing context for human-like behavior
      const timingContext = {
        currentPhase: 'timeslots_received',
        deflectionCount: 0,
        agentMessageLength: messageText.length,
        hasQuestion: false,
        isFirstReply: false
      };
      
      const sent = await sendAutoReply(
        agentPhone,
        replyMessage,
        outreach.id,
        outreach.auto_reply_count || 0,
        timingContext
      );

      // Update rate limit tracking
      if (sent && global.rateLimits) {
        global.rateLimits.set(`rate_limit_${agentPhone}`, Date.now());
      }

      if (sent) {
        // Track the reply in conversation history
        conversationHistory.push({
          role: 'user',
          message: replyMessage,
          timestamp: new Date().toISOString()
        });

        await supabase
          .from('outreach')
          .update({
            auto_reply_count: (outreach.auto_reply_count || 0) + 1,
            last_auto_reply_at: new Date().toISOString(),
            conversation_history: conversationHistory,
            last_message_at: new Date().toISOString()
          })
          .eq('id', outreach.id);

        console.log('✅ Reply sent and timeslots updated');
      }
    } else {
      console.log(`🚫 AI detected bot behavior in timeslot response: ${decision.reason}`);
      console.log('✅ Timeslots updated but no reply sent due to bot detection');
    }
  } catch (error: unknown) {
    console.error('❌ Error handling timeslots received:', error);
  }
}

/**
 * Handle agent reply when no timeslots provided
 * Uses enhanced conversation logic with full context tracking
 */
async function handleNoTimeslotsReply(
  agentPhone: string,
  messageText: string,
  parsedSlots: ParsedViewingSlots | null
) {
  console.log(`🚀 [DEBUG] handleNoTimeslotsReply called with phone: ${agentPhone}, message: ${messageText}`);
  const supabase = getSupabaseClient();

  try {
    console.log(`🔍 [DEBUG] Looking for agent with phone: ${agentPhone}`);
    
    // Find the agent - try multiple phone formats
    // Clean phone might be: "6591234567" or "91234567" or "+6591234567"
    const cleanPhoneNoCountry = agentPhone.replace(/^65/, '').replace(/^\+65/, '');
    const phoneVariations = [
      agentPhone,                    // "6591234567"
      `65${agentPhone}`,            // "656591234567" (if missing country code)
      cleanPhoneNoCountry,           // "91234567" (without country code)
      `65${cleanPhoneNoCountry}`,    // "6591234567" (with country code)
      agentPhone.replace(/^\+/, ''), // Remove + if present
    ].filter((p, i, arr) => arr.indexOf(p) === i); // Remove duplicates
    
    console.log(`🔍 [DEBUG] Searching with phone variations:`, phoneVariations);
    
    const phoneConditions = phoneVariations.map(p => `phone.eq.${p}`).join(',');
    const { data: agents } = await supabase
      .from('agents')
      .select('id')
      .or(phoneConditions);

    console.log(`🔍 [DEBUG] Found agents:`, agents);

    if (!agents || agents.length === 0) {
      console.log('⚠️  [DEBUG] No agent found, returning early');
      return;
    }

    const agentIds = agents.map(agent => agent.id);
    console.log(`🔍 [DEBUG] Agent IDs:`, agentIds);

    // Get the most recent outreach record with full tracking data
    const { data: outreachRecords } = await supabase
      .from('outreach')
      .select('*')
      .in('agent_id', agentIds)
      .order('created_at', { ascending: false })
      .limit(1);

    console.log(`🔍 [DEBUG] Found outreach records:`, outreachRecords);

    if (!outreachRecords || outreachRecords.length === 0) {
      console.log('⚠️  [DEBUG] No outreach records found, returning early');
      return;
    }

    const outreach = outreachRecords[0];

    // Calculate days elapsed since first message
    const firstMessageDate = outreach.first_message_sent_at 
      ? new Date(outreach.first_message_sent_at)
      : new Date(outreach.created_at);
    const now = new Date();
    const daysElapsed = Math.floor((now.getTime() - firstMessageDate.getTime()) / (1000 * 60 * 60 * 24));

    // Get conversation history (parse if it's a string)
    const conversationHistory: ConversationMessage[] = Array.isArray(outreach.conversation_history)
      ? outreach.conversation_history
      : (typeof outreach.conversation_history === 'string'
        ? JSON.parse(outreach.conversation_history)
        : []);
    
    // Add agent's message to history
    conversationHistory.push({
      role: 'agent',
      message: messageText,
      timestamp: new Date().toISOString()
    });

    // Build conversation context
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
    
    const completionContext: ConversationContext = {
      agentMessage: messageText,
      conversationHistory,
      currentPhase: outreach.conversation_phase || 'initial_request',
      daysElapsed,
      objectivesStatus: {
        timeslotsReceived: false, // Will be updated by updateObjectivesStatus
        coBrokingConfirmed: false, // Will be updated by updateObjectivesStatus
        coBrokingStatus: outreach.co_broking_status || 'unknown' // Use database value
      },
      agentProfile,
      propertyContext
    };

    // Create a temporary context for updateObjectivesStatus (uses old interface)
    const legacyContext = {
      ...completionContext,
      deflectionCount: outreach.deflection_count || 0,
      autoReplyCount: outreach.auto_reply_count || 0
    };

    // Update objectives status based on conversation history
    const updatedObjectivesStatus = updateObjectivesStatus(legacyContext as any);
    completionContext.objectivesStatus = updatedObjectivesStatus;

    const coBrokingReady =
      updatedObjectivesStatus.coBrokingConfirmed ||
      outreach.co_broking_status === 'willing';

    const timeslotsReady =
      updatedObjectivesStatus.timeslotsReceived ||
      outreach.conversation_phase === 'timeslots_received';

    const objectivesCompleted = coBrokingReady && timeslotsReady;

    if (objectivesCompleted) {
      console.log('✅ Both objectives completed - checking for graceful completion');
      console.log('📊 Final Status:', {
        coBroking: outreach.co_broking_status,
        phase: outreach.conversation_phase,
        autoReplies: outreach.auto_reply_count || 0
      });
      
      // Check if we've already sent completion messages
      const completionMessageCount = outreach.completion_message_count || 0;
      const maxCompletionMessages = 2; // Send 1-2 thank you messages
      
      if (completionMessageCount < maxCompletionMessages) {
        // Before sending completion message, check if AI wants to reply
        console.log('🚨🚨🚨 COMPLETION MESSAGE SECTION - Analyzing with AI 🚨🚨🚨');
        console.log('Message:', messageText);
        console.log('Completion message count:', completionMessageCount);
        console.log('Max completion messages:', maxCompletionMessages);
        
        // Get agent and property context for AI analysis
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
        
        // Build conversation context with agent and property info
        const timeslotContext: ConversationContext = {
          agentMessage: messageText,
          conversationHistory,
          currentPhase: outreach.conversation_phase || 'initial_request',
          daysElapsed,
          agentProfile,
          propertyContext,
          objectivesStatus: {
            timeslotsReceived: updatedObjectivesStatus.timeslotsReceived,
            coBrokingConfirmed: updatedObjectivesStatus.coBrokingConfirmed,
            coBrokingStatus: outreach.co_broking_status || 'unknown'
          }
        };
        
        // Analyze with AI to check if we should send completion message
        console.log('🚨 About to call analyzeConversationWithAdvancedAI...');
        const aiResult = await analyzeConversationWithAdvancedAI(completionContext);
        console.log('🚨 AI Result received:', aiResult);
        const decision = mapAdvancedAIToDecision(aiResult);
        console.log('🚨 Decision mapped:', decision);

        console.log('🎯 AI Decision for completion message:', decision);

        // Only send completion message if AI decides we should reply
        if (decision.shouldReply) {
          // Use the AI-generated response instead of hardcoded messages
          const thankYouMessage = decision.replyMessage || "Thank you for your message. I'll get back to you shortly.";
          
          console.log(`📤 Sending completion message ${completionMessageCount + 1}/${maxCompletionMessages}`);
          
          // Prepare timing context for human-like behavior
          const timingContext = {
            currentPhase: 'gracefully_ended',
            deflectionCount: 0,
            agentMessageLength: messageText.length,
            hasQuestion: false,
            isFirstReply: false
          };
          
          const sent = await sendAutoReply(
            agentPhone,
            thankYouMessage,
            outreach.id,
            outreach.auto_reply_count || 0,
            timingContext
          );
          
          if (sent) {
            // Add our completion message to conversation history
            conversationHistory.push({
              role: 'user',
              message: thankYouMessage,
              timestamp: new Date().toISOString()
            });
            
            // Update outreach with completion tracking
            await supabase
              .from('outreach')
              .update({
                auto_reply_count: (outreach.auto_reply_count || 0) + 1,
                completion_message_count: completionMessageCount + 1,
                last_auto_reply_at: new Date().toISOString(),
                conversation_state: 'gracefully_ended',
                conversation_phase: 'gracefully_ended',
                conversation_history: conversationHistory,
                reply_text: thankYouMessage,
                replied_at: new Date().toISOString(),
                last_message_at: new Date().toISOString()
              })
              .eq('id', outreach.id);
            
            console.log(`✅ Completion message ${completionMessageCount + 1} sent successfully`);
          }
        } else {
          console.log(`🚫 AI decided not to send completion message: ${decision.reason}`);
          console.log('✅ Objectives completed but no completion message sent');
        }
      } else {
        console.log('✅ Maximum completion messages sent - conversation gracefully ended');
      }
      
      // Update the store and return
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      useConversationStore.getState().processIncomingMessage(agentPhone, messageText, messageId);
      return;
    }

    console.log('📊 Conversation Context:', {
      phase: completionContext.currentPhase,
      daysElapsed: completionContext.daysElapsed,
      deflectionCount: outreach.deflection_count || 0,
      autoReplyCount: outreach.auto_reply_count || 0,
      historyLength: completionContext.conversationHistory.length
    });

    // Analyze with enhanced AI logic using advanced conversation analysis
    console.log('🤖 Analyzing conversation with advanced AI...');
    
    const aiResult = await analyzeConversationWithAdvancedAI(completionContext);
    const decision = mapAdvancedAIToDecision(aiResult);

    console.log('🎯 Decision:', decision);

    const alreadyHasCoBroking =
      completionContext.objectivesStatus.coBrokingConfirmed ||
      outreach.co_broking_status === 'willing';
    const alreadyHasTimeslots =
      completionContext.objectivesStatus.timeslotsReceived ||
      outreach.conversation_phase === 'timeslots_received';

    // Removed hardcoded override that was causing templated co-broking questions
    // The AI should handle responses naturally based on conversation context

    if (alreadyHasCoBroking && decision.coBrokingStatus === 'unknown') {
      decision.coBrokingStatus = 'willing';
    }

    // Only override AI decision if both objectives are completed AND it's not a direct personal question
    // The AI should handle direct questions even when objectives are met
    if (alreadyHasCoBroking && alreadyHasTimeslots && !decision.shouldReply) {
      // Let the AI's original decision stand - don't force shouldReply to false
      // The AI already considered the conversation context and objectives status
      console.log('ℹ️  Both objectives completed, but respecting AI decision on whether to reply');
    }

    // Update deflection count if detected
    const newDeflectionCount = decision.deflectionDetected 
      ? (outreach.deflection_count || 0) + 1 
      : outreach.deflection_count || 0;

    // Handle based on decision
    if (decision.shouldReply && decision.replyMessage) {
      console.log(`✅ Sending reply: ${decision.reason}`);
      
      // Prepare timing context for human-like behavior
      const timingContext = {
        currentPhase: completionContext.currentPhase,
        deflectionCount: outreach.deflection_count || 0,
        agentMessageLength: messageText.length,
        hasQuestion: messageText.includes('?'),
        isFirstReply: (outreach.auto_reply_count || 0) === 0
      };
      
      const sent = await sendAutoReply(
        agentPhone,
        decision.replyMessage,
        outreach.id,
        outreach.auto_reply_count || 0,
        timingContext
      );

      // Update rate limit tracking
      if (sent && global.rateLimits) {
        global.rateLimits.set(`rate_limit_${agentPhone}`, Date.now());
      }

      if (sent) {
        // Add our reply to conversation history
        conversationHistory.push({
          role: 'user',
          message: decision.replyMessage,
          timestamp: new Date().toISOString()
        });

        // Prepare update data with co-broking tracking
        const updateData: Record<string, unknown> = {
          auto_reply_count: (outreach.auto_reply_count || 0) + 1,
          last_auto_reply_at: new Date().toISOString(),
          conversation_state: decision.gracefulExit ? decision.newPhase : 'awaiting_timeslots',
          conversation_phase: decision.newPhase,
          conversation_history: conversationHistory,
          deflection_count: newDeflectionCount,
          reply_text: decision.replyMessage,
          replied_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          first_message_sent_at: outreach.first_message_sent_at || new Date().toISOString()
        };

        // Update co-broking status if detected by AI
        if (decision.coBrokingStatus && decision.coBrokingStatus !== 'unknown') {
          updateData.co_broking_status = decision.coBrokingStatus;
          console.log(`🤝 Co-broking status detected: ${decision.coBrokingStatus}`);
          
          // DEALBREAKER: If agent won't co-broke, mark as opted_out
          if (decision.coBrokingStatus === 'not_willing') {
            updateData.status = 'opted_out';
            updateData.conversation_phase = 'gracefully_ended';
            updateData.conversation_state = 'gracefully_ended';
            console.log('🚫 DEALBREAKER: Agent won\'t co-broke - marking as opted_out');
          }
        }
        
        if (decision.coBrokingNotes) {
          updateData.co_broking_notes = decision.coBrokingNotes;
          console.log(`📝 Co-broking notes: ${decision.coBrokingNotes}`);
        }

        // Update outreach with new state
        await supabase
          .from('outreach')
          .update(updateData)
          .eq('id', outreach.id);

        // ALSO save viewing timeslots to listing if received
        if (decision.timeslotsReceived && outreach.listing_id) {
          const formattedSlots =
            parsedSlots && parsedSlots.available
              ? formatParsedTimeslots(parsedSlots)
              : decision.timeslotsText || messageText;

          const listingUpdate: Record<string, unknown> = {
            viewing_timeslots: formattedSlots,
            viewing_status: 'received'
          };

          if (parsedSlots && parsedSlots.available) {
            listingUpdate.viewing_timeslots_structured = parsedSlots;
          }

          await supabase
            .from('listings')
            .update(listingUpdate)
            .eq('id', outreach.listing_id);

          console.log('✅ Saved viewing timeslots to listing');
        }

        console.log('✅ Auto-reply sent and state updated');
      }
    } else {
      console.log(`ℹ️  Not replying: ${decision.reason}`);
      
      // Prepare update data
      const updateData: Record<string, unknown> = {
        conversation_phase: decision.newPhase,
        conversation_history: conversationHistory,
        deflection_count: newDeflectionCount,
        reply_text: messageText,
        replied_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        status: decision.timeslotsReceived || decision.gracefulExit ? 'replied' : outreach.status
      };

      // Update co-broking status if detected
      if (decision.coBrokingStatus && decision.coBrokingStatus !== 'unknown') {
        updateData.co_broking_status = decision.coBrokingStatus;
        console.log(`🤝 Co-broking status detected: ${decision.coBrokingStatus}`);
        
        // DEALBREAKER: If agent won't co-broke, mark as opted_out
        if (decision.coBrokingStatus === 'not_willing') {
          updateData.status = 'opted_out';
          updateData.conversation_phase = 'gracefully_ended';
          updateData.conversation_state = 'gracefully_ended';
          console.log('🚫 DEALBREAKER: Agent won\'t co-broke - marking as opted_out');
        }
      }
      
      if (decision.coBrokingNotes) {
        updateData.co_broking_notes = decision.coBrokingNotes;
      }
      
      // Still update the conversation state
      await supabase
        .from('outreach')
        .update(updateData)
        .eq('id', outreach.id);

        // Update listing if needed
        if (outreach.listing_id) {
          const listingUpdateData: Record<string, unknown> = {};
          
          // Only mark as failed if graceful exit WITHOUT timeslots received
          if (decision.gracefulExit && !decision.timeslotsReceived && outreach.conversation_phase !== 'timeslots_received') {
            listingUpdateData.viewing_status = 'failed';
          } else if (decision.timeslotsReceived || outreach.conversation_phase === 'timeslots_received') {
            // If timeslots were received (either now or previously), mark as received
            if (decision.timeslotsReceived) {
              const formattedSlots =
                parsedSlots && parsedSlots.available
                  ? formatParsedTimeslots(parsedSlots)
                  : decision.timeslotsText || messageText;
              listingUpdateData.viewing_timeslots = formattedSlots;
            }
            listingUpdateData.viewing_status = 'received';
            if (parsedSlots && parsedSlots.available && decision.timeslotsReceived) {
              listingUpdateData.viewing_timeslots_structured = parsedSlots;
            }
          }

          // Update listing
          if (Object.keys(listingUpdateData).length > 0) {
            await supabase
              .from('listings')
              .update(listingUpdateData)
              .eq('id', outreach.listing_id);
            console.log('✅ Updated listing with viewing timeslots');
          }
        }
    }
  } catch (error: unknown) {
    console.error('❌ Error handling no-timeslots reply:', error);
  }
}
