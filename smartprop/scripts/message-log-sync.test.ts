import { beforeEach, expect, mock, test } from 'bun:test';

let historyRows: Array<Record<string, unknown>> = [];
let updateError: { message: string } | null = null;
const updates: Array<Record<string, unknown>> = [];

mock.module('@/workers/supa', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'wa_messages') {
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          then: (resolve: (value: unknown) => unknown) => resolve({ data: historyRows, error: null }),
        };
        return query;
      }
      return {
        update: (value: Record<string, unknown>) => ({
          eq: async () => {
            updates.push(value);
            return { error: updateError };
          },
        }),
      };
    },
  }),
}));

const { syncOutreachConversationHistory } = await import('../src/lib/wa/message-log');

beforeEach(() => {
  historyRows = [{ direction: 'inbound', body: 'STOP', occurred_at: '2026-09-08T00:00:00.000Z', waha_message_id: 'stop-1' }];
  updateError = null;
  updates.length = 0;
});

test('persists the logged STOP in outreach history and marks the linked outreach opted out', async () => {
  await expect(syncOutreachConversationHistory('outreach-1', { status: 'opted_out' })).resolves.toEqual([
    { role: 'agent', message: 'STOP', timestamp: '2026-09-08T00:00:00.000Z', messageId: 'stop-1' },
  ]);
  expect(updates).toEqual([{
    conversation_history: [{ role: 'agent', message: 'STOP', timestamp: '2026-09-08T00:00:00.000Z', messageId: 'stop-1' }],
    last_message_at: '2026-09-08T00:00:00.000Z',
    status: 'opted_out',
  }]);
});

test('surfaces an outreach history update error for webhook retry', async () => {
  updateError = { message: 'outreach unavailable' };
  await expect(syncOutreachConversationHistory('outreach-1', { status: 'opted_out' }))
    .rejects.toThrow('Failed to sync outreach conversation history: outreach unavailable');
});
