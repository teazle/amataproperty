import { describe, expect, test } from 'bun:test';

import {
  isNewsletterOptOutKeyword,
  normalizeNewsletterOptOutRecipient,
  recordNewsletterOptOut,
} from '../src/lib/newsletter/whatsapp-opt-out';

function recordingClient(result: { error: { message: string } | null } = { error: null }) {
  const calls: Array<{ name: string; args: Record<string, string> }> = [];
  return {
    calls,
    client: {
      async rpc(name: string, args: Record<string, string>) {
        calls.push({ name, args });
        return { data: null, error: result.error };
      },
    },
  };
}

describe('newsletter WhatsApp opt-out helper', () => {
  test('accepts only the five trimmed and case-normalized STOP keywords', () => {
    for (const keyword of ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'OPTOUT', 'OPT OUT']) {
      expect(isNewsletterOptOutKeyword(`  ${keyword.toLowerCase()}  `)).toBe(true);
    }

    expect(isNewsletterOptOutKeyword('please stop')).toBe(false);
    expect(isNewsletterOptOutKeyword('stop now')).toBe(false);
    expect(isNewsletterOptOutKeyword('')).toBe(false);
  });

  test('normalizes WAHA recipient IDs to canonical E.164', () => {
    expect(normalizeNewsletterOptOutRecipient('6591051399@c.us')).toBe('+6591051399');
    expect(normalizeNewsletterOptOutRecipient('6591051399@s.whatsapp.net')).toBe('+6591051399');
  });

  test('delegates STOP handling to exactly one atomic RPC', async () => {
    const recording = recordingClient();

    await recordNewsletterOptOut({
      recipient: '6591051399@c.us',
      messageId: 'waha-stop-1',
      client: recording.client,
    });

    expect(recording.calls).toEqual([{
      name: 'record_newsletter_opt_out',
      args: {
        p_recipient: '+6591051399',
        p_message_id: 'waha-stop-1',
        p_reason: 'whatsapp_stop',
      },
    }]);
  });

  test('rejects a STOP without a provider message ID before any RPC', async () => {
    const recording = recordingClient();

    await expect(recordNewsletterOptOut({
      recipient: '6591051399@c.us',
      messageId: null,
      client: recording.client,
    })).rejects.toThrow('provider message id is required');

    expect(recording.calls).toEqual([]);
  });

  test('surfaces database failures for webhook retry', async () => {
    const recording = recordingClient({ error: { message: 'temporary database failure' } });

    await expect(recordNewsletterOptOut({
      recipient: '6591051399@c.us',
      messageId: 'waha-stop-2',
      client: recording.client,
    })).rejects.toThrow('record newsletter opt-out: temporary database failure');
  });
});
