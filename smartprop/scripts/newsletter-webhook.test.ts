import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';

import { createWebhookHandler } from '../src/app/api/wa/webhook/route';

type UnknownRowsClient = {
  rpcCalls: Array<{ name: string; args: Record<string, string> }>;
  queryCalls: string[];
  client: {
    from(table: string): {
      select(columns: string): unknown;
      eq(column: string, value: string): unknown;
      limit(value: number): Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>;
    };
    rpc(name: string, args: Record<string, string>): Promise<{ data: null; error: { message: string } | null }>;
  };
};

function unknownRowsClient(rows: Array<{ id: string }>, error: { message: string } | null = null): UnknownRowsClient {
  const queryCalls: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, string> }> = [];
  const query = {
    select(columns: string) { queryCalls.push(`select:${columns}`); return query; },
    eq(column: string, value: string) { queryCalls.push(`eq:${column}=${value}`); return query; },
    limit(value: number) { queryCalls.push(`limit:${value}`); return Promise.resolve({ data: rows, error }); },
  };
  return {
    queryCalls,
    rpcCalls,
    client: {
      from(table: string) { queryCalls.push(`from:${table}`); return query; },
      async rpc(name: string, args: Record<string, string>) {
        rpcCalls.push({ name, args });
        return { data: null, error: null };
      },
    },
  };
}

function webhookRequest(payload: Record<string, unknown>, headerSecret?: string): NextRequest {
  return new NextRequest('http://localhost/api/wa/webhook?secret=query-secret-must-not-work', {
    method: 'POST',
    headers: headerSecret ? { 'content-type': 'application/json', 'x-waha-webhook-secret': headerSecret } : { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    from: '6591051399@c.us',
    to: '6591999999@c.us',
    body: 'hello',
    id: { _serialized: 'provider-message-1' },
    fromMe: false,
    ...overrides,
  };
}

async function withEnvironment<T>(values: Record<string, string | undefined>, run: () => Promise<T>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  try {
    return await run();
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

describe('WAHA webhook', () => {
  test('returns 503 when production secret configuration is missing', async () => {
    await withEnvironment({ NODE_ENV: 'production', WAHA_WEBHOOK_SECRET: undefined }, async () => {
      const response = await createWebhookHandler()(webhookRequest(message()));
      expect(response.status).toBe(503);
    });
  });

  test('uses only the webhook header for production secret verification', async () => {
    await withEnvironment({ NODE_ENV: 'production', WAHA_WEBHOOK_SECRET: 'expected-secret' }, async () => {
      const response = await createWebhookHandler()(webhookRequest(message()));
      expect(response.status).toBe(401);
    });
  });

  test('processes a successful STOP before and instead of the AI conversation engine', async () => {
    let aiCalls = 0;
    const optOutCalls: Array<{ recipient: string; messageId: string | null }> = [];
    const handler = createWebhookHandler({
      processInboundMessage: async () => { aiCalls += 1; return { success: true }; },
      recordOptOut: async ({ recipient, messageId }) => { optOutCalls.push({ recipient, messageId }); },
    });

    const response = await handler(webhookRequest(message({ body: ' STOP ' })));

    expect(response.status).toBe(200);
    expect(aiCalls).toBe(0);
    expect(optOutCalls).toEqual([{ recipient: '6591051399@c.us', messageId: 'provider-message-1' }]);
  });

  test('returns a retriable failure when STOP persistence fails', async () => {
    const handler = createWebhookHandler({
      recordOptOut: async () => { throw new Error('temporary database failure'); },
    });

    const response = await handler(webhookRequest(message({ body: 'STOP' })));

    expect(response.status).toBe(503);
  });

  test('treats string fromMe values as inbound messages', async () => {
    let aiCalls = 0;
    const handler = createWebhookHandler({
      processInboundMessage: async () => { aiCalls += 1; return { success: true }; },
    });

    const response = await handler(webhookRequest(message({ fromMe: 'false' })));

    expect(response.status).toBe(200);
    expect(aiCalls).toBe(1);
  });

  test('resolves exactly one matching outbound unknown send and caps the lookup at two rows', async () => {
    const recording = unknownRowsClient([{ id: 'send-1' }]);
    const handler = createWebhookHandler({
      getSupabaseClient: () => recording.client,
      normalizePhone: (value) => value.replace('@c.us', ''),
      findLatestOutreach: async () => null,
      logMessage: async () => ({ inserted: true, duplicate: false }),
    });

    const response = await handler(webhookRequest(message({ fromMe: true })));

    expect(response.status).toBe(200);
    expect(recording.queryCalls).toEqual([
      'from:newsletter_sends', 'select:id', 'eq:waha_message_id=provider-message-1', 'eq:status=unknown', 'limit:2',
    ]);
    expect(recording.rpcCalls).toEqual([{
      name: 'resolve_newsletter_unknown',
      args: {
        p_send_id: 'send-1',
        p_resolver: 'waha-webhook',
        p_resolution: 'sent',
        p_reason: 'matched outbound WAHA webhook provider message id',
      },
    }]);
  });

  test('logs normal outbound events without guessing when zero or multiple unknown sends match', async () => {
    for (const rows of [[], [{ id: 'send-1' }, { id: 'send-2' }]]) {
      const recording = unknownRowsClient(rows);
      let logCalls = 0;
      const handler = createWebhookHandler({
        getSupabaseClient: () => recording.client,
        normalizePhone: (value) => value.replace('@c.us', ''),
        findLatestOutreach: async () => null,
        logMessage: async () => { logCalls += 1; return { inserted: true, duplicate: false }; },
      });

      const response = await handler(webhookRequest(message({ fromMe: true })));

      expect(response.status).toBe(200);
      expect(logCalls).toBe(1);
      expect(recording.rpcCalls).toEqual([]);
    }
  });
});
