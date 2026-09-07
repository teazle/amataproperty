import { describe, expect, test } from 'bun:test';

import { sendValuationCampaignReply } from '../src/lib/newsletter/valuation-campaign-relay';
import type { CustomerTextInput, CustomerTextTransport } from '../src/lib/wa/customer-transport';

function transport(
  sendText: (input: CustomerTextInput) => ReturnType<CustomerTextTransport['sendText']>,
): CustomerTextTransport {
  return { sendText };
}

describe('valuation campaign customer transport seam', () => {
  test('accepts one acknowledged valuation reply and retains its provider message id', async () => {
    const calls: CustomerTextInput[] = [];
    const result = await sendValuationCampaignReply(
      '91051399@c.us',
      'Thanks Yeo. What day and time would suit a quick call?',
      {
        customerTransport: transport(async (input) => {
          calls.push(input);
          return {
            outcome: 'accepted',
            provider: 'openclaw',
            messageId: 'valuation-message-1',
            messageText: input.text,
          };
        }),
      },
    );

    expect(calls).toEqual([{
      to: '91051399@c.us',
      text: 'Thanks Yeo. What day and time would suit a quick call?',
      purpose: 'valuation_reply',
    }]);
    expect(result).toEqual({
      outcome: 'accepted',
      provider: 'openclaw',
      messageId: 'valuation-message-1',
      messageText: 'Thanks Yeo. What day and time would suit a quick call?',
    });
  });

  test('keeps an unknown provider result unknown without retrying or claiming it sent', async () => {
    let attempts = 0;
    const result = await sendValuationCampaignReply(
      '+6591051399',
      'I will pass this timing to Jeremy and he will confirm with you.',
      {
        customerTransport: transport(async () => {
          attempts += 1;
          return {
            outcome: 'unknown',
            provider: 'waha',
            error: 'provider send timed out',
          };
        }),
      },
    );

    expect(attempts).toBe(1);
    expect(result).toEqual({
      outcome: 'unknown',
      provider: 'waha',
      error: 'provider send timed out',
    });
  });

  test('turns an acknowledged result without a provider id into manual reconciliation', async () => {
    const result = await sendValuationCampaignReply(
      '91051399',
      'Reply received.',
      {
        customerTransport: transport(async () => ({
          outcome: 'accepted',
          provider: 'openclaw',
          messageId: '   ',
          messageText: 'Reply received.',
        })),
      },
    );

    expect(result).toEqual({
      outcome: 'unknown',
      provider: 'openclaw',
      error: 'Customer transport accepted a valuation reply without a message id',
    });
  });

  test('turns a thrown transport failure into one explicit unknown outcome', async () => {
    let attempts = 0;
    const result = await sendValuationCampaignReply(
      '91051399',
      'Reply received.',
      {
        customerTransport: transport(async () => {
          attempts += 1;
          throw new DOMException('timed out', 'AbortError');
        }),
      },
    );

    expect(attempts).toBe(1);
    expect(result).toEqual({
      outcome: 'unknown',
      provider: 'unknown',
      error: 'timed out',
    });
  });
});
