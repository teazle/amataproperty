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
    expect(buildOpenClawMessageArgs('+6581234567', 'Hello Chloe')).toEqual([
      'message',
      'send',
      '--channel',
      'whatsapp',
      '--target',
      '+6581234567',
      '--message',
      'Hello Chloe',
      '--json',
    ]);
  });

  test('reads a message id from documented JSON output', () => {
    expect(parseOpenClawMessageId('{"payload":{"result":{"messageId":"msg-123"}}}')).toBe('msg-123');
  });

  test('sends through an injectable runner without shell execution', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = await sendOpenClawWhatsAppMessage('81234567', 'Test delivery', {
      command: 'openclaw-test',
      run: async (command, args) => {
        calls.push({ command, args });
        return { stdout: '{"messageId":"message-456"}', stderr: '' };
      },
    });

    expect(result).toMatchObject({ success: true, messageId: 'message-456', messageText: 'Test delivery' });
    expect(calls).toEqual([
      {
        command: 'openclaw-test',
        args: buildOpenClawMessageArgs('+6581234567', 'Test delivery'),
      },
    ]);
  });
});
