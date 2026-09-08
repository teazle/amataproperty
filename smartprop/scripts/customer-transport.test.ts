import { describe, expect, test } from 'bun:test';

import { createCustomerTextTransport } from '../src/lib/wa/customer-transport';

function openClawStatus(account: Record<string, unknown>): string {
  return JSON.stringify({ channelAccounts: { whatsapp: [account] } });
}

function readyDefaultAccount(): Record<string, unknown> {
  return {
    accountId: 'default',
    enabled: true,
    configured: true,
    running: true,
    connected: true,
    healthState: 'healthy',
    terminalDisconnect: false,
  };
}

describe('customer text transport', () => {
  test('normalizes an individual Singapore WhatsApp recipient once and preserves transactional STOP text', async () => {
    const calls: string[][] = [];
    const adapter = createCustomerTextTransport({
      provider: 'openclaw',
      openClawCommand: 'openclaw-test',
      openClawAgentId: 'customer-service',
      openClawAccount: 'customer-default',
      openClawRun: async (_command, args) => {
        calls.push(args);
        if (args[0] === 'channels') return { stdout: openClawStatus({ ...readyDefaultAccount(), accountId: 'customer-default' }), stderr: '' };
        return { stdout: '{"runId":"customer:signing-1","channel":"whatsapp","messageId":"openclaw-customer-1"}', stderr: '' };
      },
    });

    const result = await adapter.sendText({
      to: '8123 4567@s.whatsapp.net',
      text: 'STOP is part of this signed confirmation.',
      purpose: 'signing_confirmation',
      idempotencyKey: 'customer:signing-1',
    });

    expect(result).toEqual({
      outcome: 'accepted',
      provider: 'openclaw',
      messageId: 'openclaw-customer-1',
      messageText: 'STOP is part of this signed confirmation.',
    });
    const sendArgs = calls.find((args) => args[0] === 'gateway')!;
    const sendParams = JSON.parse(sendArgs[sendArgs.indexOf('--params') + 1]);
    expect(sendArgs).toEqual([
      'gateway', 'call', 'send', '--params', JSON.stringify({
        agentId: 'customer-service', accountId: 'customer-default', channel: 'whatsapp',
        to: '+6581234567', message: 'STOP is part of this signed confirmation.', idempotencyKey: 'customer:signing-1',
      }), '--timeout', '50000', '--json',
    ]);
    expect(sendParams).toEqual({
      agentId: 'customer-service', accountId: 'customer-default', channel: 'whatsapp',
      to: '+6581234567', message: 'STOP is part of this signed confirmation.', idempotencyKey: 'customer:signing-1',
    });
  });

  test('blocks configured OpenClaw customer sending when no customer agent is configured', async () => {
    const calls: string[][] = [];
    const adapter = createCustomerTextTransport({
      provider: 'openclaw',
      openClawAccount: 'customer-default',
      openClawRun: async (_command, args) => {
        calls.push(args);
        return { stdout: openClawStatus(readyDefaultAccount()), stderr: '' };
      },
    });

    const result = await adapter.sendText({
      to: '81234567', text: 'Hello', purpose: 'api_text', idempotencyKey: 'customer:api-1',
    });

    expect(result).toMatchObject({ outcome: 'blocked', provider: 'openclaw' });
    expect(result.error).toContain('AGENT');
    expect(calls).toEqual([]);
  });

  test('rejects group, LID, malformed recipient, blank text, and unsupported purpose before readiness or send', async () => {
    const calls: string[][] = [];
    const adapter = createCustomerTextTransport({
      provider: 'openclaw',
      openClawAgentId: 'customer-service',
      openClawAccount: 'default',
      openClawRun: async (_command, args) => {
        calls.push(args);
        return { stdout: openClawStatus(readyDefaultAccount()), stderr: '' };
      },
    });

    for (const input of [
      { to: '1203630-123456@g.us', text: 'hello', purpose: 'manual_outreach' },
      { to: '123456789@lid', text: 'hello', purpose: 'manual_outreach' },
      { to: 'customer id 81234567', text: 'hello', purpose: 'manual_outreach' },
      { to: '81234567', text: '   ', purpose: 'manual_outreach' },
      { to: '81234567', text: 'hello', purpose: 'marketing' },
    ]) {
      const result = await adapter.sendText(input as never);
      expect(result.outcome).toBe('rejected');
    }
    expect(calls).toEqual([]);
  });

  test('blocks when the selected OpenClaw account is not ready and never starts a send', async () => {
    const calls: string[][] = [];
    const adapter = createCustomerTextTransport({
      provider: 'openclaw',
      openClawAgentId: 'customer-service',
      openClawAccount: 'default',
      openClawRun: async (_command, args) => {
        calls.push(args);
        return { stdout: openClawStatus({ ...readyDefaultAccount(), connected: false }), stderr: '' };
      },
    });

    const result = await adapter.sendText({ to: '91051399@c.us', text: 'Viewing requested', purpose: 'viewing_request' });

    expect(result.outcome).toBe('blocked');
    expect(result.provider).toBe('openclaw');
    expect(calls).toEqual([['channels', 'status', '--json']]);
  });

  test.each([
    ['missing provider message id', '{"success":true}'],
    ['timeout after provider send begins', null],
  ])('never accepts an OpenClaw %s', async (_name, sendOutput) => {
    const adapter = createCustomerTextTransport({
      provider: 'openclaw',
      openClawAgentId: 'customer-service',
      openClawAccount: 'default',
      openClawRun: async (_command, args) => {
        if (args[0] === 'channels') return { stdout: openClawStatus(readyDefaultAccount()), stderr: '' };
        if (sendOutput === null) throw new DOMException('timed out', 'AbortError');
        return { stdout: sendOutput, stderr: '' };
      },
    });

    const result = await adapter.sendText({ to: '6591051399', text: 'Reply received', purpose: 'auto_reply' });

    expect(result).toMatchObject({ outcome: 'unknown', provider: 'openclaw' });
  });

  test('fails closed for an unsupported provider without falling back to WAHA', async () => {
    const calls: string[] = [];
    const adapter = createCustomerTextTransport({
      provider: 'carrier-pigeon',
      getWAHAReadiness: async () => {
        calls.push('waha:readiness');
        return { online: true, ready: true };
      },
      sendWAHA: async () => {
        calls.push('waha:send');
        return { outcome: 'accepted', messageId: 'must-not-send' };
      },
    });

    const result = await adapter.sendText({ to: '81234567', text: 'Hello', purpose: 'api_text' });

    expect(result.outcome).toBe('blocked');
    expect(result.provider).toBe('unknown');
    expect(calls).toEqual([]);
  });
});
