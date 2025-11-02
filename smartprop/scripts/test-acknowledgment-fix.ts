import { analyzeConversationWithAdvancedAI, ConversationContext } from '../src/lib/ai/conversation-analyzer';

async function testAcknowledgmentFix() {
  console.log('🧪 Testing Acknowledgment Fix for Co-broking Conversation');
  console.log('='.repeat(60));

  // Simulate the conversation context where both objectives are met
  const context: ConversationContext = {
    agentMessage: 'ok', // This should trigger completion, not re-ask about co-broking
    conversationHistory: [
      {
        role: 'agent',
        message: 'Hi Jeremy, I have a buyer interested in your listing. Are you open to co-broking?',
        timestamp: '2024-01-01T10:00:00Z'
      },
      {
        role: 'user', 
        message: 'Yes, I\'m open to co-broking. When would you like to view?',
        timestamp: '2024-01-01T10:01:00Z'
      },
      {
        role: 'agent',
        message: 'Great! Monday to Friday 6pm to 9pm works for us.',
        timestamp: '2024-01-01T10:02:00Z'
      },
      {
        role: 'user',
        message: 'Perfect, I\'ll arrange the viewing. Thank you for your cooperation.',
        timestamp: '2024-01-01T10:03:00Z'
      },
      {
        role: 'agent',
        message: 'ok', // This is the current message being analyzed
        timestamp: '2024-01-01T10:04:00Z'
      }
    ],
    agentProfile: {
      name: 'Agent Smith',
      agency: 'ERA Singapore',
      experience: '5 years'
    },
    propertyContext: {
      title: 'Beautiful 3BR Condo in Orchard',
      price: 2500000,
      district: 'District 9',
      propertyType: 'Condominium'
    },
    currentPhase: 'timeslots_received',
    daysElapsed: 1,
    objectivesStatus: {
      timeslotsReceived: true,
      coBrokingConfirmed: true,
      coBrokingStatus: 'willing'
    }
  };

  console.log('📝 Test Scenario:');
  console.log('- Co-broking Status: willing (confirmed)');
  console.log('- Timeslots: received (Monday to Friday 6pm to 9pm)');
  console.log('- Agent Message: "ok" (simple acknowledgment)');
  console.log('- Expected: Should send completion message, NOT re-ask about co-broking');
  console.log('');

  try {
    const analysis = await analyzeConversationWithAdvancedAI(context);
    
    console.log('🔍 Analysis Results:');
    console.log('- Should Continue:', analysis.shouldContinue);
    console.log('- Co-broking Status:', analysis.coBrokingAnalysis.status);
    console.log('- Timeslots Detected:', analysis.timeslotsDetected);
    console.log('- Recommended Response:', analysis.recommendedResponse);
    console.log('');

    // Validate the fix - check if it's asking about co-broking (not just mentioning it)
    const isAskingAboutCoBroking = analysis.recommendedResponse.toLowerCase().includes('are you open to co-broking') ||
                                  analysis.recommendedResponse.toLowerCase().includes('would you be willing to co-broke') ||
                                  analysis.recommendedResponse.toLowerCase().includes('interested in co-broking') ||
                                  analysis.recommendedResponse.includes('?') && analysis.recommendedResponse.toLowerCase().includes('co-broking');
    
    const isFixed = !analysis.shouldContinue && !isAskingAboutCoBroking;

    if (isFixed) {
      console.log('✅ FIX SUCCESSFUL!');
      console.log('- Conversation properly ends with acknowledgment');
      console.log('- No redundant co-broking question asked');
      console.log('- Response is appropriate completion message');
    } else {
      console.log('❌ FIX FAILED!');
      console.log('- Conversation still continues or asks about co-broking again');
      console.log('- shouldContinue:', analysis.shouldContinue);
      console.log('- Response contains co-broking:', analysis.recommendedResponse.toLowerCase().includes('co-broking'));
    }

  } catch (error) {
    console.error('❌ Test Error:', error);
  }

  console.log('');
  console.log('🧪 Testing Different Acknowledgments...');
  
  // Test various acknowledgment messages
  const acknowledgments = ['ok', 'okay', 'thanks', 'thank you', 'got it', 'understood', 'sure', 'alright', 'good'];
  
  for (const ack of acknowledgments) {
    const testContext = { ...context, agentMessage: ack };
    try {
      const result = await analyzeConversationWithAdvancedAI(testContext);
      const isAskingAboutCoBroking = result.recommendedResponse.toLowerCase().includes('are you open to co-broking') ||
                                    result.recommendedResponse.toLowerCase().includes('would you be willing to co-broke') ||
                                    result.recommendedResponse.toLowerCase().includes('interested in co-broking') ||
                                    result.recommendedResponse.includes('?') && result.recommendedResponse.toLowerCase().includes('co-broking');
      const shouldEnd = !result.shouldContinue && !isAskingAboutCoBroking;
      console.log(`- "${ack}": ${shouldEnd ? '✅ Ends conversation' : '❌ Continues conversation'}`);
    } catch (error) {
      console.log(`- "${ack}": ❌ Error - ${error}`);
    }
  }
}

testAcknowledgmentFix().catch(console.error);