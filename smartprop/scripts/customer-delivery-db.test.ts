import { beforeAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';

// Explicit local integration lane only; the provider-free suite never launches Docker.
const container = process.env.SMARTPROP_DELIVERY_TEST_CONTAINER;
const integration = container ? test : test.skip;
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
function args(sql: string) { return ['exec', container!, 'psql', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', sql]; }
function sql(statement: string, role = 'service_role') {
  return execFileSync('docker', args(`SET ROLE ${role}; ${statement}`), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function claim(key: string) { return `SELECT public.claim_customer_delivery(${quote(key)},'viewing_request','+6581234567')`; }
function finish(key: string, token: string, outcome: string, id = 'provider-test-id') {
  return `SELECT public.finish_customer_delivery(${quote(key)},${quote(token)},${quote(outcome)},'openclaw',${quote(id)},NULL)`;
}
function key() { return `viewing_request:${crypto.randomUUID()}`; }
beforeAll(() => {
  if (!container) return;
  const details = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
  expect(details.Config.Labels['codex.task']).toBe('smartprop-delivery-20260908');
  expect(details.HostConfig.NetworkMode).toBe('none');
});

integration('real concurrent database clients acquire only one attempt', async () => {
  const id = key();
  const processes = Array.from({ length: 8 }, () => Bun.spawn(['docker', ...args(`SET ROLE service_role; ${claim(id)}`)], { stdout: 'pipe', stderr: 'pipe' }));
  const tokens = await Promise.all(processes.map(async child => {
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    return output.trim();
  }));
  expect(tokens.filter(Boolean)).toHaveLength(1);
  expect(sql(`SELECT attempt_no FROM public.customer_delivery_attempts WHERE delivery_key=${quote(id)}`)).toBe('1');
});
integration('unknown and accepted ledger states cannot be reclaimed', () => {
  for (const state of ['unknown', 'accepted', 'rejected']) {
    const id = key(); const token = sql(claim(id));
    expect(sql(finish(id, token, state))).toBe('t');
    expect(sql(claim(id))).toBe('');
  }
});
integration('blocked before send can be reclaimed once and stale token cannot finalize', () => {
  const id = key(); const first = sql(claim(id));
  expect(sql(finish(id, first, 'blocked'))).toBe('t');
  const second = sql(claim(id));
  expect(second).not.toBe(first);
  expect(sql(finish(id, first, 'accepted'))).toBe('f');
  expect(sql(finish(id, second, 'accepted'))).toBe('t');
});
integration('failed finalization retains the claim and forbids automatic resend', () => {
  const id = key(); const token = sql(claim(id));
  expect(() => sql(finish(id, token, 'accepted', ''))).toThrow();
  expect(sql(claim(id))).toBe('');
  expect(sql(`SELECT state FROM public.customer_delivery_attempts WHERE delivery_key=${quote(id)}`)).toBe('claimed');
});
integration('public and authenticated roles cannot claim or read delivery data', () => {
  for (const role of ['anon','authenticated']) {
    expect(() => sql(claim(key()), role)).toThrow();
    expect(() => sql('SELECT * FROM public.customer_delivery_attempts', role)).toThrow();
  }
});
integration('accepted table rows require a real provider id even outside the RPC', () => {
  expect(() => sql(`INSERT INTO public.customer_delivery_attempts(delivery_key,purpose,recipient,state,provider) VALUES (${quote(key())},'viewing_request','+6581234567','accepted','openclaw')`)).toThrow();
});
