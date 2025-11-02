import { analyzeConversationWithAdvancedAI } from '../src/lib/ai/conversation-analyzer';

async function testConversationScenarios() {
  console.log('🧪 Testing conversation scenarios...\n');

  // Common property context for all scenarios
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

  // Test Scenario 1: Initial co-broking request
  const scenario1 = {
    agentMessage: "Hi Test, Jeremy here. I have a buyer who is interested in your Test Property 4 - 4 Bedroom House. Would you be open to co-broking?",
    conversationHistory: [],
    currentPhase: 'initial_request',
    timeslots: undefined,
    daysElapsed: 0,
    objectivesStatus: {
      timeslotsReceived: false,
      coBrokingConfirmed: false
    },
    propertyContext,
    agentProfile
  };

  console.log('Scenario 1: Initial co-broking request');
  const result1 = await analyzeConversationWithAdvancedAI(scenario1);
  console.log('Response:', result1);
  console.log('---\n');

  // Test Scenario 2: Co-broking confirmation
  const scenario2 = {
    agentMessage: "yes",
    conversationHistory: [
      { role: 'user' as const, message: "Hi Test, Jeremy here. I have a buyer who is interested in your Test Property 4 - 4 Bedroom House. Would you be open to co-broking?", timestamp: baseTimestamp },
      { role: 'agent' as const, message: "yes", timestamp: baseTimestamp }
    ],
    currentPhase: 'agent_engaging',
    timeslots: undefined,
    daysElapsed: 0,
    objectivesStatus: {
      timeslotsReceived: false,
      coBrokingConfirmed: true
    },
    propertyContext,
    agentProfile
  };

  console.log('Scenario 2: Co-broking confirmation');
  const result2 = await analyzeConversationWithAdvancedAI(scenario2);
  console.log('Response:', result2);
  console.log('---\n');

  // Test Scenario 3: Timeslot provided
  const scenario3 = {
    agentMessage: "Hmm...Monday to Friday 3pm to 9pm",
    conversationHistory: [
      { role: 'user' as const, message: "Hi Test, Jeremy here. I have a buyer who is interested in your Test Property 4 - 4 Bedroom House. Would you be open to co-broking?", timestamp: baseTimestamp },
      { role: 'agent' as const, message: "yes", timestamp: baseTimestamp },
      { role: 'user' as const, message: "Great! When would be a good time for viewing this week?", timestamp: baseTimestamp },
      { role: 'agent' as const, message: "Hmm...Monday to Friday 3pm to 9pm", timestamp: baseTimestamp }
    ],
    currentPhase: 'agent_engaging',
    timeslots: "Monday to Friday 3pm to 9pm",
    daysElapsed: 0,
    objectivesStatus: {
      timeslotsReceived: true,
      coBrokingConfirmed: true
    },
    propertyContext,
    agentProfile
  };

  console.log('Scenario 3: Timeslot provided');
  const result3 = await analyzeConversationWithAdvancedAI(scenario3);
  console.log('Response:', result3);
  console.log('---\n');

  // Test Scenario 4: Avoid repeated co-broking question
  const scenario4 = {
    agentMessage: "Yes..I am ok to co broke",
    conversationHistory: [
      { role: 'user' as const, message: "Hi Test, Jeremy here. I have a buyer who is interested in your Test Property 4 - 4 Bedroom House. Would you be open to co-broking?", timestamp: baseTimestamp },
      { role: 'agent' as const, message: "yes", timestamp: baseTimestamp },
      { role: 'user' as const, message: "Great! When would be a good time for viewing this week?", timestamp: baseTimestamp },
      { role: 'agent' as const, message: "Hmm...Monday to Friday 3pm to 9pm", timestamp: baseTimestamp },
      { role: 'user' as const, message: "Would you be open to co-broking on this one?", timestamp: baseTimestamp },
      { role: 'agent' as const, message: "Yes..I am ok to co broke", timestamp: baseTimestamp }
    ],
    currentPhase: 'timeslots_received',
    timeslots: "Monday to Friday 3pm to 9pm",
    daysElapsed: 0,
    objectivesStatus: {
      timeslotsReceived: true,
      coBrokingConfirmed: true
    },
    propertyContext,
    agentProfile
  };

  console.log('Scenario 4: Avoid repeated co-broking question');
  const result4 = await analyzeConversationWithAdvancedAI(scenario4);
  console.log('Response:', result4);
  console.log('---\n');
}

testConversationScenarios().catch(console.error);