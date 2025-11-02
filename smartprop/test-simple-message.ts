#!/usr/bin/env bun

export {};

const webhookUrl = 'http://localhost:3000/api/wa/webhook';

const simpleTestMessage = {
  event: 'message',
  session: 'default',
  payload: {
    id: `test_message_${Date.now()}`,
    timestamp: Math.floor(Date.now() / 1000),
    from: '6591051399@c.us',
    fromMe: false,
    body: 'Hello Jeremy, how are you?',
    hasMedia: false,
    ack: 1,
    vCards: [],
    _data: {
      id: {
        fromMe: false,
        remote: '6591051399@c.us',
        id: `test_message_${Date.now()}`,
        _serialized: `false_6591051399@c.us_test_message_${Date.now()}`
      },
      body: 'Hello Jeremy, how are you?',
      type: 'chat',
      timestamp: Math.floor(Date.now() / 1000),
      notifyName: 'Test Agent',
      from: '6591051399@c.us',
      to: '66803102230@c.us',
      self: 'out'
    }
  }
};

console.log('🧪 Testing webhook with message:', JSON.stringify(simpleTestMessage, null, 2));

try {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(simpleTestMessage)
  });

  console.log('📡 Response status:', response.status);
  console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));
  
  const responseBody = await response.text();
  console.log('📡 Response body:', responseBody);

  if (response.ok) {
    console.log('✅ Webhook test successful!');
  } else {
    console.log('❌ Webhook test failed!');
  }
} catch (error: unknown) {
  console.error('❌ Error testing webhook:', error);
}