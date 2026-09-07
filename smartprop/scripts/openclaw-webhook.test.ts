import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';

import { createOpenClawWebhookHandler } from '../src/lib/wa/openclaw-webhook-handler';
import { createWebhookHandler } from '../src/lib/wa/webhook-handler';

const NOW = 1_800_000_000;
const SECRET = 'openclaw-test-secret';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    accountId: 'default',
    from: '+6591051399',
    to: '6591999999@s.whatsapp.net',
    body: 'Hello from OpenClaw',
    messageId: 'source-message-1',
    timestamp: NOW,
    ...overrides,
  };
}

function openClawRequest(
  value: Record<string, unknown>,
  options: { secret?: string; timestamp?: string; signature?: string } = {},
): NextRequest {
  const rawBody = JSON.stringify(value);
  const timestamp = options.timestamp || String(NOW);
  const signature = options.signature || createHmac('sha256', options.secret || SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return new NextRequest('http://localhost/api/wa/openclaw', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-smartprop-timestamp': timestamp,
      'x-smartprop-signature': signature,
    },
    body: rawBody,
  });
}

function openClawHandler(overrides: Parameters<typeof createOpenClawWebhookHandler>[0] = {}) {
  return createOpenClawWebhookHandler({
    nowSeconds: () => NOW,
    secret: () => SECRET,
    provider: () => 'openclaw',
    account: () => 'default',
    ...overrides,
  });
}

describe('OpenClaw WhatsApp ingress', () => {
  test('rejects a bad signature, account mismatch, and stale timestamp before processing', async () => {
    let aiCalls = 0;
    const handler = openClawHandler({
      webhookDependencies: { processInboundMessage: async () => { aiCalls += 1; return { success: true }; } },
    });

    const badSignature = await handler(openClawRequest(payload(), { signature: '0'.repeat(64) }));
    const wrongAccount = await handler(openClawRequest(payload({ accountId: 'other-account' })));
    const stale = await handler(openClawRequest(payload(), { timestamp: String(NOW - 301) }));

    expect(badSignature.status).toBe(401);
    expect(wrongAccount.status).toBe(401);
    expect(stale.status).toBe(401);
    expect(aiCalls).toBe(0);
  });

  test('normalizes individual E.164 and JID addresses while preserving body and stable provider message id', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const handler = openClawHandler({
      webhookDependencies: {
        processInboundMessage: async (input) => { calls.push(input); return { success: true }; },
      },
    });

    const response = await handler(openClawRequest(payload()));

    expect(response.status).toBe(200);
    expect(calls).toEqual([expect.objectContaining({
      from: '6591051399@s.whatsapp.net',
      to: '6591999999@s.whatsapp.net',
      body: 'Hello from OpenClaw',
      messageId: 'openclaw:default:source-message-1',
      timestamp: NOW,
    })]);
  });

  test('handles STOP before the AI path through the existing webhook handler', async () => {
    let aiCalls = 0;
    const optOutCalls: Array<Record<string, unknown>> = [];
    const logCalls: Array<Record<string, unknown>> = [];
    const handler = openClawHandler({
      webhookDependencies: {
        processInboundMessage: async () => { aiCalls += 1; return { success: true }; },
        recordOptOut: async (input) => { optOutCalls.push(input); },
        normalizePhone: (value) => value.replace('@s.whatsapp.net', ''),
        findLatestOutreach: async () => null,
        logMessage: async (input) => { logCalls.push(input); return { duplicate: false }; },
      },
    });

    const response = await handler(openClawRequest(payload({ body: ' STOP ' })));

    expect(response.status).toBe(200);
    expect(aiCalls).toBe(0);
    expect(optOutCalls).toEqual([{ recipient: '6591051399@s.whatsapp.net', messageId: 'openclaw:default:source-message-1' }]);
    expect(logCalls).toEqual([expect.objectContaining({
      wahaMessageId: 'openclaw:default:source-message-1',
      body: ' STOP ',
    })]);
  });

  test('preserves the existing duplicate response contract', async () => {
    const handler = openClawHandler({
      webhookDependencies: { processInboundMessage: async () => ({ success: true, duplicate: true }) },
    });

    const response = await handler(openClawRequest(payload()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, duplicate: true });
  });

  test('rejects self, group, LID, empty identifiers, and malformed schema without processing', async () => {
    let aiCalls = 0;
    const handler = openClawHandler({
      webhookDependencies: { processInboundMessage: async () => { aiCalls += 1; return { success: true }; } },
    });

    for (const value of [
      payload({ fromMe: true }),
      payload({ from: '120363000000000@g.us' }),
      payload({ from: '12345@lid' }),
      payload({ messageId: '' }),
      payload({ body: '' }),
      payload({ body: 1 }),
      payload({ version: '1' }),
    ]) {
      expect((await handler(openClawRequest(value))).status).toBe(400);
    }
    expect(aiCalls).toBe(0);
  });

  test('rejects a missing OpenClaw secret even outside production', async () => {
    let aiCalls = 0;
    const handler = openClawHandler({
      secret: () => undefined,
      webhookDependencies: { processInboundMessage: async () => { aiCalls += 1; return { success: true }; } },
    });

    const response = await handler(openClawRequest(payload()));

    expect(response.status).toBe(503);
    expect(aiCalls).toBe(0);
  });

  test('fails closed when OpenClaw is not the selected provider', async () => {
    let aiCalls = 0;
    const handler = openClawHandler({
      provider: () => 'waha',
      webhookDependencies: { processInboundMessage: async () => { aiCalls += 1; return { success: true }; } },
    });

    const response = await handler(openClawRequest(payload()));

    expect(response.status).toBe(503);
    expect(aiCalls).toBe(0);
  });

  test('rejects WAHA ingress when OpenClaw is explicitly selected', async () => {
    const previous = process.env.SMARTPROP_WHATSAPP_PROVIDER;
    process.env.SMARTPROP_WHATSAPP_PROVIDER = 'openclaw';
    try {
      let aiCalls = 0;
      const handler = createWebhookHandler({
        processInboundMessage: async () => { aiCalls += 1; return { success: true }; },
      });
      const response = await handler(new NextRequest('http://localhost/api/wa/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: '6591051399@c.us', body: 'hello', id: 'waha-message' }),
      }));

      expect(response.status).toBe(503);
      expect(aiCalls).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.SMARTPROP_WHATSAPP_PROVIDER;
      else process.env.SMARTPROP_WHATSAPP_PROVIDER = previous;
    }
  });
});
