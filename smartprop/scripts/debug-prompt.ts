import { analyzeConversationWithAdvancedAI } from '../src/lib/ai/conversation-analyzer';
import { getActivePrompt, FALLBACK_PROMPT } from '../src/lib/ai/prompt-manager';

async function debugPromptGeneration() {
  console.log('🔍 Debugging prompt generation for "What timeslots?" scenario...\n');

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

  // Get the raw prompt template (same as conversation analyzer)
  console.log('📋 Raw prompt template:');
  const rawPrompt = await getActivePrompt() || FALLBACK_PROMPT;
  console.log(rawPrompt?.substring(0, 500) + '...\n');

  // Simulate the template replacement that happens in generateNaturalResponse
  const conversationText = scenario.conversationHistory
    .map(msg => `${msg.role === 'user' ? 'Buyer Agent' : 'Property Agent'}: ${msg.message}`)
    .join('\n');

  const currentDateTime = new Date().toLocaleString('en-SG', { 
    timeZone: 'Asia/Singapore',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Simulate the analysis results
  const coBrokingStatus = 'willing';
  const timeslotsDetected = true;
  const timeslotType = 'requested';
  const timeslotsReceived = false;
  const coBrokingConfirmed = true;

  // Replace template variables using CURRENT AI analysis results
  // Handle both escaped (\${...}) and unescaped (${...}) template variables
  const processedPrompt = rawPrompt
    // Handle escaped template variables (from FALLBACK_PROMPT)
    ?.replace('\\${currentDateTime}', currentDateTime)
    ?.replace('\\${context.currentPhase}', scenario.currentPhase)
    ?.replace('\\${context.daysElapsed}', scenario.daysElapsed.toString())
    ?.replace('\\${context.objectivesStatus?.timeslotsReceived ? \'✓ Timeslots\' : \'✗ Timeslots\'}', 
      timeslotsReceived ? '✓ Timeslots' : '✗ Timeslots')
    ?.replace('\\${context.objectivesStatus?.coBrokingConfirmed ? \'✓ Co-broking\' : \'✗ Co-broking\'}',
      coBrokingConfirmed ? '✓ Co-broking' : '✗ Co-broking')
    ?.replace('\\${conversationText}', conversationText)
    ?.replace('\\${context.agentMessage}', scenario.agentMessage)
    ?.replace('\\${coBrokingAnalysis.status}', coBrokingStatus)
    ?.replace('\\${timeslotsDetected}', timeslotsDetected.toString())
    ?.replace('\\${timeslotType}', timeslotType || 'none')
    // Handle unescaped template variables (from database prompt)
    ?.replace('${currentDateTime}', currentDateTime)
    ?.replace('${context.currentPhase}', scenario.currentPhase)
    ?.replace('${context.daysElapsed}', scenario.daysElapsed.toString())
    ?.replace('${context.objectivesStatus?.timeslotsReceived ? \'✓ Timeslots received\' : \'✗ Need timeslots\'}', 
      timeslotsReceived ? '✓ Timeslots received' : '✗ Need timeslots')
    ?.replace('${context.objectivesStatus?.coBrokingConfirmed ? \'✓ Co-broking confirmed\' : \'✗ Need co-broking confirmation\'}',
      coBrokingConfirmed ? '✓ Co-broking confirmed' : '✗ Need co-broking confirmation')
    ?.replace('${conversationText}', conversationText)
    ?.replace('${context.agentMessage}', scenario.agentMessage)
    ?.replace('${coBrokingAnalysis.status}', coBrokingStatus)
    ?.replace('${timeslotsDetected}', timeslotsDetected.toString())
    ?.replace('${timeslotType}', timeslotType || 'none');

  console.log('🎯 Processed prompt being sent to AI:');
  console.log('='.repeat(80));
  console.log(processedPrompt);
  console.log('='.repeat(80));
  console.log('\n');

  // Now run the actual analysis to see what the AI returns
  console.log('🤖 Running actual analysis...');
  const result = await analyzeConversationWithAdvancedAI(scenario);
  console.log('AI Response:', result.recommendedResponse);
}

debugPromptGeneration().catch(console.error);