import { getSupabaseClient } from '../src/workers/supa';
import { analyzeConversationWithAdvancedAI } from '../src/lib/ai/conversation-analyzer';

async function debugConversation() {
  console.log('🔍 Debugging conversation 6591051399...\n');

  const supabase = getSupabaseClient();
  
  // Get the conversation data - wa_conversation_id contains the phone number in the remote field
  const { data: outreachData, error } = await supabase
    .from('outreach')
    .select(`
      id,
      wa_conversation_id,
      co_broking_status,
      conversation_phase,
      conversation_history,
      auto_reply_count,
      last_message_at,
      reply_text,
      created_at,
      agents (name, agency),
      listings (title, price, district, property_type)
    `)
    .like('wa_conversation_id', '%6591051399%')
    .single();

  if (error || !outreachData) {
    console.error('❌ Error fetching conversation:', error);
    return;
  }

  console.log('📋 Conversation Data:');
  console.log('- ID:', outreachData.id);
  console.log('- Co-broking Status:', outreachData.co_broking_status);
  console.log('- Conversation Phase:', outreachData.conversation_phase);
  console.log('- Auto Reply Count:', outreachData.auto_reply_count);
  console.log('- Reply Text:', outreachData.reply_text);
  console.log('- Agent:', (outreachData.agents as unknown)?.name);
  console.log('- Property:', (outreachData.listings as unknown)?.title);
  console.log('');

  // Parse conversation history
  const conversationHistory = Array.isArray(outreachData.conversation_history)
    ? outreachData.conversation_history
    : (typeof outreachData.conversation_history === 'string'
      ? JSON.parse(outreachData.conversation_history)
      : []);

  console.log('💬 Conversation History:');
  conversationHistory.forEach((msg: unknown, index: number) => {
    console.log(`${index + 1}. [${msg.role}]: "${msg.message}"`);
  });
  console.log('');

  // Test AI analysis with the agent's latest message
  if (conversationHistory.length > 0) {
    // Find the last agent message
    const agentMessages = conversationHistory.filter((msg: unknown) => msg.role === 'agent');
    const latestAgentMessage = agentMessages[agentMessages.length - 1];
    
    if (!latestAgentMessage) {
      console.log('❌ No agent messages found in conversation history');
      return;
    }
    
    const context = {
      agentMessage: latestAgentMessage.message,
      conversationHistory: conversationHistory, // Full history for context
      agentProfile: {
        name: (outreachData.agents as unknown)?.name || 'Unknown Agent',
        agency: (outreachData.agents as unknown)?.agency,
        experience: 'Unknown'
      },
      propertyContext: {
        title: (outreachData.listings as unknown)?.title || 'Property',
        price: (outreachData.listings as unknown)?.price || 0,
        district: (outreachData.listings as unknown)?.district || 'Unknown',
        propertyType: (outreachData.listings as unknown)?.property_type || 'Unknown'
      },
      currentPhase: outreachData.conversation_phase || 'initial_request',
      daysElapsed: 1,
      objectivesStatus: {
        timeslotsReceived: outreachData.conversation_phase === 'timeslots_received',
        coBrokingConfirmed: outreachData.co_broking_status === 'willing',
        coBrokingStatus: outreachData.co_broking_status || 'unknown'
      }
    };

    console.log('🤖 Testing AI Analysis...');
    console.log('📝 Agent Message:', latestAgentMessage.message);
    console.log('📊 Objectives Status:', context.objectivesStatus);
    try {
      const analysis = await analyzeConversationWithAdvancedAI(context);
      console.log('📊 AI Analysis Result:');
      console.log('- Should Continue:', analysis.shouldContinue);
      console.log('- Recommended Response:', analysis.recommendedResponse);
      console.log('- Co-broking Status:', analysis.coBrokingAnalysis.status);
      console.log('- Timeslots Detected:', analysis.timeslotsDetected);
      console.log('- Conversation Tone:', analysis.conversationTone);
      console.log('');
    } catch (error) {
      console.error('❌ AI Analysis Error:', error);
    }
  }
}

debugConversation().catch(console.error);