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

const neverSuppressed = async () => false;

describe('customer text transport', () => {
  test('blocks a persisted STOP suppression before provider readiness or submission', async () => {
    const providerCalls: string[][] = [];
    const suppressionCalls: string[] = [];
    const adapter = createCustomerTextTransport({
      provider: 'openclaw',
      openClawAgentId: 'customer-service',
      openClawAccount: 'default',
      isCustomerSuppressed: async (recipient: string) => {
        suppressionCalls.push(recipient);
        return true;
      },
      openClawRun: async (_command, args) => {
        providerCalls.push(args);
        throw new Error('provider must not run for a STOP-suppressed recipient');
      },
    });

    const result = await adapter.sendText({
      to: '9105 1399@c.us', text: 'Viewing requested', purpose: 'viewing_request',
    });

    expect(result).toMatchObject({ outcome: 'blocked', provider: 'openclaw' });
    expect(suppressionCalls).toEqual(['+6591051399']);
    expect(providerCalls).toEqual([]);
  });

  test('checks an unsuppressed recipient before accepting the selected provider receipt', async () => {
    const suppressionCalls: string[] = [];
    const adapter = createCustomerTextTransport({
      provider: 'openclaw',
      openClawAgentId: 'customer-service',
      openClawAccount: 'default',
      isCustomerSuppressed: async (recipient: string) => {
        suppressionCalls.push(recipient);
        return false;
      },
      openClawRun: async (_command, args) => {
        if (args[0] === 'channels') return { stdout: openClawStatus(readyDefaultAccount()), stderr: '' };
        return { stdout: '{"runId":"customer:reply-1","channel":"whatsapp","messageId":"openclaw-reply-1"}', stderr: '' };
      },
    });

    const result = await adapter.sendText({
      to: '91051399', text: 'Reply received', purpose: 'auto_reply', idempotencyKey: 'customer:reply-1',
    });

    expect(result).toMatchObject({ outcome: 'accepted', messageId: 'openclaw-reply-1' });
    expect(suppressionCalls).toEqual(['+6591051399']);
  });

  test('fails closed when persisted STOP suppression lookup fails', async () => {
    const providerCalls: string[][] = [];
    const adapter = createCustomerTextTransport({
      provider: 'openclaw',
      openClawAgentId: 'customer-service',
      openClawAccount: 'default',
      isCustomerSuppressed: async () => { throw new Error('suppression database unavailable'); },
      openClawRun: async (_command, args) => {
        providerCalls.push(args);
        throw new Error('provider must not run after failed suppression lookup');
      },
    });

    const result = await adapter.sendText({
      to: '91051399', text: 'Reply received', purpose: 'auto_reply',
    });

    expect(result).toMatchObject({ outcome: 'blocked', provider: 'openclaw' });
    expect(result.outcome === 'blocked' ? result.error : '').toContain('suppression database unavailable');
    expect(providerCalls).toEqual([]);
  });

  test('normalizes an individual Singapore WhatsApp recipient once and preserves transactional STOP text', async () => {
    const calls: string[][] = [];
    const adapter = createCustomerTextTransport({
      provider: 'openclaw',
      openClawCommand: 'openclaw-test',
      openClawAgentId: 'customer-service',
      openClawAccount: 'customer-default',
      isCustomerSuppressed: neverSuppressed,
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
      isCustomerSuppressed: neverSuppressed,
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
      isCustomerSuppressed: neverSuppressed,
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
      isCustomerSuppressed: neverSuppressed,
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
      isCustomerSuppressed: neverSuppressed,
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
