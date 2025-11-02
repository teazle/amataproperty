import { analyzeConversationWithAdvancedAI } from './src/lib/ai/conversation-analyzer';
import { getSupabaseClient } from './src/workers/supa';

async function debugConversation() {
  const supabase = getSupabaseClient();
  
  // Get the specific conversation
  const { data: outreach, error } = await supabase
    .from('outreach')
    .select('*')
    .eq('id', '61666cc9-d9d8-4d27-bb0e-5f177a317766')
    .single();

  if (error || !outreach) {
    console.error('Error fetching conversation:', error);
    return;
  }

  console.log('=== CONVERSATION DETAILS ===');
  console.log('Outreach ID:', outreach.id);
  console.log('Status:', outreach.status);
  console.log('Co-broking Status:', outreach.co_broking_status);
  console.log('Conversation Phase:', outreach.conversation_phase);
  console.log('Reply Text:', outreach.reply_text);
  console.log('Auto Reply Count:', outreach.auto_reply_count);

  // Parse conversation history
  let conversationHistory;
  try {
    conversationHistory = typeof outreach.conversation_history === 'string' 
      ? JSON.parse(outreach.conversation_history) 
      : outreach.conversation_history;
  } catch (e) {
    console.error('Error parsing conversation history:', e);
    return;
  }

  console.log('\n=== CONVERSATION HISTORY ===');
  conversationHistory.forEach((msg: any, index: number) => {
    console.log(`${index + 1}. [${msg.role}] ${msg.message}`);
  });

  // Test AI analysis with the full function
  console.log('\n=== AI ANALYSIS ===');
  try {
    const context = {
      agentMessage: outreach.reply_text,
      conversationHistory,
      agentProfile: { name: 'Test Agent' },
      propertyContext: {
        title: 'Test Property',
        price: 1000000,
        district: 'Test District',
        propertyType: 'Condo'
      },
      currentPhase: outreach.conversation_phase,
      daysElapsed: 1,
      timeslots: outreach.reply_text,
      timeslotsDetected: true,
      objectivesStatus: {
        timeslotsReceived: true,
        coBrokingConfirmed: true,
        coBrokingStatus: 'willing' as const
      }
    };

    console.log('Analyzing conversation with AI...');
    const analysis = await analyzeConversationWithAdvancedAI(context);
    
    console.log('\n=== ANALYSIS RESULTS ===');
    console.log('Co-broking Analysis:', analysis.coBrokingAnalysis);
    console.log('Timeslots Detected:', analysis.timeslotsDetected);
    console.log('Timeslot Type:', analysis.timeslotType);
    console.log('Conversation Tone:', analysis.conversationTone);
    console.log('Agent Engagement:', analysis.agentEngagement);
    console.log('Should Continue:', analysis.shouldContinue);
    console.log('\n=== RECOMMENDED RESPONSE ===');
    console.log(analysis.recommendedResponse);
    
  } catch (error: unknown) {
    console.error('Error in AI analysis:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
  }
}

debugConversation().catch((error) => console.error(error));