import { getSupabaseClient } from './src/workers/supa';
import { analyzeConversationWithAdvancedAI, ConversationContext } from './src/lib/ai/conversation-analyzer';

async function reproduceConversationIssues() {
  console.log('🔍 Reproducing conversation flow issues for outreach ID: 8529aa53-ff4f-4235-89d2-ed4f8053b593');
  
  const supabase = getSupabaseClient();
  
  // Fetch the specific outreach record
  const { data: outreach, error } = await supabase
    .from('outreach')
    .select(`
      *,
      agents (
        id,
        name,
        phone,
        email,
        agency
      )
    `)
    .eq('id', '8529aa53-ff4f-4235-89d2-ed4f8053b593')
    .single();

  if (error || !outreach) {
    console.log('❌ Error fetching outreach:', error);
    return;
  }

  console.log('📋 Outreach Details:');
  console.log(`- Agent: ${outreach.agents?.name} (${outreach.agents?.phone})`);
  console.log(`- Co-broking Status: ${outreach.cobroking_status}`);
  console.log(`- Phase: ${outreach.phase}`);
  console.log(`- Reply Text: ${outreach.reply_text}`);
  console.log('');

  // Parse the conversation history
  let conversationHistory = [];
  try {
    if (Array.isArray(outreach.conversation_history)) {
      conversationHistory = outreach.conversation_history;
    } else if (typeof outreach.conversation_history === 'string') {
      conversationHistory = JSON.parse(outreach.conversation_history);
    } else {
      conversationHistory = [];
    }
  } catch (e) {
    console.log('❌ Error parsing conversation history:', e);
    conversationHistory = [];
  }

  console.log('💬 Current Conversation History:');
  conversationHistory.forEach((msg: any, index: number) => {
    console.log(`${index + 1}. [${msg.role}] ${msg.message}`);
  });
  console.log('');

  // Create context for AI analysis
  const baseContext: ConversationContext = {
    agentMessage: outreach.reply_text || '',
    conversationHistory: conversationHistory,
    agentProfile: {
      name: outreach.agents?.name || 'Unknown Agent',
      agency: outreach.agents?.agency || 'Unknown Agency'
    },
    propertyContext: {
      title: 'Test Property',
      price: 1000000,
      district: 'Test District',
      propertyType: 'Condo'
    },
    currentPhase: outreach.phase || 'unknown',
    daysElapsed: 1
  };

  console.log('🧪 SCENARIO 1: Current State Analysis');
  console.log('Testing AI response to current conversation state...');
  
  try {
    const analysis1 = await analyzeConversationWithAdvancedAI(baseContext);
    
    console.log('📊 AI Analysis Results:');
    console.log(`- Co-broking Status: ${analysis1.coBrokingAnalysis.status}`);
    console.log(`- Confidence: ${analysis1.coBrokingAnalysis.confidence}`);
    console.log(`- Timeslots Detected: ${analysis1.timeslotsDetected}`);
    console.log(`- Conversation Tone: ${analysis1.conversationTone}`);
    console.log(`- Agent Engagement: ${analysis1.agentEngagement}`);
    console.log(`- Should Continue: ${analysis1.shouldContinue}`);
    console.log(`- Recommended Response: ${analysis1.recommendedResponse}`);
    console.log('');
    
  } catch (error) {
    console.log('❌ Error in scenario 1:', error);
  }

  console.log('🧪 SCENARIO 2: Follow-up Question Test');
  console.log('Testing AI response when agent asks follow-up questions...');
  
  // Add the follow-up question to conversation history
  const followUpHistory = [...conversationHistory, {
    role: 'agent',
    message: 'what is the buyer profile ? or when are you coming down ?',
    timestamp: new Date().toISOString()
  }];

  const followUpContext: ConversationContext = {
    ...baseContext,
    agentMessage: 'what is the buyer profile ? or when are you coming down ?',
    conversationHistory: followUpHistory,
    currentPhase: 'follow_up_questions'
  };

  try {
    const analysis2 = await analyzeConversationWithAdvancedAI(followUpContext);
    
    console.log('📊 AI Analysis Results for Follow-up:');
    console.log(`- Co-broking Status: ${analysis2.coBrokingAnalysis.status}`);
    console.log(`- Confidence: ${analysis2.coBrokingAnalysis.confidence}`);
    console.log(`- Timeslots Detected: ${analysis2.timeslotsDetected}`);
    console.log(`- Conversation Tone: ${analysis2.conversationTone}`);
    console.log(`- Agent Engagement: ${analysis2.agentEngagement}`);
    console.log(`- Should Continue: ${analysis2.shouldContinue}`);
    console.log(`- Recommended Response: ${analysis2.recommendedResponse}`);
    console.log('');
    
  } catch (error) {
    console.log('❌ Error in scenario 2:', error);
  }
  
  console.log('🎯 IDENTIFIED ISSUES:');
  console.log('1. AI is repetitively thanking for co-broking confirmation');
  console.log('2. AI is asking for timeslots again when agent asks follow-up questions');
  console.log('3. AI is not professionally deflecting business questions');
  console.log('');
  
  console.log('✅ EXPECTED BEHAVIOR:');
  console.log('1. Natural acknowledgment without repetitive thanks');
  console.log('2. Professional deflection of business questions to in-person meeting');
  console.log('3. Context-aware responses that don\'t repeat previous requests');
}

reproduceConversationIssues().catch((error) => console.error(error));