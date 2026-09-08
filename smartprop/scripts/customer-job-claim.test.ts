import { beforeEach, describe, expect, mock, test } from 'bun:test';

type TransportResult =
  | { outcome: 'accepted'; provider: 'waha'; messageId: string; messageText: string }
  | { outcome: 'blocked' | 'rejected' | 'unknown'; provider: 'waha'; error: string };

let matchRows: Array<Record<string, unknown>> = [];
let viewingRows: Array<Record<string, unknown>> = [];
const matchUpdates: Array<Record<string, unknown>> = [];
const viewingUpdates: Array<Record<string, unknown>> = [];
const viewingOutreachInserts: Array<Record<string, unknown>> = [];
const legacyCalls: string[] = [];
let matchUpdateThrows = false;
let messageLogThrows = false;
let viewingOutreachError = false;
let viewingUpdateError = false;
let defaultDeliveryStore: { claim: (input: Record<string, string>) => Promise<string | null>; finish: (input: Record<string, string>) => Promise<boolean> } | null = null;
let defaultCustomerTransport: { sendText: (input: Record<string, string>) => Promise<TransportResult> } | null = null;

function matchDatabase() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq() { return this; },
        gte() { return this; },
        lte() { return this; },
        in() { return this; },
        limit() { return this; },
        order: async () => ({ data: table === 'outreach' ? matchRows : [], error: null }),
      }),
      update: (value: Record<string, unknown>) => ({
        eq: async () => {
          matchUpdates.push({ table, ...value });
          if (matchUpdateThrows) throw new Error('match domain write failed');
          return { error: null };
        },
      }),
    }),
  };
}

function viewingDatabase() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq() { return this; },
        not() { return this; },
        limit: async () => ({ data: table === 'listings' ? viewingRows : [], error: null }),
      }),
      insert: async (value: Record<string, unknown>) => {
        viewingOutreachInserts.push({ table, ...value });
        return { error: viewingOutreachError ? new Error('viewing outreach write failed') : null };
      },
      update: (value: Record<string, unknown>) => ({
        eq: async () => {
          viewingUpdates.push({ table, ...value });
          return { error: viewingUpdateError ? new Error('viewing listing write failed') : null };
        },
      }),
    }),
  };
}

mock.module('@supabase/supabase-js', () => ({ createClient: () => matchDatabase() }));
mock.module('@/workers/supa', () => ({ getSupabaseClient: () => viewingDatabase() }));
mock.module('../src/lib/wa/customer-delivery-store.ts', () => ({
  createCustomerDeliveryStore: () => {
    if (!defaultDeliveryStore) throw new Error('default delivery store was not configured');
    return defaultDeliveryStore;
  },
}));
mock.module('../src/lib/wa/customer-transport.ts', () => ({
  createCustomerTextTransport: () => {
    if (!defaultCustomerTransport) throw new Error('default customer transport was not configured');
    return defaultCustomerTransport;
  },
}));
mock.module('./lock', () => ({ tryAdvisoryLock: async () => true, advisoryUnlock: async () => undefined }));
mock.module('../src/jobs/lock.ts', () => ({ tryAdvisoryLock: async () => true, advisoryUnlock: async () => undefined }));
mock.module('@/lib/wa/message-log', () => ({
  normalizeWhatsAppPhone: (value: string) => value.replace(/\D/g, ''),
  findLatestOutreachByPhone: async () => null,
  getConversationHistory: async () => [],
  syncOutreachConversationHistory: async () => [],
  logWhatsAppMessage: async () => {
    if (messageLogThrows) throw new Error('conversation log write failed');
    return { inserted: true, duplicate: false };
  },
}));
mock.module('@/lib/wa/waha', () => ({
  generateCoBrokingInquiryMessage: (name: string, title: string, url: string) => `Hi ${name.split(' ')[0]}, Jeremy here\n\nI have a buyer who is interested in your ${title}.\n\nWould you be open to co-broking?\n\n🔗 ${url}`,
  generateViewingRequestMessage: (name: string, title: string) => `Hi ${name.split(' ')[0]}\n\nGreat to hear you're open to co-broking.\n\nWhat viewing times do you have available this week for the ${title}?\n\nThanks`,
  getWAHAReadiness: async () => ({ ready: true }),
  sendCampaignWhatsApp: async () => { legacyCalls.push('campaign'); throw new Error('WAHA bypass must not run'); },
  sendCoBrokingInquiry: async () => { legacyCalls.push('initial'); throw new Error('WAHA bypass must not run'); },
  sendViewingRequest: async () => { legacyCalls.push('viewing'); throw new Error('WAHA bypass must not run'); },
}));

const { processOutreachMessages, runMatchingJob } = await import('../src/jobs/match.ts');
const { sendViewingRequests } = await import('../src/jobs/viewing-request.ts');

function initialOutreach(id: string) {
  return {
    id,
    agent_id: 'agent-1',
    listing_id: 'listing-1',
    agents: { name: 'Jane Tan', phone: '91234567' },
    listings: { title: 'The Arcadia', url: 'https://propertyguru.com.sg/listing/1' },
  };
}

function viewingListing() {
  return {
    id: 'listing-1',
    agent_id: 'agent-1',
    url: 'https://propertyguru.com.sg/listing/1',
    title: 'The Arcadia',
    viewing_status: 'pending',
    agents: { name: 'Jane Tan', phone: '91234567' },
  };
}

function sharedStore({ finish }: { finish?: (input: Record<string, string>) => boolean | Error } = {}) {
  const claimed = new Set<string>();
  const claims: Array<Record<string, string>> = [];
  const finishes: Array<Record<string, string>> = [];
  return {
    claims,
    finishes,
    store: {
      claim: async (input: Record<string, string>) => {
        claims.push(input);
        if (claimed.has(input.key)) return null;
        claimed.add(input.key);
        return `token-${input.key}`;
      },
      finish: async (input: Record<string, string>) => {
        finishes.push(input);
        const result = finish?.(input);
        if (result instanceof Error) throw result;
        if (input.outcome === 'blocked' && result !== false) claimed.delete(input.key);
        return result ?? true;
      },
    },
  };
}

function transport(results: TransportResult[]) {
  const calls: Array<Record<string, string>> = [];
  return {
    calls,
    customerTransport: {
      sendText: async (input: Record<string, string>) => {
        calls.push(input);
        return results.shift()!;
      },
    },
  };
}

beforeEach(() => {
  matchRows = [];
  viewingRows = [];
  matchUpdates.length = 0;
  viewingUpdates.length = 0;
  viewingOutreachInserts.length = 0;
  legacyCalls.length = 0;
  matchUpdateThrows = false;
  messageLogThrows = false;
  viewingOutreachError = false;
  viewingUpdateError = false;
  defaultDeliveryStore = null;
  defaultCustomerTransport = null;
});

describe('customer delivery claims in remaining jobs', () => {
  test('concurrent duplicate initial outreach rows claim once before one selected-adapter send', async () => {
    matchRows = [initialOutreach('outreach-1'), initialOutreach('outreach-2')];
    const delivery = sharedStore();
    const selected = transport([{ outcome: 'accepted', provider: 'waha', messageId: 'provider-initial-1', messageText: 'initial message' }]);

    await Promise.all([
      processOutreachMessages(10, 0, {}, { deliveryStore: delivery.store, customerTransport: selected.customerTransport }),
      processOutreachMessages(10, 0, {}, { deliveryStore: delivery.store, customerTransport: selected.customerTransport }),
    ]);

    expect(selected.calls).toEqual([expect.objectContaining({ purpose: 'initial_cobroking', to: '91234567' })]);
    expect(delivery.finishes).toEqual([expect.objectContaining({ outcome: 'accepted', messageId: 'provider-initial-1' })]);
    expect(matchUpdates.filter(update => update.status === 'sent')).toHaveLength(1);
    expect(legacyCalls).toEqual([]);
  });

  test('unknown initial delivery is finalized once and is never resent', async () => {
    matchRows = [initialOutreach('outreach-1')];
    const delivery = sharedStore();
    const selected = transport([{ outcome: 'unknown', provider: 'waha', error: 'provider timed out after send began' }]);

    await processOutreachMessages(10, 0, {}, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });
    await processOutreachMessages(10, 0, {}, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });

    expect(selected.calls).toHaveLength(1);
    expect(delivery.finishes).toEqual([expect.objectContaining({ outcome: 'unknown' })]);
    expect(matchUpdates).toEqual([]);
    expect(legacyCalls).toEqual([]);
  });

  test('a failed viewing finalization leaves domain rows pending and prevents resend', async () => {
    viewingRows = [viewingListing()];
    const delivery = sharedStore({ finish: () => new Error('delivery finalization failed') });
    const selected = transport([{ outcome: 'accepted', provider: 'waha', messageId: 'provider-viewing-1', messageText: 'viewing message' }]);

    const first = await sendViewingRequests(1, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });
    await sendViewingRequests(1, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });

    expect(selected.calls).toHaveLength(1);
    expect(first).toMatchObject({ success: false, sent: 1, failed: 1, reconciliationRequired: 1 });
    expect(viewingOutreachInserts).toEqual([]);
    expect(viewingUpdates).toEqual([]);
    expect(legacyCalls).toEqual([]);
  });

  test('blocked viewing delivery finalizes blocked and can be safely claimed later', async () => {
    viewingRows = [viewingListing()];
    const delivery = sharedStore();
    const selected = transport([
      { outcome: 'blocked', provider: 'waha', error: 'provider unavailable' },
      { outcome: 'accepted', provider: 'waha', messageId: 'provider-viewing-2', messageText: 'viewing message' },
    ]);

    await sendViewingRequests(1, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });
    await sendViewingRequests(1, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });

    expect(selected.calls).toHaveLength(2);
    expect(selected.calls.map(call => call.idempotencyKey)).toEqual([
      'viewing_request:listing-1',
      'viewing_request:listing-1',
    ]);
    expect(delivery.finishes.map(finish => finish.outcome)).toEqual(['blocked', 'accepted']);
    expect(viewingUpdates.filter(update => update.viewing_status === 'requested')).toHaveLength(1);
    expect(legacyCalls).toEqual([]);
  });

  test('distinct viewing delivery claims use distinct gateway idempotency keys', async () => {
    viewingRows = [
      viewingListing(),
      { ...viewingListing(), id: 'listing-2', agent_id: 'agent-2' },
    ];
    const delivery = sharedStore();
    const selected = transport([
      { outcome: 'accepted', provider: 'waha', messageId: 'provider-viewing-1', messageText: 'viewing message' },
      { outcome: 'accepted', provider: 'waha', messageId: 'provider-viewing-2', messageText: 'viewing message' },
    ]);

    await sendViewingRequests(2, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });

    expect(selected.calls.map(call => call.idempotencyKey)).toEqual([
      'viewing_request:listing-1',
      'viewing_request:listing-2',
    ]);
  });

  test('concurrent viewing requests claim once before one selected-adapter send', async () => {
    viewingRows = [viewingListing()];
    const delivery = sharedStore();
    const selected = transport([{ outcome: 'accepted', provider: 'waha', messageId: 'provider-viewing-concurrent', messageText: 'viewing message' }]);

    await Promise.all([
      sendViewingRequests(1, { deliveryStore: delivery.store, customerTransport: selected.customerTransport }),
      sendViewingRequests(1, { deliveryStore: delivery.store, customerTransport: selected.customerTransport }),
    ]);

    expect(selected.calls).toHaveLength(1);
    expect(viewingOutreachInserts).toHaveLength(1);
    expect(viewingUpdates.filter(update => update.viewing_status === 'requested')).toHaveLength(1);
    expect(legacyCalls).toEqual([]);
  });

  test('a false viewing finalization prevents domain writes and a resend', async () => {
    viewingRows = [viewingListing()];
    const delivery = sharedStore({ finish: () => false });
    const selected = transport([{ outcome: 'accepted', provider: 'waha', messageId: 'provider-viewing-false', messageText: 'viewing message' }]);

    const first = await sendViewingRequests(1, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });
    await sendViewingRequests(1, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });

    expect(selected.calls).toHaveLength(1);
    expect(first).toMatchObject({ success: false, sent: 1, failed: 1, reconciliationRequired: 1 });
    expect(viewingOutreachInserts).toEqual([]);
    expect(viewingUpdates).toEqual([]);
    expect(legacyCalls).toEqual([]);
  });

  test('accepted initial delivery records reconciliation when its domain write throws and is never resent', async () => {
    matchRows = [initialOutreach('outreach-1')];
    matchUpdateThrows = true;
    const delivery = sharedStore();
    const selected = transport([{ outcome: 'accepted', provider: 'waha', messageId: 'provider-initial-reconcile', messageText: 'initial message' }]);

    const first = await processOutreachMessages(10, 0, {}, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });
    await processOutreachMessages(10, 0, {}, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });

    expect(first).toMatchObject({ sent: 1, failed: 0, reconciliationRequired: 1 });
    expect(selected.calls).toHaveLength(1);
    expect(delivery.finishes).toEqual([expect.objectContaining({ outcome: 'accepted', messageId: 'provider-initial-reconcile' })]);
  });

  test('accepted viewing delivery reports persistence reconciliation without a false clean success', async () => {
    viewingRows = [viewingListing()];
    viewingOutreachError = true;
    viewingUpdateError = true;
    const delivery = sharedStore();
    const selected = transport([{ outcome: 'accepted', provider: 'waha', messageId: 'provider-viewing-reconcile', messageText: 'viewing message' }]);

    const first = await sendViewingRequests(1, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });
    await sendViewingRequests(1, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });

    expect(first).toMatchObject({ success: false, sent: 1, reconciliationRequired: 1 });
    expect(first.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('viewing outreach write failed'),
      expect.stringContaining('viewing listing write failed'),
    ]));
    expect(selected.calls).toHaveLength(1);
  });

  test('matching-job preview never claims or sends queued outreach rows', async () => {
    matchRows = [initialOutreach('outreach-1')];
    const delivery = sharedStore();
    const selected = transport([{ outcome: 'accepted', provider: 'waha', messageId: 'provider-matching-reconcile', messageText: 'initial message' }]);
    defaultDeliveryStore = delivery.store;
    defaultCustomerTransport = selected.customerTransport;

    const result = await runMatchingJob(10);

    expect(result).toMatchObject({ success: true, dryRun: true, stats: { messagesSent: 0, messagesProcessed: 0 } });
    expect(delivery.claims).toEqual([]);
    expect(selected.calls).toEqual([]);
  });

  test('matching-job preview remains read-only when repeated', async () => {
    matchRows = [initialOutreach('outreach-log')];
    const delivery = sharedStore();
    const selected = transport([{ outcome: 'accepted', provider: 'waha', messageId: 'provider-log', messageText: 'initial message' }]);
    defaultDeliveryStore = delivery.store;
    defaultCustomerTransport = selected.customerTransport;
    const first = await runMatchingJob(10);
    await runMatchingJob(10);
    expect(first).toMatchObject({ success: true, dryRun: true, stats: { messagesSent: 0, messagesProcessed: 0 } });
    expect(delivery.claims).toEqual([]);
    expect(selected.calls).toEqual([]);
  });

  test('initial accepted delivery with failed finalization is visibly reconciliation-required', async () => {
    matchRows = [initialOutreach('outreach-finalize')];
    const delivery = sharedStore({ finish: () => false });
    const selected = transport([{ outcome: 'accepted', provider: 'waha', messageId: 'provider-finalize', messageText: 'initial message' }]);
    const first = await processOutreachMessages(10, 0, {}, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });
    await processOutreachMessages(10, 0, {}, { deliveryStore: delivery.store, customerTransport: selected.customerTransport });
    expect(first).toMatchObject({ sent: 1, failed: 1, reconciliationRequired: 1 });
    expect(selected.calls).toHaveLength(1);
    expect(matchUpdates).toEqual([]);
  });
});
