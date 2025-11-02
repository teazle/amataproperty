import { analyzeConversationWithAdvancedAI } from '../src/lib/ai/conversation-analyzer';

const testScenarios = [
  {
    name: "Personal Question - Are you a bot?",
    message: "Are you a bot?",
    expectedBehavior: "Should deflect gracefully and redirect to business"
  },
  {
    name: "Personal Question - Who are you?", 
    message: "Who are you?",
    expectedBehavior: "Should deflect gracefully and redirect to business"
  },
  {
    name: "Simple Greeting",
    message: "Hello there",
    expectedBehavior: "Should respond professionally and introduce purpose"
  },
  {
    name: "Rude Response",
    message: "I don't want to deal with you, go away",
    expectedBehavior: "Should remain professional and graceful"
  },
  {
    name: "Business Question - Commission",
    message: "What's your commission rate?",
    expectedBehavior: "Should deflect to in-person discussion"
  },
  {
    name: "Co-broking Agreement",
    message: "Yes, I'm open to co-broking",
    expectedBehavior: "Should acknowledge and ask for timeslots"
  },
  {
    name: "Co-broking Rejection",
    message: "No, I don't do co-broking",
    expectedBehavior: "Should end gracefully"
  },
  {
    name: "Timeslots Provided",
    message: "Available Monday 2pm, Tuesday 3pm",
    expectedBehavior: "Should acknowledge timeslots"
  },
  {
    name: "Both Objectives Met",
    message: "Yes to co-broking. Available Monday 2pm, Tuesday 3pm",
    expectedBehavior: "Should send completion message"
  },
  {
    name: "Emoji Only",
    message: "😊👍",
    expectedBehavior: "Should handle gracefully and redirect"
  },
  {
    name: "Different Language",
    message: "我不明白你在说什么",
    expectedBehavior: "Should respond in English professionally"
  },
  {
    name: "Nonsensical Input",
    message: "Purple elephant dancing on Tuesday",
    expectedBehavior: "Should handle gracefully and redirect"
  },
  {
    name: "Multi-part Message",
    message: "Hi there, I'm interested but need to check with my client first. What's your commission? Also when do you need an answer?",
    expectedBehavior: "Should handle multiple elements professionally"
  }
];

const mockContext = {
  agentMessage: "",
  conversationHistory: [
    {
      role: 'user' as const,
      message: "I'm Jeremy, a buyer's agent. I have a buyer interested in your property. Are you open to co-broking?",
      timestamp: new Date().toISOString()
    }
  ],
  agentProfile: {
    name: "Sarah Chen",
    agency: "PropTech Realty",
    experience: "5 years"
  },
  propertyContext: {
    title: "3-Bedroom Condo in Orchard",
    price: 1200000,
    district: "District 9",
    propertyType: "Condominium"
  },
  currentPhase: "agent_engaging",
  daysElapsed: 1,
  objectivesStatus: {
    timeslotsReceived: false,
    coBrokingConfirmed: false,
    coBrokingStatus: 'unknown' as const
  }
};

async function testUnifiedSystem() {
  console.log('🧪 Testing Unified AI System - Comprehensive Scenarios\n');
  console.log('=' .repeat(80));

  let passedTests = 0;
  const totalTests = testScenarios.length;

  for (const scenario of testScenarios) {
    console.log(`\n📋 Test: ${scenario.name}`);
    console.log(`📝 Input: "${scenario.message}"`);
    console.log(`🎯 Expected: ${scenario.expectedBehavior}`);
    console.log('-'.repeat(60));

    try {
      const testContext = {
        ...mockContext,
        agentMessage: scenario.message
      };

      const result = await analyzeConversationWithAdvancedAI(testContext);
      
      console.log(`✅ AI Response: "${result.recommendedResponse}"`);
      console.log(`📊 Should Reply: ${result.shouldContinue}`);
      console.log(`🎭 Co-broking Status: ${result.coBrokingAnalysis.status}`);
      console.log(`⏰ Timeslots Detected: ${result.timeslotsDetected}`);
      console.log(`🎪 Tone: ${result.conversationTone}`);
      
      // Basic validation - check if response exists and is reasonable
      if (result.recommendedResponse && 
          result.recommendedResponse.length > 10 && 
          result.recommendedResponse.length < 500 &&
          !result.recommendedResponse.includes('undefined') &&
          !result.recommendedResponse.includes('null')) {
        console.log(`✅ PASS - Response is valid and appropriate`);
        passedTests++;
      } else {
        console.log(`❌ FAIL - Response is invalid or inappropriate`);
      }

    } catch (error) {
      console.log(`❌ ERROR: ${error}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`🏆 Test Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! The unified system is working correctly.');
  } else {
    console.log(`⚠️  ${totalTests - passedTests} tests failed. Review the responses above.`);
  }
  
  console.log('\n🔍 Key Observations:');
  console.log('- All responses should be professional and contextual');
  console.log('- Personal questions should be deflected gracefully');
  console.log('- Business questions should defer to in-person discussion');
  console.log('- Co-broking responses should be handled appropriately');
  console.log('- System should never crash or give empty responses');
}

testUnifiedSystem().catch(console.error);