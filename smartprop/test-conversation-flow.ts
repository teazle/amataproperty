import { getSupabaseClient } from './src/workers/supa';
import { analyzeConversationWithAdvancedAI } from './src/lib/ai/conversation-analyzer';

async function testConversationFlow() {
  const supabase = getSupabaseClient();
  
  console.log('🔍 Testing conversation flow for mobile 6591051399...\n');
  
  // First, let's get the current conversation state
  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('phone_number', '6591051399')
    .single();
    
  if (!agent) {
    console.log('❌ Agent not found');
    return;
  }
  
  console.log(`📱 Agent: ${agent.name} (${agent.phone_number})`);
  
  // Get the outreach record
  const { data: outreach } = await supabase
    .from('outreach')
    .select('*')
    .eq('agent_id', agent.id)
    .single();
    
  if (!outreach) {
    console.log('❌ Outreach record not found');
    return;
  }
  
  console.log(`💬 Outreach ID: ${outreach.id}`);
  console.log(`📊 Status: ${outreach.status}`);
  console.log(`🤝 Co-broking Status: ${outreach.co_broking_status}`);
  console.log(`📅 Phase: ${outreach.phase}`);
  console.log(`💭 Reply Text: ${outreach.reply_text}`);
  
  // Parse conversation history
  let conversationHistory;
  try {
    conversationHistory = typeof outreach.conversation_history === 'string' 
      ? JSON.parse(outreach.conversation_history) 
      : outreach.conversation_history;
  } catch (e) {
    console.log('❌ Error parsing conversation history:', e);
    return;
  }
  
  console.log('\n📜 Current Conversation History:');
  conversationHistory.forEach((msg: any, index: number) => {
    console.log(`${index + 1}. [${msg.role}]: ${msg.content}`);
  });
  
  // Test scenario 1: Agent provides timeslots
  console.log('\n🧪 Testing Scenario 1: Agent provides timeslots');
  const timeslotMessage = "hmm….i can only do sat and sun 6pm to 9pm";
  
  const newConversationHistory = [
    ...conversationHistory,
    { role: 'user', content: timeslotMessage }
  ];
  
  const context = {
    agentMessage: timeslotMessage,
    conversationHistory: newConversationHistory,
    agentProfile: {
      name: agent.name,
      agency: agent.agency || 'Unknown Agency',
      experience: agent.experience || 'Unknown'
    },
    propertyContext: {
      title: 'Test Property',
      price: 1000000,
      district: 'Test District',
      propertyType: 'Condo'
    },
    currentPhase: outreach.phase,
    daysElapsed: 1
  };
  
  try {
    const analysis = await analyzeConversationWithAdvancedAI(context);
    console.log('\n🤖 AI Analysis Result:');
    console.log('Co-broking Status:', analysis.coBrokingAnalysis.status);
    console.log('Confidence:', analysis.coBrokingAnalysis.confidence);
    console.log('Timeslots Detected:', analysis.timeslotsDetected);
    console.log('Recommended Response:', analysis.recommendedResponse);
    
    // Test scenario 2: Follow-up question about buyer profile
    console.log('\n🧪 Testing Scenario 2: Follow-up question about buyer profile');
    const followupMessage = "what is the buyer profile?";
    
    const followupConversationHistory = [
      ...newConversationHistory,
      { role: 'assistant', content: analysis.recommendedResponse },
      { role: 'user', content: followupMessage }
    ];
    
    const followupContext = {
      agentMessage: followupMessage,
      conversationHistory: followupConversationHistory,
      agentProfile: {
        name: agent.name,
        agency: agent.agency || 'Unknown Agency',
        experience: agent.experience || 'Unknown'
      },
      propertyContext: {
        title: 'Test Property',
        price: 1000000,
        district: 'Test District',
        propertyType: 'Condo'
      },
      currentPhase: 'timeslots_received', // Should be updated after receiving timeslots
      daysElapsed: 1
    };
    
    const followupAnalysis = await analyzeConversationWithAdvancedAI(followupContext);
    console.log('\n🤖 Follow-up AI Analysis Result:');
    console.log('Co-broking Status:', followupAnalysis.coBrokingAnalysis.status);
    console.log('Confidence:', followupAnalysis.coBrokingAnalysis.confidence);
    console.log('Timeslots Detected:', followupAnalysis.timeslotsDetected);
    console.log('Recommended Response:', followupAnalysis.recommendedResponse);
    
  } catch (error) {
    console.error('❌ Error during AI analysis:', error);
  }
}

testConversationFlow().catch((error) => console.error(error));