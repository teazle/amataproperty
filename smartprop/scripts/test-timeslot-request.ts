import { analyzeConversationWithAdvancedAI } from '../src/lib/ai/conversation-analyzer';

async function testTimeslotRequestScenario() {
  console.log('🧪 Testing "What timeslots?" scenario...\n');

  // Property context
  const propertyContext = {
    title: "Test Property 4 - 4 Bedroom House",
    price: 2500000,
    district: "D15",
    propertyType: "Landed"
  };

  const agentProfile = {
    name: "Test Agent",
    agency: "Test Agency",
    experience: "5 years"
  };

  const baseTimestamp = new Date().toISOString();

  // Test Scenario: Agent asks "What timeslots?" after co-broking discussion
  const scenario = {
    agentMessage: "What timeslots ?",
    conversationHistory: [
      { role: 'user' as const, message: "Hi Test, Jeremy here. I have a buyer who is interested in your Test Property 4 - 4 Bedroom House. Would you be open to co-broking?", timestamp: baseTimestamp },
      { role: 'agent' as const, message: "yes", timestamp: baseTimestamp },
      { role: 'user' as const, message: "Great! When would be a good time for viewing this week?", timestamp: baseTimestamp },
      { role: 'agent' as const, message: "What timeslots ?", timestamp: baseTimestamp }
    ],
    currentPhase: 'agent_engaging',
    timeslots: undefined,
    daysElapsed: 0,
    objectivesStatus: {
      timeslotsReceived: false,
      coBrokingConfirmed: true,
      coBrokingStatus: 'willing' as const
    },
    propertyContext,
    agentProfile
  };

  console.log('Scenario: Agent asks "What timeslots?"');
  console.log('Expected: AI should provide its availability (Mon-Fri 6pm-10pm) and ask what works for the agent');
  console.log('');
  
  const result = await analyzeConversationWithAdvancedAI(scenario);
  
  console.log('🤖 Co-broking Analysis:', {
    status: result.coBrokingAnalysis.status,
    confidence: result.coBrokingAnalysis.confidence,
    reasoning: result.coBrokingAnalysis.reasoning.substring(0, 100) + '...',
  });
  
  console.log('🕐 Timeslots Detected:', result.timeslotsDetected);
  console.log('📝 Timeslot Type:', result.timeslotType);
  console.log('💬 Recommended Response:', result.recommendedResponse);
  console.log('🔄 Should Continue:', result.shouldContinue);
  console.log('');
  
  // Check if the response is appropriate
  const response = result.recommendedResponse.toLowerCase();
  const hasAvailability = response.includes('monday') && response.includes('friday') && response.includes('6pm') || response.includes('10pm');
  const asksForTheirPreference = response.includes('what') && (response.includes('work') || response.includes('best') || response.includes('prefer'));
  
  console.log('✅ Analysis:');
  console.log(`- Timeslot type correctly detected as "requested": ${result.timeslotType === 'requested' ? '✅' : '❌'}`);
  console.log(`- Co-broking status maintained as "willing": ${result.coBrokingAnalysis.status === 'willing' ? '✅' : '❌'}`);
  console.log(`- Response provides availability: ${hasAvailability ? '✅' : '❌'}`);
  console.log(`- Response asks for their preference: ${asksForTheirPreference ? '✅' : '❌'}`);
  console.log(`- Should continue conversation: ${result.shouldContinue ? '✅' : '❌'}`);
}

testTimeslotRequestScenario().catch(console.error);