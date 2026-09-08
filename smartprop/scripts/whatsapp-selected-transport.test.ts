import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createCampaignMessagingDependencies } from './run-whatsapp-newsletter-campaign';
import {
  createSelectedWhatsAppCampaignTransport,
  type SelectedTransportDependencies,
} from '../src/lib/wa/selected-transport';

const originalProvider = process.env.SMARTPROP_WHATSAPP_PROVIDER;
const originalAgent = process.env.SMARTPROP_OPENCLAW_WHATSAPP_AGENT_ID;
const originalAccount = process.env.SMARTPROP_OPENCLAW_WHATSAPP_ACCOUNT;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function openClawStatus(accounts: Array<Record<string, unknown>>): string {
  return JSON.stringify({ channelAccounts: { whatsapp: accounts } });
}

function readyAccount(accountId: string): Record<string, unknown> {
  return {
    accountId,
    enabled: true,
    configured: true,
    running: true,
    connected: true,
    healthState: 'healthy',
    terminalDisconnect: false,
  };
}

describe('provider-selected newsletter transport', () => {
  beforeEach(() => {
    delete process.env.SMARTPROP_WHATSAPP_PROVIDER;
    delete process.env.SMARTPROP_OPENCLAW_WHATSAPP_AGENT_ID;
    delete process.env.SMARTPROP_OPENCLAW_WHATSAPP_ACCOUNT;
  });

  afterEach(() => {
    restoreEnv('SMARTPROP_WHATSAPP_PROVIDER', originalProvider);
    restoreEnv('SMARTPROP_OPENCLAW_WHATSAPP_AGENT_ID', originalAgent);
    restoreEnv('SMARTPROP_OPENCLAW_WHATSAPP_ACCOUNT', originalAccount);
  });

  test('the callable CLI messaging factory defaults to WAHA and never touches OpenClaw', async () => {
    const calls: string[] = [];
    const dependencies = createCampaignMessagingDependencies({
      getWAHAReadiness: async () => {
        calls.push('waha:readiness');
        return { online: true, ready: true };
      },
      sendWAHA: async () => {
        calls.push('waha:send');
        return { outcome: 'accepted', messageId: 'waha-1' };
      },
      openClawRun: async () => {
        calls.push('openclaw');
        throw new Error('OpenClaw must not be selected');
      },
    });

    expect(await dependencies.preflight()).toEqual({ ready: true, error: undefined });
    expect(await dependencies.transport('+6591051399', 'hello')).toEqual({
      outcome: 'accepted',
      messageId: 'waha-1',
    });
    expect(calls).toEqual(['waha:readiness', 'waha:send']);
  });

  test('the callable CLI messaging factory selects OpenClaw and propagates one account to readiness and send', async () => {
    process.env.SMARTPROP_WHATSAPP_PROVIDER = 'openclaw';
    process.env.SMARTPROP_OPENCLAW_WHATSAPP_AGENT_ID = 'customer-service';
    process.env.SMARTPROP_OPENCLAW_WHATSAPP_ACCOUNT = 'primary';
    const calls: Array<{ command: string; args: string[] }> = [];
    const dependencies = createCampaignMessagingDependencies({
      openClawCommand: 'openclaw-test',
      openClawRun: async (command, args) => {
        calls.push({ command, args });
        if (args[0] === 'channels') {
          return {
            stdout: openClawStatus([
              { ...readyAccount('default'), connected: false },
              readyAccount('primary'),
            ]),
            stderr: '',
          };
        }
        const params = JSON.parse(args[args.indexOf('--params') + 1]);
        return { stdout: JSON.stringify({ runId: params.idempotencyKey, channel: 'whatsapp', messageId: 'openclaw-1' }), stderr: '' };
      },
      getWAHAReadiness: async () => {
        throw new Error('WAHA must not be selected');
      },
      sendWAHA: async () => {
        throw new Error('WAHA must not be selected');
      },
    });

    expect(await dependencies.preflight()).toEqual({ ready: true, error: undefined });
    expect(await dependencies.transport('8123 4567', 'hello', 'campaign:run-1')).toEqual({
      outcome: 'accepted',
      messageId: 'openclaw-1',
    });
    expect(calls).toEqual([
      { command: 'openclaw-test', args: ['channels', 'status', '--json'] },
      { command: 'openclaw-test', args: ['channels', 'status', '--json'] },
      {
        command: 'openclaw-test',
        args: [
          'gateway', 'call', 'send', '--params',
          '{"agentId":"customer-service","accountId":"primary","channel":"whatsapp","to":"+6581234567","message":"hello","idempotencyKey":"campaign:run-1"}',
          '--timeout', '50000', '--json',
        ],
      },
    ]);
  });

  test('a disconnected selected OpenClaw account blocks before message send even when another account is ready', async () => {
    const calls: string[][] = [];
    const adapter = createSelectedWhatsAppCampaignTransport({
      provider: 'openclaw',
      openClawAgentId: 'customer-service',
      openClawAccount: 'primary',
      openClawRun: async (_command, args) => {
        calls.push(args);
        return {
          stdout: openClawStatus([
            readyAccount('default'),
            { ...readyAccount('primary'), connected: false },
          ]),
          stderr: '',
        };
      },
    });

    const result = await adapter.transport('+6591051399', 'hello');

    expect(result.outcome).toBe('blocked');
    expect(result.outcome === 'blocked' ? result.error : '').toContain('primary');
    expect(calls).toEqual([['channels', 'status', '--json']]);
  });

  test('an invalid provider blocks readiness and send without selecting a fallback', async () => {
    const calls: string[] = [];
    const adapter = createSelectedWhatsAppCampaignTransport({
      provider: 'carrier-pigeon',
      getWAHAReadiness: async () => {
        calls.push('waha:readiness');
        return { online: true, ready: true };
      },
      sendWAHA: async () => {
        calls.push('waha:send');
        return { outcome: 'accepted', messageId: 'unexpected' };
      },
      openClawRun: async () => {
        calls.push('openclaw');
        return { stdout: openClawStatus([readyAccount('default')]), stderr: '' };
      },
    });

    const readiness = await adapter.preflight();
    const result = await adapter.transport('+6591051399', 'hello');

    expect(readiness.ready).toBe(false);
    expect(readiness.error).toContain('Unsupported SMARTPROP_WHATSAPP_PROVIDER');
    expect(result.outcome).toBe('blocked');
    expect(calls).toEqual([]);
  });

  test.each([
    ['missing message id', '{"success":true}'],
    ['blank message id', '{"messageId":"   "}'],
    ['numeric message id', '{"messageId":42}'],
    ['object message id', '{"messageId":{"id":"invalid"}}'],
    ['malformed success output', '{'],
  ])('classifies an OpenClaw %s as unknown after message send begins', async (_name, stdout) => {
    const adapter = openClawAdapter(async (_command, args) => args[0] === 'channels'
      ? { stdout: openClawStatus([readyAccount('primary')]), stderr: '' }
      : { stdout, stderr: '' });

    const result = await adapter.transport('+6591051399', 'hello');

    expect(result.outcome).toBe('unknown');
  });

  test('classifies an OpenClaw process timeout as unknown after message send begins', async () => {
    const adapter = openClawAdapter(async (_command, args) => {
      if (args[0] === 'channels') {
        return { stdout: openClawStatus([readyAccount('primary')]), stderr: '' };
      }
      throw new DOMException('timed out', 'AbortError');
    });

    const result = await adapter.transport('+6591051399', 'hello');

    expect(result.outcome).toBe('unknown');
  });
});

function openClawAdapter(
  openClawRun: NonNullable<SelectedTransportDependencies['openClawRun']>,
) {
  return createSelectedWhatsAppCampaignTransport({
    provider: 'openclaw',
    openClawAgentId: 'customer-service',
    openClawAccount: 'primary',
    openClawCommand: 'openclaw-test',
    openClawRun,
  });
}
