/**
 * Test Script: Agent Profile Request via Webhook
 * Tests the complete AI response when an agent asks for detailed tenant profile
 */

console.log('🧪 Testing Agent Profile Request via Webhook');
console.log('=============================================\n');

const WEBHOOK_URL = 'http://localhost:3000/api/wa/webhook';

// Test scenario: Agent asks for detailed tenant profile (WAHA format)
const profileRequestMessage = {
  event: 'message',
  session: 'default',
  payload: {
    id: 'test_profile_request_' + Date.now(),
    timestamp: Math.floor(Date.now() / 1000),
    from: '6591234567@c.us',
    to: 'status@broadcast',
    fromMe: false,
    body: `Hi,

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
    hasMedia: false,
    ack: 1,
    vCards: [],
    _data: {
      id: {
        fromMe: false,
        remote: '6591234567@c.us',
        id: 'test_profile_request_' + Date.now(),
        _serialized: 'false_6591234567@c.us_test_profile_request_' + Date.now()
      },
      body: `Hi,

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
      type: 'chat',
      timestamp: Math.floor(Date.now() / 1000),
      notifyName: 'Test Agent',
      from: '6591234567@c.us',
      to: 'status@broadcast',
      author: undefined,
      deviceType: 'web',
      isForwarded: false,
      forwardingScore: 0,
      isStatus: false,
      isStarred: false,
      broadcast: false,
      fromMe: false,
      hasMedia: false,
      hasReaction: false,
      hasQuotedMsg: false,
      vCards: [],
      inviteV4: {},
      mentionedIds: [],
      orderId: null,
      token: null,
      isGif: false,
      isEphemeral: false,
      links: []
    }
  }
};

async function testProfileRequestWebhook() {
  try {
    console.log('📋 Sending Agent Profile Request Message:');
    console.log('========================================');
    console.log(profileRequestMessage.payload.body);
    console.log('\n' + '='.repeat(60) + '\n');

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(profileRequestMessage)
    });

    console.log('📡 Webhook Response:');
    console.log('===================');
    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      console.log('✅ SUCCESS: Webhook processed the profile request successfully\n');
      
      // Wait a moment for processing
      console.log('⏳ Waiting for AI processing...\n');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log('🎯 EXPECTED AI BEHAVIOR:');
      console.log('========================');
      console.log('1. ✅ Detect viewing request ("When would you like to view")');
      console.log('2. ✅ Provide professional tenant profile information');
      console.log('3. ✅ Suggest specific viewing times');
      console.log('4. ✅ Ask about co-broking willingness');
      console.log('5. ✅ Keep conversation professional and focused\n');
      
      console.log('📝 SAMPLE EXPECTED RESPONSE:');
      console.log('============================');
      console.log(`"Hi! Here's my tenant profile:
      
Lease term: 2 years
Start date: Next month
Price range: $2,800-$3,200
Family: 2 adults
Occupation: Finance professionals
Nationality: Singaporean
Furnishing: Partially furnished preferred
Pets: No pets

I'm available for viewing this week - Monday 6-8pm, Tuesday 7-9pm, or Wednesday 6-8pm would work well. Are you open to co-broking on this property?"`);
      
    } else {
      console.log(`❌ FAILED: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.log('Error details:', errorText);
    }

  } catch (error) {
    console.error('❌ Error testing profile request webhook:', error);
    throw error;
  }
}

// Run the test
testProfileRequestWebhook()
  .then(() => {
    console.log('\n✅ Profile request webhook test completed');
    console.log('\n🔍 Check the server logs to see the actual AI response generated!');
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });