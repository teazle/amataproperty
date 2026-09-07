import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createCustomerBridge } from '../openclaw/customer-bridge/bridge';

const config = { accountId: 'default', operatorNumbers: ['+6591111111'], customerNumbers: ['+6592222222'], endpoint: 'http://127.0.0.1:3000/api/wa/openclaw', secret: 'test-secret', selfNumber: '+6583333333' };
const event = { messageId: 'provider-1', content: 'STOP', body: 'UNTRUSTED formatted prompt', channel: 'whatsapp', senderId: '+6592222222', timestamp: 1700000000123, isGroup: false };
const ctx = { accountId: 'default', channelId: 'whatsapp', senderId: '+6592222222', messageId: 'provider-1' };

test('operator continues normally while unknown customers and groups cannot reach operator model', async () => {
  const bridge = createCustomerBridge(config, { fetch: async () => { throw new Error('must not forward'); } });
  expect(await bridge({ ...event, senderId: '+6591111111' }, { ...ctx, senderId: '+6591111111' })).toBeUndefined();
  expect(await bridge({ ...event, senderId: '+6594444444' }, { ...ctx, senderId: '+6594444444' })).toEqual({ handled: true });
  expect(await bridge({ ...event, isGroup: true }, ctx)).toEqual({ handled: true });
});

test('forwards exact raw message identity with authenticated body and claims without duplicate reply', async () => {
  let forwarded: unknown;
  const bridge = createCustomerBridge(config, {
    now: () => 1700000000000,
    fetch: async (url, init) => {
      expect(url).toBe(config.endpoint);
      expect(init?.redirect).toBe('error');
      const raw = String(init?.body);
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Smartprop-Signature')).toBe(createHmac('sha256', config.secret).update(`1700000000.${raw}`).digest('hex'));
      forwarded = JSON.parse(raw);
      return new Response('{"success":true}', { status: 200 });
    },
  });
  expect(await bridge(event, ctx)).toEqual({ handled: true });
  expect(forwarded).toEqual({ version: 1, accountId: 'default', from: '+6592222222', to: '+6583333333', body: 'STOP', messageId: 'provider-1', timestamp: 1700000000 });
});

test('HTTP failure and inconsistent sender fail closed without exposing body or making another send', async () => {
  const logs: string[] = [];
  let requests = 0;
  const bridge = createCustomerBridge(config, { fetch: async () => { requests++; throw new Error('secret body'); }, error: message => logs.push(message) });
  expect(await bridge(event, ctx)).toEqual({ handled: true });
  expect(requests).toBe(1);
  expect(logs.join()).not.toContain('secret body');
  expect(await bridge(event, { ...ctx, senderId: '+6591111111' })).toEqual({ handled: true });
  expect(requests).toBe(1);
});

test('rejects external endpoints and overlapping operator/customer identities at registration', () => {
  expect(() => createCustomerBridge({ ...config, endpoint: 'https://example.com/api/wa/openclaw' })).toThrow();
  expect(() => createCustomerBridge({ ...config, customerNumbers: config.operatorNumbers })).toThrow();
});
