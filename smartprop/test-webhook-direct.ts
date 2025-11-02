#!/usr/bin/env bun

/**
 * Test script to directly test the webhook endpoint with a simulated WhatsApp message
 * This will help us verify if the webhook processing logic is working correctly
 */

const testMessage = {
  event: "message",
  session: "default",
  payload: {
    id: "test_message_123",
    timestamp: Math.floor(Date.now() / 1000),
    from: "6591051399@c.us", // Test agent phone number
    fromMe: false,
    body: `Are you a bot? Test ${Date.now()}`,
    hasMedia: false,
    ack: 1,
    vCards: [],
    _data: {
      id: {
        fromMe: false,
        remote: "6591051399@c.us",
        id: "test_message_123",
        _serialized: "false_6591051399@c.us_test_message_123"
      },
      body: `Are you a bot? Test ${Date.now()}`,
      type: "chat",
      timestamp: Math.floor(Date.now() / 1000),
      notifyName: "Test Agent",
      from: "6591051399@c.us",
      to: "66803102230@c.us",
      self: "out"
    }
  }
};

async function testWebhook() {
  console.log('🧪 Testing webhook with message:', JSON.stringify(testMessage, null, 2));
  
  try {
    const response = await fetch('http://localhost:3000/api/wa/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testMessage)
    });

    console.log('📡 Response status:', response.status);
    console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('📡 Response body:', responseText);

    if (response.ok) {
      console.log('✅ Webhook test successful!');
    } else {
      console.log('❌ Webhook test failed!');
    }
  } catch (error) {
    console.error('💥 Error testing webhook:', error);
  }
}

testWebhook().catch((error) => console.error(error));