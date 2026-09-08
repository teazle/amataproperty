import { describe, expect, test } from 'bun:test';
import { sendViaOpenClaw } from './smartprop-daily-report';

describe('daily report owned delivery', () => {
  test('sends the exact report via the explicit owner and accepts only its matching gateway receipt', () => {
    const calls: string[][] = [];
    const receipts = sendViaOpenClaw('Daily report: 7 listings', ['+6500002002'], false, (command, args) => {
      expect(command).toBe('openclaw');
      expect(args.slice(0, 3)).toEqual(['gateway', 'call', 'send']);
      calls.push(args);
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params).toMatchObject({ agentId: 'main', accountId: 'default', channel: 'whatsapp', to: '+6500002002', message: 'Daily report: 7 listings' });
      expect(params.idempotencyKey).toMatch(/^smartprop-report:[a-f0-9]{64}$/);
      return JSON.stringify({ runId: params.idempotencyKey, channel: 'whatsapp', messageId: 'provider-report-1' });
    });
    expect(calls).toHaveLength(1);
    expect(receipts).toEqual([{ target: '+6500002002', messageId: 'provider-report-1' }]);
  });

  test('reuses a key for identical recipient/content but not a different report or recipient', () => {
    const keys: string[] = [];
    const run = (_: string, args: string[]) => {
      const p = JSON.parse(args[args.indexOf('--params') + 1]);
      keys.push(p.idempotencyKey);
      return JSON.stringify({ runId: p.idempotencyKey, channel: 'whatsapp', messageId: 'provider-id' });
    };
    sendViaOpenClaw('report one', ['+6500002002'], false, run);
    sendViaOpenClaw('report one', ['+6500002002'], false, run);
    sendViaOpenClaw('report two', ['+6500002002'], false, run);
    sendViaOpenClaw('report one', ['+6500003003'], false, run);
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(3);
  });

  test('dry-run makes no provider call', () => {
    expect(sendViaOpenClaw('report', ['+6500002002'], true, () => { throw Error('must not send'); })).toEqual([]);
  });

  test('missing recipients fail before any provider call', () => {
    expect(() => sendViaOpenClaw('report', [], false, () => { throw Error('must not send'); })).toThrow('must be set');
  });

  test('unconfirmed or mismatched results fail without retry or sending to the next recipient', () => {
    for (const result of [null, '', 'not json', '{}', '{"messageId":"x"}', '{"runId":"wrong","messageId":"x","channel":"whatsapp"}']) {
      let calls = 0;
      expect(() => sendViaOpenClaw('report', ['+6500002002', '+6500003003'], false, () => { calls++; return result; })).toThrow();
      expect(calls).toBe(1);
    }
  });
});
