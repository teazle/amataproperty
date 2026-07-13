import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

import { createWebhookHandler } from '../src/lib/wa/webhook-handler';

type UnknownRowsClient = {
  rpcCalls: Array<{ name: string; args: Record<string, string> }>;
  queryCalls: string[];
  setRows(rows: Array<{ id: string }>): void;
  client: {
    from(table: string): {
      select(columns: string): unknown;
      eq(column: string, value: string): unknown;
      limit(value: number): Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>;
    };
    rpc(name: string, args: Record<string, string>): Promise<{ data: null; error: { message: string } | null }>;
  };
};

function unknownRowsClient(
  initialRows: Array<{ id: string }>,
  error: { message: string } | null = null,
  rpcError: { message: string } | null = null,
): UnknownRowsClient {
  const queryCalls: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, string> }> = [];
  let rows = initialRows;
  const query = {
    select(columns: string) { queryCalls.push(`select:${columns}`); return query; },
    eq(column: string, value: string) { queryCalls.push(`eq:${column}=${value}`); return query; },
    limit(value: number) { queryCalls.push(`limit:${value}`); return Promise.resolve({ data: rows, error }); },
  };
  return {
    queryCalls,
    rpcCalls,
    setRows(nextRows) { rows = nextRows; },
    client: {
      from(table: string) { queryCalls.push(`from:${table}`); return query; },
      async rpc(name: string, args: Record<string, string>) {
        rpcCalls.push({ name, args });
        return { data: null, error: rpcError };
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
      const response = await createWebhookHandler()(webhookRequest(message(), 'wrong-secret'));
      expect(response.status).toBe(401);
    });
  });

  test('accepts the correct production webhook header', async () => {
    await withEnvironment({ NODE_ENV: 'production', WAHA_WEBHOOK_SECRET: 'expected-secret' }, async () => {
      let aiCalls = 0;
      const handler = createWebhookHandler({
        processInboundMessage: async () => { aiCalls += 1; return { success: true }; },
      });

      const response = await handler(webhookRequest(message(), 'expected-secret'));

      expect(response.status).toBe(200);
      expect(aiCalls).toBe(1);
    });
  });

  test('rejects a matching query-string secret when the webhook header is absent', async () => {
    await withEnvironment({ NODE_ENV: 'production', WAHA_WEBHOOK_SECRET: 'query-secret-must-not-work' }, async () => {
      const response = await createWebhookHandler()(webhookRequest(message()));
      expect(response.status).toBe(401);
    });
  });

  test('processes a successful STOP before and instead of the AI conversation engine', async () => {
    let aiCalls = 0;
    const optOutCalls: Array<{ recipient: string; messageId: string | null }> = [];
    const logCalls: Array<Record<string, unknown>> = [];
    const order: string[] = [];
    const handler = createWebhookHandler({
      processInboundMessage: async () => { aiCalls += 1; return { success: true }; },
      recordOptOut: async ({ recipient, messageId }) => {
        order.push('suppress');
        optOutCalls.push({ recipient, messageId });
      },
      normalizePhone: (value) => value.replace('@c.us', ''),
      findLatestOutreach: async () => {
        order.push('find-outreach');
        return { id: 'outreach-1', agent_id: 'agent-1' };
      },
      logMessage: async (input) => {
        order.push('log');
        logCalls.push(input);
        return { duplicate: false };
      },
    });

    const response = await handler(webhookRequest(message({ body: ' STOP ' })));

    expect(response.status).toBe(200);
    expect(aiCalls).toBe(0);
    expect(optOutCalls).toEqual([{ recipient: '6591051399@c.us', messageId: 'provider-message-1' }]);
    expect(order).toEqual(['suppress', 'find-outreach', 'log']);
    expect(logCalls).toEqual([expect.objectContaining({
      outreachId: 'outreach-1',
      agentId: 'agent-1',
      direction: 'inbound',
      phone: '6591051399',
      chatId: '6591051399@c.us',
      wahaMessageId: 'provider-message-1',
      body: ' STOP ',
    })]);
  });

  test('retries STOP suppression and deduplicated logging idempotently', async () => {
    let suppressionCalls = 0;
    let logCalls = 0;
    const handler = createWebhookHandler({
      recordOptOut: async () => { suppressionCalls += 1; },
      normalizePhone: (value) => value.replace('@c.us', ''),
      findLatestOutreach: async () => null,
      logMessage: async () => {
        logCalls += 1;
        return { duplicate: logCalls > 1 };
      },
    });

    const first = await handler(webhookRequest(message({ body: 'STOP' })));
    const retry = await handler(webhookRequest(message({ body: 'STOP' })));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(suppressionCalls).toBe(2);
    expect(logCalls).toBe(2);
  });

  test('returns a retriable failure when STOP persistence fails', async () => {
    let logCalls = 0;
    const handler = createWebhookHandler({
      recordOptOut: async () => { throw new Error('temporary database failure'); },
      normalizePhone: (value) => value.replace('@c.us', ''),
      findLatestOutreach: async () => null,
      logMessage: async () => { logCalls += 1; return { duplicate: false }; },
    });

    const response = await handler(webhookRequest(message({ body: 'STOP' })));

    expect(response.status).toBe(503);
    expect(logCalls).toBe(0);
  });

  test('returns a retriable failure when STOP logging fails', async () => {
    const handler = createWebhookHandler({
      recordOptOut: async () => {},
      normalizePhone: (value) => value.replace('@c.us', ''),
      findLatestOutreach: async () => null,
      logMessage: async () => { throw new Error('temporary message log failure'); },
    });

    const response = await handler(webhookRequest(message({ body: 'STOP' })));

    expect(response.status).toBe(503);
  });

  test('returns non-2xx for a STOP without a provider message ID', async () => {
    const recording = unknownRowsClient([]);
    let logCalls = 0;
    const handler = createWebhookHandler({
      getSupabaseClient: () => recording.client,
      normalizePhone: (value) => value.replace('@c.us', ''),
      findLatestOutreach: async () => null,
      logMessage: async () => { logCalls += 1; return { duplicate: false }; },
    });

    const response = await handler(webhookRequest(message({ body: 'STOP', id: undefined })));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain('provider message id is required');
    expect(recording.rpcCalls).toEqual([]);
    expect(logCalls).toBe(0);
  });

  test('treats string fromMe values as inbound messages', async () => {
    for (const fromMe of ['false', 'true']) {
      let aiCalls = 0;
      const handler = createWebhookHandler({
        processInboundMessage: async () => { aiCalls += 1; return { success: true }; },
      });

      const response = await handler(webhookRequest(message({ fromMe })));

      expect(response.status).toBe(200);
      expect(aiCalls).toBe(1);
    }
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

  test('returns non-2xx when the unknown reconciliation lookup fails', async () => {
    const recording = unknownRowsClient([], { message: 'temporary lookup failure' });
    const handler = createWebhookHandler({
      getSupabaseClient: () => recording.client,
      normalizePhone: (value) => value.replace('@c.us', ''),
      findLatestOutreach: async () => null,
      logMessage: async () => ({ duplicate: false }),
    });

    const response = await handler(webhookRequest(message({ fromMe: true })));

    expect(response.status).toBe(503);
    expect(recording.rpcCalls).toEqual([]);
  });

  test('returns non-2xx when unknown resolution RPC fails', async () => {
    const recording = unknownRowsClient([{ id: 'send-1' }], null, { message: 'temporary resolution failure' });
    const handler = createWebhookHandler({
      getSupabaseClient: () => recording.client,
      normalizePhone: (value) => value.replace('@c.us', ''),
      findLatestOutreach: async () => null,
      logMessage: async () => ({ duplicate: false }),
    });

    const response = await handler(webhookRequest(message({ fromMe: true })));

    expect(response.status).toBe(503);
    expect(recording.rpcCalls).toHaveLength(1);
  });

  test('does not resolve a repeated outbound event after the first resolution changed its state', async () => {
    const recording = unknownRowsClient([{ id: 'send-1' }]);
    let logCalls = 0;
    const handler = createWebhookHandler({
      getSupabaseClient: () => recording.client,
      normalizePhone: (value) => value.replace('@c.us', ''),
      findLatestOutreach: async () => null,
      logMessage: async () => { logCalls += 1; return { duplicate: logCalls > 1 }; },
    });

    const first = await handler(webhookRequest(message({ fromMe: true })));
    recording.setRows([]);
    const retry = await handler(webhookRequest(message({ fromMe: true })));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(recording.rpcCalls).toHaveLength(1);
    expect(logCalls).toBe(2);
  });

  test('wires the required production secret into the official WAHA custom header setting', () => {
    const compose = readFileSync(new URL('../docker-compose.prod.yml', import.meta.url), 'utf8');
    expect(compose).toContain(
      'WHATSAPP_HOOK_CUSTOM_HEADERS=X-WAHA-Webhook-Secret:${WAHA_WEBHOOK_SECRET:?WAHA_WEBHOOK_SECRET is required}',
    );
    expect(compose).not.toContain('X-WAHA-Webhook-Secret=');
  });

  test('requires the same non-empty API key for WAHA and SmartProp', () => {
    const compose = readFileSync(new URL('../docker-compose.prod.yml', import.meta.url), 'utf8');
    const example = readFileSync(new URL('../env.example', import.meta.url), 'utf8');

    expect(compose).toContain('WAHA_API_KEY=${WAHA_API_KEY:?WAHA_API_KEY is required}');
    expect(example).toContain('WAHA_API_KEY=replace-with-a-strong-random-api-key');
  });
});
