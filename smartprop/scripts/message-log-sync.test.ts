import { beforeEach, expect, test } from 'bun:test';
import { createOutreachHistorySynchronizer } from '../src/lib/wa/outreach-history-sync';

let historyRows: Array<Record<string, unknown>> = [];
let updateError: { message: string } | null = null;
const updates: Array<Record<string, unknown>> = [];

const syncOutreachConversationHistory = createOutreachHistorySynchronizer({
  getConversationHistory: async () => historyRows.map((row) => ({
    role: row.direction === 'outbound' ? 'user' : 'agent',
    message: row.body as string,
    timestamp: row.occurred_at as string,
    messageId: row.waha_message_id as string,
  })),
  updateOutreach: async (_outreachId, update) => {
    updates.push(update);
    return { error: updateError };
  },
});

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
