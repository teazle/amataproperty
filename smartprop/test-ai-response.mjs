import { analyzeConversationWithAdvancedAI } from './src/lib/ai/conversation-analyzer.ts';

async function testAIResponse() {
  console.log('🧪 Testing AI response for "Are you a bot ?" question...');
  
  // Simulate the exact conversation context from the webhook
  const conversationHistory = [
    {
      role: 'agent',
      message: 'Are you a bot ?',
      timestamp: new Date().toISOString()
    }
  ];
  
  const completionContext = {
    agentMessage: 'Are you a bot ?',
    conversationHistory,
    currentPhase: 'initial_request',
    daysElapsed: 0,
    objectivesStatus: {
      timeslotsReceived: false,
      coBrokingConfirmed: false,
      coBrokingStatus: 'unknown'
    },
    agentProfile: {
      name: 'Unknown Agent',
      agency: null,
      experience: 'Unknown'
    },
    propertyContext: {
      title: 'Property',
      price: 0,
      district: 'Unknown',
      propertyType: 'Unknown'
    }
  };
  
  try {
    console.log('📊 Context:', JSON.stringify(completionContext, null, 2));
    
    const aiResult = await analyzeConversationWithAdvancedAI(completionContext);
    
    console.log('🤖 AI Result:', JSON.stringify(aiResult, null, 2));
    
    // Map to decision like the webhook does
    const decision = {
      shouldReply: aiResult.shouldContinue,
      replyMessage: aiResult.recommendedResponse,
      newPhase: 'ongoing',
      reason: aiResult.coBrokingAnalysis?.reasoning || 'AI analysis completed',
      deflectionDetected: aiResult.businessQuestionDetected || false,
      timeslotsReceived: aiResult.timeslotsDetected && aiResult.timeslotType === 'provided',
      timeslotsDetected: aiResult.timeslotsDetected,
      timeslotsText: aiResult.timeslotsText,
      gracefulExit: !aiResult.shouldContinue,
      agentAskedForAvailability: aiResult.timeslotsDetected && aiResult.timeslotType === 'requested',
      agentProvidedTimeslots: aiResult.timeslotsDetected && aiResult.timeslotType === 'provided',
      coBrokingStatus: aiResult.coBrokingAnalysis?.status,
      coBrokingNotes: aiResult.coBrokingAnalysis?.reasoning
    };
    
    console.log('🎯 Decision:', JSON.stringify(decision, null, 2));
    
    if (decision.shouldReply) {
      console.log('✅ AI would reply with:', decision.replyMessage);
    } else {
      console.log('❌ AI decided NOT to reply. Reason:', decision.reason);
    }
    
  } catch (error) {
    console.error('❌ Error testing AI response:', error);
  }
}

testAIResponse();