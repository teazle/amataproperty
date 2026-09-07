import { beforeEach, describe, expect, mock, test } from 'bun:test';

type TransportResult =
  | { outcome: 'accepted'; provider: 'waha'; messageId: string; messageText: string }
  | { outcome: 'unknown'; provider: 'waha'; error: string };

let transportResult: TransportResult = {
  outcome: 'accepted', provider: 'waha', messageId: 'adapter-message-1', messageText: 'default',
};
const transportCalls: Array<{ to: string; text: string; purpose: string }> = [];
const legacyCalls: string[] = [];

const wahaMock = () => ({
  generateCoBrokingInquiryMessage: (agentName: string, propertyTitle: string, propertyUrl: string) => {
    const firstName = agentName.split(' ')[0];
    return `Hi ${firstName}, Jeremy here\n\nI have a buyer who is interested in your ${propertyTitle}.\n\nWould you be open to co-broking?\n\n🔗 ${propertyUrl}`;
  },
  sendCoBrokingInquiry: async () => {
    legacyCalls.push('co-broking');
    return { success: true, messageId: 'legacy-message-id' };
  },
  sendWhatsAppMessage: async () => {
    legacyCalls.push('text');
    return { success: true, messageId: 'legacy-message-id' };
  },
  sendMessageWithTyping: async () => {
    legacyCalls.push('typing');
    return { success: true, messageId: 'legacy-message-id' };
  },
});

mock.module('@/lib/wa/waha', wahaMock);
mock.module('../src/lib/wa/waha.ts', wahaMock);
mock.module('@/lib/wa/customer-transport', () => ({
  createCustomerTextTransport: () => ({
    sendText: async (input: { to: string; text: string; purpose: string }) => {
      transportCalls.push(input);
      return transportResult;
    },
  }),
}));
mock.module('@/workers/supa', () => ({
  getSupabaseClient: () => ({ from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
}));

const { POST } = await import('../src/app/api/wa/send/route.ts');
const { sendAutoReply } = await import('../src/lib/ai/conversation.ts');

beforeEach(() => {
  transportResult = { outcome: 'accepted', provider: 'waha', messageId: 'adapter-message-1', messageText: 'default' };
  transportCalls.length = 0;
  legacyCalls.length = 0;
  process.env.ENABLE_TYPING_SIMULATION = 'false';
});

describe('remaining customer text callers', () => {
  test('sends the existing co-broking inquiry text through the customer transport', async () => {
    const response = await POST(new Request('http://localhost/api/wa/send', {
      method: 'POST',
      body: JSON.stringify({
        to: '+6591234567',
        type: 'co_broking_inquiry',
        agentName: 'Jane Tan',
        propertyTitle: 'The Arcadia',
        propertyUrl: 'https://propertyguru.com.sg/listing/123',
      }),
    }) as never);

    expect(response.status).toBe(200);
    expect(transportCalls).toEqual([{
      to: '+6591234567',
      text: 'Hi Jane, Jeremy here\n\nI have a buyer who is interested in your The Arcadia.\n\nWould you be open to co-broking?\n\n🔗 https://propertyguru.com.sg/listing/123',
      purpose: 'initial_cobroking',
    }]);
    expect(legacyCalls).toEqual([]);
  });

  test('returns unknown provider outcomes as non-retryable API results', async () => {
    transportResult = { outcome: 'unknown', provider: 'waha', error: 'provider timed out after send began' };

    const response = await POST(new Request('http://localhost/api/wa/send', {
      method: 'POST',
      body: JSON.stringify({ to: '91234567', text: 'Please confirm the viewing time.' }),
    }) as never);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(expect.objectContaining({ outcome: 'unknown', retryable: false }));
    expect(transportCalls).toEqual([{ to: '91234567', text: 'Please confirm the viewing time.', purpose: 'api_text' }]);
    expect(legacyCalls).toEqual([]);
  });

  test('does not report an accepted provider result without an id as sent', async () => {
    transportResult = { outcome: 'accepted', provider: 'waha', messageId: ' ', messageText: 'Please confirm the viewing time.' };

    const response = await POST(new Request('http://localhost/api/wa/send', {
      method: 'POST',
      body: JSON.stringify({ to: '91234567', text: 'Please confirm the viewing time.' }),
    }) as never);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(expect.objectContaining({ outcome: 'unknown', retryable: false }));
  });

  test('uses the customer transport after the legacy typing delay', async () => {
    process.env.ENABLE_TYPING_SIMULATION = 'true';

    const sent = await sendAutoReply('+6591234567', 'Please confirm the viewing time.', 'outreach-1', 0);

    expect(sent).toBe(true);
    expect(transportCalls).toEqual([{
      to: '+6591234567',
      text: 'Please confirm the viewing time.',
      purpose: 'auto_reply',
    }]);
    expect(legacyCalls).toEqual([]);
  });

  test('does not report an unknown immediate auto-reply outcome as sent', async () => {
    transportResult = { outcome: 'unknown', provider: 'waha', error: 'provider timed out after send began' };

    const sent = await sendAutoReply('91234567', 'Please confirm the viewing time.', 'outreach-1', 0);

    expect(sent).toBe(false);
    expect(transportCalls).toEqual([{
      to: '91234567',
      text: 'Please confirm the viewing time.',
      purpose: 'auto_reply',
    }]);
    expect(legacyCalls).toEqual([]);
  });
});
