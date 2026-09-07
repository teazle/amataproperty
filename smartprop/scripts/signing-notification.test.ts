import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { sendTemplate } from '../src/lib/wa/send';
import type { CustomerTextInput, CustomerTextTransport } from '../src/lib/wa/customer-transport';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'legacy-template-message' }), { status: 200 });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function customerTransport(
  sendText: (input: CustomerTextInput) => ReturnType<CustomerTextTransport['sendText']>,
): CustomerTextTransport {
  return { sendText };
}

describe('signing notification transport seam', () => {
  test('sends the one approved agreement notification as literal plain text through customer transport', async () => {
    const calls: CustomerTextInput[] = [];
    const transport = customerTransport(async (input) => {
      calls.push(input);
      return {
        outcome: 'accepted',
        provider: 'openclaw',
        messageId: 'signing-message-1',
        messageText: input.text,
      };
    });
    const result = await sendTemplate(
      '91051399@c.us',
      'agreement_received',
      ['Co-broking Agreement', 'https://listings.example.invalid/one'],
      { customerTransport: transport },
    );

    expect(calls).toEqual([{
      to: '91051399@c.us',
      text: 'We have received your Co-broking Agreement. Property: https://listings.example.invalid/one',
      purpose: 'signing_confirmation',
    }]);
    expect(result).toEqual({
      success: true,
      messageId: 'signing-message-1',
      outcome: 'accepted',
      provider: 'openclaw',
    });
  });

  test('preserves an ambiguous customer transport outcome as explicit failure without a fake message id', async () => {
    const transport = customerTransport(async () => ({
      outcome: 'unknown',
      provider: 'openclaw',
      error: 'provider response timed out',
    }));

    const result = await sendTemplate(
      '91051399',
      'agreement_received',
      ['Co-broking Agreement', 'https://listings.example.invalid/one'],
      { customerTransport: transport },
    );

    expect(result).toEqual({
      success: false,
      outcome: 'unknown',
      provider: 'openclaw',
      error: 'provider response timed out',
    });
  });

  test.each([
    ['different template', 'agreement_approved', ['Co-broking Agreement', 'https://listings.example.invalid/one']],
    ['wrong fixed parameter', 'agreement_received', ['Agreement', 'https://listings.example.invalid/one']],
    ['non-HTTPS listing URL', 'agreement_received', ['Co-broking Agreement', 'http://listings.example.invalid/one']],
    ['missing second parameter', 'agreement_received', ['Co-broking Agreement']],
  ])('blocks %s without invoking customer transport', async (_name, templateName, parameters) => {
    const calls: CustomerTextInput[] = [];
    const transport = customerTransport(async (input) => {
      calls.push(input);
      return {
        outcome: 'accepted',
        provider: 'waha',
        messageId: 'must-not-send',
        messageText: input.text,
      };
    });

    const result = await sendTemplate('91051399', templateName, parameters, { customerTransport: transport });

    expect(result).toMatchObject({ success: false, outcome: 'blocked', provider: 'unknown' });
    expect(calls).toEqual([]);
  });
});
