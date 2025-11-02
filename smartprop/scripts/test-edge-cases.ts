import { analyzeConversationWithAdvancedAI, ConversationContext } from '../src/lib/ai/conversation-analyzer';

async function testEdgeCases() {
  console.log('🧪 Testing AI system with various edge cases...\n');

  const baseContext = {
    agentProfile: {
      name: 'Test Agent',
      agency: 'Test Agency'
    },
    propertyContext: {
      title: 'Test Property',
      price: 1000000,
      district: 'D10',
      propertyType: 'Condo'
    },
    currentPhase: 'agent_engaging' as const,
    daysElapsed: 1,
    objectivesStatus: {
      coBrokingConfirmed: false,
      timeslotsReceived: false
    }
  };

  const testCases = [
    {
      name: 'Ambiguous Response',
      message: 'maybe',
      conversationHistory: [
        { role: 'user' as const, message: 'Hi, are you open to co-broking?', timestamp: new Date().toISOString() },
        { role: 'agent' as const, message: 'maybe', timestamp: new Date().toISOString() }
      ]
    },
    {
      name: 'Rude Response',
      message: 'Stop bothering me',
      conversationHistory: [
        { role: 'user' as const, message: 'Hi, are you open to co-broking?', timestamp: new Date().toISOString() },
        { role: 'agent' as const, message: 'Stop bothering me', timestamp: new Date().toISOString() }
      ]
    },
    {
      name: 'Confusing Timeslot',
      message: 'sometime next week maybe',
      conversationHistory: [
        { role: 'user' as const, message: 'When are you available for viewing?', timestamp: new Date().toISOString() },
        { role: 'agent' as const, message: 'sometime next week maybe', timestamp: new Date().toISOString() }
      ]
    },
    {
      name: 'Multiple Questions',
      message: 'Who are you? What company? How much commission?',
      conversationHistory: [
        { role: 'user' as const, message: 'Hi, interested in co-broking?', timestamp: new Date().toISOString() },
        { role: 'agent' as const, message: 'Who are you? What company? How much commission?', timestamp: new Date().toISOString() }
      ]
    },
    {
      name: 'Nonsensical Response',
      message: 'banana purple elephant 123',
      conversationHistory: [
        { role: 'user' as const, message: 'Are you available for viewing?', timestamp: new Date().toISOString() },
        { role: 'agent' as const, message: 'banana purple elephant 123', timestamp: new Date().toISOString() }
      ]
    },
    {
      name: 'Long Rambling Message',
      message: 'Well you know I have been in this business for 20 years and I have seen all kinds of agents and buyers and sellers and I think that co-broking is sometimes good but sometimes not so good because you never know what kind of person you are dealing with and the market is very competitive these days and everyone wants the best deal and I am not sure if I want to work with someone I dont know very well but maybe we can discuss it further if you tell me more about your buyer and their budget and requirements and timeline and all that stuff',
      conversationHistory: [
        { role: 'user' as const, message: 'Are you open to co-broking?', timestamp: new Date().toISOString() },
        { role: 'agent' as const, message: 'Well you know I have been in this business for 20 years and I have seen all kinds of agents and buyers and sellers and I think that co-broking is sometimes good but sometimes not so good because you never know what kind of person you are dealing with and the market is very competitive these days and everyone wants the best deal and I am not sure if I want to work with someone I dont know very well but maybe we can discuss it further if you tell me more about your buyer and their budget and requirements and timeline and all that stuff', timestamp: new Date().toISOString() }
      ]
    },
    {
      name: 'Emoji Only',
      message: '😂😂😂🤔🤔',
      conversationHistory: [
        { role: 'user' as const, message: 'When can we view the property?', timestamp: new Date().toISOString() },
        { role: 'agent' as const, message: '😂😂😂🤔🤔', timestamp: new Date().toISOString() }
      ]
    },
    {
      name: 'Different Language',
      message: '我不明白你在说什么',
      conversationHistory: [
        { role: 'user' as const, message: 'Are you open to co-broking?', timestamp: new Date().toISOString() },
        { role: 'agent' as const, message: '我不明白你在说什么', timestamp: new Date().toISOString() }
      ]
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n🔍 Testing: ${testCase.name}`);
    console.log(`Message: "${testCase.message}"`);
    
    try {
      const context: ConversationContext = {
        ...baseContext,
        agentMessage: testCase.message,
        conversationHistory: testCase.conversationHistory
      };

      const result = await analyzeConversationWithAdvancedAI(context);
      
      console.log(`✅ Analysis completed:`);
      console.log(`   Co-broking: ${result.coBrokingAnalysis.status} (${result.coBrokingAnalysis.confidence})`);
      console.log(`   Timeslots: ${result.timeslotsDetected}`);
      console.log(`   Tone: ${result.conversationTone}`);
      console.log(`   Should Continue: ${result.shouldContinue}`);
      console.log(`   Response: "${result.recommendedResponse}"`);
      
      // Check for potential issues
      const issues = [];
      if (result.recommendedResponse.length > 200) {
        issues.push('Response too long');
      }
      if (result.recommendedResponse.includes('!')) {
        issues.push('Contains exclamation marks');
      }
      if (result.recommendedResponse.toLowerCase().includes('sorry') && testCase.name !== 'Rude Response') {
        issues.push('Unnecessary apology');
      }
      if (!result.recommendedResponse.trim()) {
        issues.push('Empty response');
      }
      
      if (issues.length > 0) {
        console.log(`   ⚠️  Issues: ${issues.join(', ')}`);
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error}`);
    }
  }
}

testEdgeCases();