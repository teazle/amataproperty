/**
 * Test Script: Agent Profile Request Response
 * Tests how the AI handles when an agent asks for detailed tenant profile information
 */

import { analyzeConversationWithAdvancedAI } from '../src/lib/ai/conversation-analyzer';

console.log('🧪 Testing Agent Profile Request Response');
console.log('=========================================\n');

const testScenario = {
  agentPhone: '+6591234567',
  propertyId: 'test-property-123',
  conversationHistory: [
    {
      from: 'buyer',
      message: 'Hi, I saw your property listing and I\'m interested. Can we arrange a viewing?',
      timestamp: new Date(Date.now() - 5 * 60 * 1000) // 5 minutes ago
    },
    {
      from: 'agent',
      message: `Hi,

Thanks for your interest in this property.

May I have your profile:
Lease term:
Start date:
Price range:
Family of how many pax:
Occupation:
Nationality:
Partially or Fully furnish:
Any Pets:

When would you like to view`,
      timestamp: new Date() // Just now
    }
  ]
};

async function testProfileRequestResponse() {
  try {
    console.log('📋 Test Scenario: Agent asks for detailed tenant profile');
    console.log('Agent Message:');
    console.log(testScenario.conversationHistory[1].message);
    console.log('\n' + '='.repeat(50) + '\n');

    const result = await analyzeConversationWithAdvancedAI({
      agentMessage: testScenario.conversationHistory[1].message,
      conversationHistory: testScenario.conversationHistory.map(msg => ({
        role: msg.from === 'buyer' ? 'user' : 'agent',
        message: msg.message,
        timestamp: msg.timestamp.toISOString()
      })),
      agentProfile: { name: 'Test Agent' },
      propertyContext: {
        title: 'Test Property',
        price: 3000,
        district: 'Central',
        propertyType: 'Condo'
      },
      currentPhase: 'agent_engaging',
      daysElapsed: 0
    });

    console.log('🤖 AI Analysis Result:');
    console.log('=====================\n');

    console.log('📊 Parsing Results:');
    console.log(`   Co-broking Status: ${result.coBrokingAnalysis.status}`);
    console.log(`   Co-broking Confidence: ${result.coBrokingAnalysis.confidence}`);
    console.log(`   Timeslots Detected: ${result.timeslotsDetected ? 'Yes' : 'No'}`);
    console.log(`   Timeslot Type: ${result.timeslotType || 'None'}`);
    console.log(`   Should Continue: ${result.shouldContinue ? 'Yes' : 'No'}\n`);

    if (result.shouldContinue && result.recommendedResponse) {
      console.log('💬 AI Generated Response:');
      console.log('========================');
      console.log(`"${result.recommendedResponse}"\n`);
    } else {
      console.log('🔇 AI Decision: No reply needed\n');
    }

    console.log('🔍 Analysis Explanation:');
    console.log('========================');
    
    if (result.coBrokingAnalysis.status === 'unknown') {
      console.log('✅ EXPECTED: Agent is asking for tenant profile, not discussing co-broking');
    } else {
      console.log('❌ UNEXPECTED: AI detected co-broking discussion where there shouldn\'t be any');
    }

    if (result.timeslotsDetected) {
      console.log('✅ EXPECTED: Agent mentioned viewing availability ("When would you like to view")');
    } else {
      console.log('❌ UNEXPECTED: AI missed the viewing request');
    }

    if (result.shouldContinue) {
      console.log('✅ EXPECTED: AI should respond to provide tenant information and confirm viewing');
    } else {
      console.log('❌ UNEXPECTED: AI should engage when agent asks for profile and viewing');
    }

    console.log('\n🎯 Expected Behavior:');
    console.log('====================');
    console.log('1. ✅ Detect viewing request ("When would you like to view")');
    console.log('2. ✅ Provide professional tenant profile information');
    console.log('3. ✅ Suggest specific viewing times');
    console.log('4. ✅ Keep conversation focused on property viewing');
    console.log('5. ✅ Not interpret profile questions as co-broking discussion\n');

    return result;

  } catch (error) {
    console.error('❌ Error during analysis:', error);
    throw error;
  }
}

// Run the test
testProfileRequestResponse()
  .then(() => {
    console.log('✅ Profile request response test completed successfully');
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });