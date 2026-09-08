import { describe, expect, test } from 'bun:test';
import {
  buildOpenClawMessageArgs,
  normalizeOpenClawWhatsAppTarget,
  parseOpenClawMessageId,
  sendOpenClawWhatsAppMessage,
} from '../src/lib/wa/openclaw';

describe('OpenClaw WhatsApp adapter', () => {
  test('normalizes Singapore WhatsApp targets to E.164', () => {
    expect(normalizeOpenClawWhatsAppTarget('8123 4567')).toBe('+6581234567');
    expect(normalizeOpenClawWhatsAppTarget('+65 8123 4567')).toBe('+6581234567');
  });

  test('builds the channel-scoped OpenClaw send command', () => {
    expect(buildOpenClawMessageArgs('+6581234567', 'Hello Chloe', {
      agentId: 'main', accountId: 'default', idempotencyKey: 'customer:claim-1',
    })).toEqual([
      'gateway', 'call', 'send', '--params',
      '{"agentId":"main","accountId":"default","channel":"whatsapp","to":"+6581234567","message":"Hello Chloe","idempotencyKey":"customer:claim-1"}',
      '--timeout', '50000', '--json',
    ]);
  });

  test('reads a message id from documented JSON output', () => {
    expect(parseOpenClawMessageId('{"payload":{"result":{"messageId":"msg-123"}}}')).toBe('msg-123');
  });

  test('uses the configured owner and only accepts a matching gateway receipt', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = await sendOpenClawWhatsAppMessage('81234567', 'Test delivery', {
      command: 'openclaw-test',
      agentId: 'main',
      accountId: 'default',
      idempotencyKey: 'customer:claim-1',
      run: async (command, args) => {
        calls.push({ command, args });
        return { stdout: '{"runId":"customer:claim-1","channel":"whatsapp","messageId":"message-456"}', stderr: '' };
      },
    });

    expect(result).toMatchObject({ success: true, messageId: 'message-456', messageText: 'Test delivery' });
    expect(calls).toEqual([
      {
        command: 'openclaw-test',
        args: [
          'gateway', 'call', 'send', '--params',
          '{"agentId":"main","accountId":"default","channel":"whatsapp","to":"+6581234567","message":"Test delivery","idempotencyKey":"customer:claim-1"}',
          '--timeout', '50000', '--json',
        ],
      },
    ]);
  });

  test.each([
    ['missing receipt', '{"messageId":"message-456"}'],
    ['wrong run', '{"runId":"other","channel":"whatsapp","messageId":"message-456"}'],
    ['wrong channel', '{"runId":"customer:claim-1","channel":"telegram","messageId":"message-456"}'],
  ])('classifies a %s as unknown and does not retry', async (_name, stdout) => {
    let calls = 0;
    const result = await sendOpenClawWhatsAppMessage('81234567', 'Test delivery', {
      agentId: 'main', accountId: 'default', idempotencyKey: 'customer:claim-1',
      run: async () => {
        calls += 1;
        return { stdout, stderr: '' };
      },
    });

    expect(result).toMatchObject({ success: false });
    expect(calls).toBe(1);
  });
});
