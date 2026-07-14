import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const verifierPath = join(import.meta.dir, 'verify-chloe-openclaw.sh');

function run(extraEnv: Record<string, string> = {}, args: string[] = []) {
  chmodSync(verifierPath, 0o755);
  return Bun.spawnSync([verifierPath, '--local-test', ...args], {
    env: {
      ...process.env,
      CHLOE_OPENCLAW_VERIFIER_TEST_MODE: '1',
      CHLOE_TEST_HOSTNAME: 'vmi3136623',
      CHLOE_TEST_PUBLIC_IP: '194.233.94.3',
      CHLOE_TEST_OPENCLAW_VERSION: '2026.7.1',
      CHLOE_TEST_OPENCLAW_COMMIT: '2d2ddc4',
      CHLOE_TEST_NODE_VERSION: '22.23.1',
      CHLOE_TEST_NODE_ENGINE: '>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0',
      CHLOE_TEST_SERVICE_ACTIVE: 'active',
      CHLOE_TEST_SERVICE_ENABLED: 'enabled',
      CHLOE_TEST_NRESTARTS: '0',
      CHLOE_TEST_HEALTH_OK: 'true',
      CHLOE_TEST_HEALTH_STATUS: 'live',
      CHLOE_TEST_CONFIG_VALID: 'true',
      CHLOE_TEST_GATEWAY_RPC_OK: 'true',
      CHLOE_TEST_GATEWAY_VERSION: '2026.7.1',
      CHLOE_TEST_MODEL: 'openai/gpt-5.6-sol',
      CHLOE_TEST_THINKING: 'high',
      CHLOE_TEST_MAIN_IS_DEFAULT: 'true',
      CHLOE_TEST_AUTH_USABLE: 'true',
      CHLOE_TEST_RUN_FOUND: 'true',
      CHLOE_TEST_RUN_STATUS: 'success',
      CHLOE_TEST_RUN_RESPONSE: 'CHLOE_SOL_HIGH_OK',
      CHLOE_TEST_RUN_PROVIDER: 'openai',
      CHLOE_TEST_RUN_MODEL: 'gpt-5.6-sol',
      CHLOE_TEST_RUN_THINKING: 'high',
      CHLOE_TEST_RUN_FALLBACK_USED: 'false',
      CHLOE_TEST_RUN_STOP_REASON: 'stop',
      CHLOE_TEST_RUN_DELIVERY_SAFE: 'true',
      ...extraEnv,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

describe('Chloe OpenClaw verifier contract', () => {
  test('is pinned to Chloe and remains read-only', () => {
    const verifier = readFileSync(verifierPath, 'utf8');
    expect(verifier).toContain('root@194.233.94.3');
    expect(verifier).toContain('vmi3136623');
    expect(verifier).toContain('openai/gpt-5.6-sol');
    expect(verifier).toContain('CHLOE_SOL_HIGH_OK');
    expect(verifier).toContain('StrictHostKeyChecking=yes');
    expect(verifier).toContain('ServerAliveInterval=10');
    expect(verifier).toContain('ServerAliveCountMax=3');
    expect(verifier).toContain('alarm shift');
    expect(verifier).toContain('openclaw agents list --json');
    expect(verifier).not.toContain('--deliver');
    expect(verifier).not.toMatch(/\b(scp|rsync)\b/);
    expect(verifier).not.toMatch(/\bsystemctl(?: --user)? (enable|disable|start|stop|restart|daemon-reload|preset)\b/);
    expect(verifier).not.toMatch(/\b(rm|cp|mv|install)\b/);
  });

  test('accepts the verified live state and real Sol High proof', () => {
    const result = run();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('verification=pass');
    expect(result.stdout.toString()).toContain('runId=b8c35794-e6b7-4b25-ba33-a61420cb2966');
  });

  test('fails closed on an incompatible Node engine', () => {
    const result = run({ CHLOE_TEST_NODE_ENGINE: '>=24' });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('Node does not satisfy');
  });

  test('fails closed when the configured model or thinking level drifts', () => {
    expect(run({ CHLOE_TEST_MODEL: 'openai/gpt-5.5' }).exitCode).not.toBe(0);
    expect(run({ CHLOE_TEST_THINKING: 'medium' }).exitCode).not.toBe(0);
    expect(run({ CHLOE_TEST_MAIN_IS_DEFAULT: 'false' }).exitCode).not.toBe(0);
  });

  test('fails closed when the running gateway version differs from the package', () => {
    const result = run({ CHLOE_TEST_GATEWAY_VERSION: '2026.6.11' });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('running gateway version drift');
  });

  test('rejects fallback or missing real-run evidence', () => {
    expect(run({ CHLOE_TEST_RUN_FALLBACK_USED: 'true' }).exitCode).not.toBe(0);
    expect(run({ CHLOE_TEST_RUN_FOUND: 'false' }).exitCode).not.toBe(0);
  });

  test('requires proof that the diagnostic run had no external delivery path', () => {
    const result = run({ CHLOE_TEST_RUN_DELIVERY_SAFE: 'false' });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('external delivery');
  });

  test('preflights a target release before an updater may run', () => {
    for (const range of ['^22.22.3', '22.x', '22.22.3 - 22.99.0']) {
      const good = run({
        CHLOE_TEST_TARGET_VERSION: '2026.7.1',
        CHLOE_TEST_TARGET_ENGINE: range,
      }, ['--preflight-update=2026.7.1']);
      expect(good.exitCode).toBe(0);
      expect(good.stdout.toString()).toContain('updatePreflight=pass');
    }

    const bad = run({
      CHLOE_TEST_TARGET_VERSION: '2026.8.0',
      CHLOE_TEST_TARGET_ENGINE: '>=24',
    }, ['--preflight-update=2026.8.0']);
    expect(bad.exitCode).not.toBe(0);
  });

  test('rejects target overrides', () => {
    expect(run({}, ['--target=root@example.com']).exitCode).toBe(64);
    expect(run({}, ['--preflight-update=latest']).exitCode).toBe(64);
  });
});
