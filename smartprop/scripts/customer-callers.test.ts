import { beforeEach, describe, expect, mock, test } from 'bun:test';

type TransportResult =
  | { outcome: 'accepted'; provider: 'waha'; messageId: string; messageText: string }
  | { outcome: 'unknown'; provider: 'waha'; error: string };

let transportResult: TransportResult = { outcome: 'accepted', provider: 'waha', messageId: 'provider-accepted-1', messageText: 'default' };
const transportCalls: Array<{ to: string; text: string; purpose: string }> = [];
const outboundLogs: Array<Record<string, unknown>> = [];
const outreachUpdates: Array<Record<string, unknown>> = [];

mock.module('@/lib/wa/customer-transport', () => ({
  createCustomerTextTransport: () => ({
    sendText: async (input: { to: string; text: string; purpose: string }) => {
      transportCalls.push(input);
      return transportResult;
    },
  }),
}));
mock.module('@/lib/wa/waha', () => ({
  sendMessageWithTyping: async () => ({ success: true, messageId: 'legacy-message-id' }),
  sendWhatsAppMessage: async () => ({ success: true, messageId: 'legacy-message-id' }),
}));
mock.module('@/lib/ai/groq', () => ({
  parseViewingTimeslotsWithAI: async () => null,
  formatParsedTimeslots: () => '',
}));
mock.module('@/lib/wa/message-log', () => ({
  normalizeWhatsAppPhone: (value: string) => value.replace(/\D/g, ''),
  findLatestOutreachByPhone: async () => ({
    id: 'outreach-1', agent_id: 'agent-1', listing_id: 'listing-1', status: 'replied',
    conversation_phase: 'awaiting_cobroking', conversation_state: 'awaiting_cobroking', conversation_history: [],
    auto_reply_count: 0, first_message_sent_at: null, last_message_at: null, co_broking_status: 'unknown', co_broking_notes: null,
    agents: { id: 'agent-1', name: 'Agent Example', phone: '91234567' },
    listings: { id: 'listing-1', title: 'The Arcadia', price: 2450000, district: '09', property_type: 'Condominium' },
  }),
  logWhatsAppMessage: async (input: Record<string, unknown>) => {
    if (input.direction === 'outbound') outboundLogs.push(input);
    return { inserted: true, duplicate: false };
  },
  getConversationHistory: async () => [],
  syncOutreachConversationHistory: async () => [],
}));
mock.module('@/workers/supa', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => ({
      update: (value: Record<string, unknown>) => {
        if (table === 'outreach') outreachUpdates.push(value);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));

const { processInboundWhatsAppMessage } = await import('../src/lib/ai/whatsapp-conversation-engine.ts');
const { finalizeManualOutreachSend } = await import('../src/app/api/outreach/send-message/route.ts');

beforeEach(() => {
  transportResult = { outcome: 'accepted', provider: 'waha', messageId: 'provider-accepted-1', messageText: 'default' };
  transportCalls.length = 0;
  outboundLogs.length = 0;
  outreachUpdates.length = 0;
  delete process.env.GROQ_API_KEY;
});

describe('customer text callers', () => {
  test('persists the exact accepted provider id for an auto reply', async () => {
    const result = await processInboundWhatsAppMessage({ from: '6591234567@c.us', body: 'I am open to co-broking' });

    expect(result).toMatchObject({ success: true, sent: true });
    expect(transportCalls).toEqual([{ to: '6591234567', text: expect.any(String), purpose: 'auto_reply' }]);
    expect(outboundLogs).toEqual([expect.objectContaining({ wahaMessageId: 'provider-accepted-1' })]);
  });

  test('puts an unknown auto-reply outcome into non-retryable manual review without an outbound log', async () => {
    transportResult = { outcome: 'unknown', provider: 'waha', error: 'provider timed out after send began' };

    const result = await processInboundWhatsAppMessage({ from: '6591234567@c.us', body: 'I am open to co-broking' });

    expect(result).toMatchObject({ success: false, sent: false, retryable: false, outcome: 'unknown' });
    expect(outboundLogs).toEqual([]);
    expect(outreachUpdates).toContainEqual(expect.objectContaining({
      conversation_phase: 'manual_review',
      conversation_state: 'manual_review',
      co_broking_notes: expect.stringContaining('outcome=unknown; retryable=false'),
    }));
  });

  test('reports accepted manual outreach with a reconciliation warning when final persistence fails', async () => {
    const persisted: Array<Record<string, unknown>> = [];
    const result = await finalizeManualOutreachSend({
      outreachId: 'outreach-1', phone: '91234567', message: 'Please confirm the viewing time.',
      conversationHistory: [],
      transport: { sendText: async () => ({ outcome: 'accepted', provider: 'waha', messageId: 'provider-manual-1', messageText: 'Please confirm the viewing time.' }) },
      persist: async (data) => {
        persisted.push(data);
        return { error: new Error('database unavailable') };
      },
    });

    expect(result).toEqual(expect.objectContaining({ outcome: 'accepted', messageId: 'provider-manual-1', reconciliationWarning: 'database unavailable' }));
    expect(persisted).toEqual([expect.objectContaining({
      status: 'sent',
      conversation_history: [expect.objectContaining({ messageId: 'provider-manual-1' })],
    })]);
  });

  test('puts an unknown manual outcome into non-retryable manual review without a synthetic message id', async () => {
    const persisted: Array<Record<string, unknown>> = [];
    const result = await finalizeManualOutreachSend({
      outreachId: 'outreach-1', phone: '91234567', message: 'Please confirm the viewing time.',
      conversationHistory: [],
      transport: { sendText: async () => ({ outcome: 'unknown', provider: 'waha', error: 'provider timed out after send began' }) },
      persist: async (data) => {
        persisted.push(data);
        return { error: null };
      },
    });

    expect(result).toEqual(expect.objectContaining({ outcome: 'unknown', retryable: false, messageId: null }));
    expect(persisted).toEqual([expect.objectContaining({
      conversation_phase: 'manual_review',
      conversation_state: 'manual_review',
      co_broking_notes: expect.stringContaining('outcome=unknown; retryable=false'),
    })]);
  });
});
