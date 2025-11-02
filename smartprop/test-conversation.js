import { analyzeConversationWithAdvancedAI } from './src/lib/ai/conversation-analyzer.ts';

// Test conversation scenario that was problematic
const testContext = {
  agentMessage: "What's your buyer's budget range?",
  conversationHistory: [
    {
      role: 'user',
      message: 'Hi Sarah, I saw your listing for the 3-bedroom condo in Central. Are you open to co-broking?',
      timestamp: '2024-01-15T10:00:00Z'
    },
    {
      role: 'agent',
      message: 'Hi Jeremy! Yes, I\'m absolutely open to co-broking on this property. Happy to work together!',
      timestamp: '2024-01-15T10:05:00Z'
    },
    {
      role: 'user',
      message: 'Great! When would be a good time for a viewing? I have a client who\'s very interested.',
      timestamp: '2024-01-15T10:10:00Z'
    },
    {
      role: 'agent',
      message: 'I\'m available tomorrow afternoon around 2-4 PM or Thursday morning 10-12 PM. Which works better?',
      timestamp: '2024-01-15T10:15:00Z'
    },
    {
      role: 'user',
      message: 'Thursday morning works perfectly. What\'s your buyer\'s budget range?',
      timestamp: '2024-01-15T10:20:00Z'
    }
  ],
  agentProfile: {
    name: 'Sarah Chen',
    agency: 'Premium Properties',
    experience: '8 years'
  },
  propertyContext: {
    title: '3-Bedroom Luxury Condo in Central',
    price: 15000000,
    district: 'Central',
    propertyType: 'Condo'
  },
  currentPhase: 'initial_contact',
  daysElapsed: 0,
  objectivesStatus: {
    timeslotsReceived: false,
    coBrokingConfirmed: false
  }
};

console.log('🧪 Testing conversation analysis with all fixes...\n');

try {
  const result = await analyzeConversationWithAdvancedAI(testContext);
  
  console.log('📊 Analysis Results:');
  console.log('===================');
  console.log(`Co-broking Status: ${result.coBrokingAnalysis.status}`);
  console.log(`Co-broking Confidence: ${result.coBrokingAnalysis.confidence}`);
  console.log(`Timeslots Detected: ${result.timeslotsDetected}`);
  console.log(`Timeslot Type: ${result.timeslotType || 'N/A'}`);
  console.log(`Business Question Detected: ${result.businessQuestionDetected}`);
  console.log(`Business Question Type: ${result.businessQuestionType || 'N/A'}`);
  console.log(`Should Continue: ${result.shouldContinue}`);
  console.log(`Conversation Tone: ${result.conversationTone}`);
  console.log(`Agent Engagement: ${result.agentEngagement}`);
  console.log('\n📝 Recommended Response:');
  console.log('========================');
  console.log(result.recommendedResponse);
  
  console.log('\n✅ Test Results:');
  console.log('================');
  
  // Check if fixes are working
  const fixes = {
    'Timeslot Detection': result.timeslotsDetected ? '✅ FIXED' : '❌ STILL BROKEN',
    'Business Question Detection': result.businessQuestionDetected ? '✅ FIXED' : '❌ STILL BROKEN', 
    'Co-broking Context': result.coBrokingAnalysis.status === 'willing' ? '✅ FIXED' : '❌ STILL BROKEN',
    'Should Not Continue': !result.shouldContinue ? '✅ FIXED' : '❌ STILL BROKEN'
  };
  
  Object.entries(fixes).forEach(([fix, status]) => {
    console.log(`${fix}: ${status}`);
  });
  
  console.log('\n🎯 Expected Behavior:');
  console.log('=====================');
  console.log('- Should detect timeslots were provided (Thursday morning 10-12 PM)');
  console.log('- Should detect business question about buyer budget');
  console.log('- Should recognize co-broking is already confirmed');
  console.log('- Should NOT continue conversation (both objectives met)');
  console.log('- Should deflect the business question professionally');
  
} catch (error) {
  console.error('❌ Test failed with error:', error);
  process.exit(1);
}