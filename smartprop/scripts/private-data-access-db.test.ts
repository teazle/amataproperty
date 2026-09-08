import { beforeAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';

const container = process.env.SMARTPROP_DELIVERY_TEST_CONTAINER;
const integration = container ? test : test.skip;
const sql = (statement: string) => execFileSync('docker', ['exec', container!, 'psql', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
beforeAll(() => {
  if (!container) return;
  const details = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
  expect(details.Config.Labels['codex.task']).toBe('smartprop-delivery-20260908');
  expect(details.HostConfig.NetworkMode).toBe('none');
});

integration('anonymous and Supabase authenticated roles cannot read, write or call private application operations', () => {
  for (const role of ['anon', 'authenticated']) {
    expect(sql(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v') AND (has_table_privilege('${role}',c.oid,'SELECT') OR has_table_privilege('${role}',c.oid,'INSERT') OR has_table_privilege('${role}',c.oid,'UPDATE') OR has_table_privilege('${role}',c.oid,'DELETE'))`)).toBe('0');
    expect(sql(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('${role}',p.oid,'EXECUTE')`)).toBe('0');
    expect(() => sql(`SET ROLE ${role}; SELECT phone FROM public.agents LIMIT 1`)).toThrow();
  }
});

integration('the authenticated server service role retains application reads and delivery RPC execution', () => {
  expect(Number(sql('SET ROLE service_role; SELECT count(*) FROM public.listings'))).toBeGreaterThan(1000);
  expect(sql("SELECT has_function_privilege('service_role','public.claim_customer_delivery(text,text,text)','EXECUTE')")).toBe('t');
});

integration('future functions remain private while the server role can execute them', () => {
  expect(sql(`BEGIN;
    CREATE FUNCTION public.smartprop_future_access_test() RETURNS integer LANGUAGE sql AS 'SELECT 1';
    SELECT has_function_privilege('anon','public.smartprop_future_access_test()','EXECUTE'),
           has_function_privilege('authenticated','public.smartprop_future_access_test()','EXECUTE'),
           has_function_privilege('service_role','public.smartprop_future_access_test()','EXECUTE');
    ROLLBACK;`)).toBe('f|f|t');
});
