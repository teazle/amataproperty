import { expect, test } from 'bun:test';
import { createClient } from '@supabase/supabase-js';
import { createCustomerDeliveryStore } from '../src/lib/wa/customer-delivery-store';

function client(responses: Array<{ value: unknown; status?: number }>) {
  const calls: Array<{ path: string; body: unknown }> = [];
  const db = createClient('https://fixture.invalid', 'local-fixture-only', { global: { fetch: async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected database call');
    return new Response(JSON.stringify(response.value), { status: response.status ?? 200, headers: { 'content-type': 'application/json' } });
  } } });
  return { db, calls };
}
const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('claims through one database RPC and preserves a null lost claim', async () => {
  const f = client([{ value: token }, { value: null }]);
  const store = createCustomerDeliveryStore(f.db);
  const input = { key: 'viewing_request:listing-1', purpose: 'viewing_request' as const, recipient: '+6581234567' };
  expect(await store.claim(input)).toBe(token);
  expect(await store.claim(input)).toBeNull();
  expect(f.calls[0]).toEqual({ path: '/rest/v1/rpc/claim_customer_delivery', body: { p_key: input.key, p_purpose: input.purpose, p_recipient: input.recipient } });
});
test('database errors or malformed claim tokens fail closed before transport', async () => {
  for (const response of [{ value: { code: '42P01', message: 'ledger absent' }, status: 400 }, { value: '' }, { value: { token } }]) {
    const store = createCustomerDeliveryStore(client([response]).db);
    await expect(store.claim({ key: 'viewing_request:listing-1', purpose: 'viewing_request', recipient: '+6581234567' })).rejects.toThrow();
  }
});
test('finalization passes exact claim identity and only typed true means persisted', async () => {
  const f = client([{ value: true }, { value: false }, { value: 'true' }]);
  const store = createCustomerDeliveryStore(f.db);
  const input = { key: 'viewing_request:listing-1', token, outcome: 'accepted' as const, provider: 'openclaw', messageId: 'provider-1' };
  expect(await store.finish(input)).toBe(true);
  expect(await store.finish(input)).toBe(false);
  await expect(store.finish(input)).rejects.toThrow();
  expect(f.calls[0].body).toEqual({ p_key: input.key, p_token: token, p_outcome: 'accepted', p_provider: 'openclaw', p_message_id: 'provider-1', p_error: null });
});
test('accepted without a provider ID is never persisted and unknown keeps its cause', async () => {
  const f = client([{ value: true }]);
  const store = createCustomerDeliveryStore(f.db);
  await expect(store.finish({ key: 'viewing_request:listing-1', token, outcome: 'accepted', provider: 'openclaw', messageId: ' ' })).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
  expect(await store.finish({ key: 'viewing_request:listing-1', token, outcome: 'unknown', provider: 'openclaw', error: 'timeout' })).toBe(true);
  expect(f.calls[0].body).toEqual({ p_key: 'viewing_request:listing-1', p_token: token, p_outcome: 'unknown', p_provider: 'openclaw', p_message_id: null, p_error: 'timeout' });
});
