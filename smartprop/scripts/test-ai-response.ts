import Groq from 'groq-sdk';
import { getActivePrompt } from '../src/lib/ai/prompt-manager';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function testAIResponse() {
  console.log('🧪 Testing AI Response Generation...\n');

  // Simulate the conversation context from the problematic conversation
  const conversationText = `Buyer Agent: Hi there! I'm Jeremy, a buyer who is interested in your Beautiful 3BR Condo in District 9.

Would you be open to co-broking?

🔗 https://www.propertyguru.com.sg/listing/test-property-12345678
Property Agent: Sat 9p.
Buyer Agent: Thanks for sharing the availability. The slots you suggested (Saturday, 9pm) work great. I'll coordinate with my buyer and confirm the exact timing shortly. Would you be open to co-broking on this one?
Property Agent: Ok
Buyer Agent: "Awesome, thanks for confirming! Looking forward to meeting you on Saturday at 9pm to check out the property. Let's discuss the details in person then, sounds good?"
Property Agent: Ok
Buyer Agent: "Awesome, thanks for confirming! I'm looking forward to checking out the property on Saturday at 9pm. Shall we discuss the details then, it'll be great to see the place in person and go from there. See you Saturday!"
Property Agent: Why are you repeating yourseld
Buyer Agent: "No worries at all, I think I might have miscommunicated something. Let's catch up on all the details in person on Saturday at 9pm. I'm really looking forward to meeting you then and discussing everything in more depth. See you then."
Property Agent: Are you a bot ?`;

  const agentMessage = "Are you a bot ?";
  const currentPhase = "timeslots_received";
  const daysElapsed = 1;

  // Get the active prompt
  const activePrompt = await getActivePrompt();
  console.log('📝 Active Prompt Preview:');
  console.log(activePrompt?.substring(0, 200) + '...\n');

  // Get current date/time for context
  const currentDateTime = new Date().toLocaleString('en-SG', { 
    timeZone: 'Asia/Singapore',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Replace template variables in the prompt
  const responsePrompt = activePrompt
    ?.replace('${currentDateTime}', currentDateTime)
    ?.replace('${context.currentPhase}', currentPhase)
    ?.replace('${context.daysElapsed}', daysElapsed.toString())
    ?.replace('${context.objectivesStatus?.timeslotsReceived ? \'✓ Timeslots received\' : \'✗ Need timeslots\'}', '✓ Timeslots received')
    ?.replace('${context.objectivesStatus?.coBrokingConfirmed ? \'✓ Co-broking confirmed\' : \'✗ Need co-broking confirmation\'}', '✓ Co-broking confirmed')
    ?.replace('${conversationText}', conversationText)
    ?.replace('${context.agentMessage}', agentMessage)
    ?.replace('${coBrokingAnalysis.status}', 'willing')
    ?.replace('${timeslotsDetected}', 'true') || `You are Jeremy, a professional buyer's agent. Respond naturally to: ${agentMessage}`;

  console.log('🤖 Sending prompt to AI...');
  console.log('Prompt length:', responsePrompt.length);
  console.log('Last 300 chars of prompt:', responsePrompt.slice(-300));
  console.log('');

  try {
    const response = await groq.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: responsePrompt,
        },
      ],
      model: 'llama-3.1-8b-instant',
      temperature: 0.7,
      max_tokens: 150,
    });

    const aiResponse = response.choices[0]?.message?.content?.trim();
    console.log('🎯 Raw AI Response:');
    console.log('---');
    console.log(aiResponse);
    console.log('---\n');

    // Test JSON parsing
    console.log('🔍 Testing JSON Parsing...');
    try {
      const parsedResponse = JSON.parse(aiResponse || '{}');
      console.log('✅ JSON Parse Success:');
      console.log('Parsed object:', parsedResponse);
      console.log('replyMessage:', parsedResponse.replyMessage);
      console.log('');
    } catch (parseError) {
      console.log('❌ JSON Parse Failed:', parseError);
      console.log('Attempting quote cleanup...');
      const cleanResponse = aiResponse?.replace(/^["']|["']$/g, '');
      console.log('Cleaned response:', cleanResponse);
      console.log('');
    }

  } catch (error) {
    console.error('❌ AI Request Error:', error);
  }
}

testAIResponse().catch(console.error);