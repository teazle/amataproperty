import { expect, test } from 'bun:test';
import { sendWhatsAppMessage, sendCampaignWhatsApp, sendMessageWithTyping, sendPresence } from '../src/lib/wa/waha';

test('direct legacy WAHA callers cannot send or signal presence when OpenClaw is selected', async () => {
  const previousProvider = process.env.SMARTPROP_WHATSAPP_PROVIDER;
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    process.env.SMARTPROP_WHATSAPP_PROVIDER = 'openclaw';
    globalThis.fetch = (async () => {
      requests++;
      return Response.json({ status: 'WORKING', id: 'fake-provider-id' });
    }) as typeof fetch;
    expect(await sendWhatsAppMessage('6592222222', 'test')).toMatchObject({ success: false });
    expect(await sendCampaignWhatsApp('6592222222', 'test')).toMatchObject({ outcome: 'blocked' });
    expect(await sendPresence('6592222222', 'composing')).toMatchObject({ success: false });
    expect(await sendMessageWithTyping('6592222222', 'test', 0)).toMatchObject({ success: false });
    expect(requests).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousProvider === undefined) delete process.env.SMARTPROP_WHATSAPP_PROVIDER;
    else process.env.SMARTPROP_WHATSAPP_PROVIDER = previousProvider;
  }
});
