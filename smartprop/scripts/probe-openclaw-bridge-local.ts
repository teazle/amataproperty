/** Isolated loopback acceptance: no provider, model, real CRM, or credentials. */
import { NextRequest } from 'next/server';
import { createCustomerBridge } from '../openclaw/customer-bridge/bridge';
import { createOpenClawWebhookHandler } from '../src/lib/wa/openclaw-webhook-handler';

const records = new Set<string>();
const optedOut = new Set<string>();
let modelCalls = 0;
let httpCalls = 0;
const secret = 'isolated-loopback-probe-not-a-production-secret';
const handler = createOpenClawWebhookHandler({
  secret: () => secret, provider: () => 'openclaw', account: () => 'default',
  webhookDependencies: {
    processInboundMessage: async () => { modelCalls++; throw new Error('STOP must not reach a model'); },
    recordOptOut: async input => { optedOut.add(input.recipient); },
    normalizePhone: value => value.replace('@s.whatsapp.net', ''),
    findLatestOutreach: async () => null,
    logMessage: async input => {
      const id = input.wahaMessageId!;
      const duplicate = records.has(id);
      records.add(id);
      return { duplicate };
    },
  },
});

const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async request => {
  httpCalls++;
  return handler(new NextRequest(request));
} });
try {
  const bridge = createCustomerBridge({ accountId: 'default', selfNumber: '+6583333333',
    operatorNumbers: ['+6591111111'], customerNumbers: ['+6592222222'],
    endpoint: `http://127.0.0.1:${server.port}/api/wa/openclaw`, secret });
  const message = { channel: 'whatsapp', senderId: '+6592222222', messageId: 'local-stop-1',
    content: 'STOP', isGroup: false, timestamp: Math.floor(Date.now() / 1000) };
  const context = { channelId: 'whatsapp', accountId: 'default', senderId: message.senderId, messageId: message.messageId };
  const first = await bridge(message, context);
  const duplicate = await bridge(message, context);
  const operator = await bridge({ ...message, senderId: '+6591111111' }, { ...context, senderId: '+6591111111' });
  const passed = first?.handled === true && duplicate?.handled === true && operator === undefined &&
    httpCalls === 2 && modelCalls === 0 && records.size === 1 && optedOut.size === 1 &&
    records.has('openclaw:default:local-stop-1');
  console.log(JSON.stringify({ kind: 'isolated-openclaw-http-bridge', passed, httpCalls, modelCalls,
    uniqueRecords: records.size, optOuts: optedOut.size, realWhatsApp: false, realDatabase: false }));
  if (!passed) process.exitCode = 1;
} finally {
  await server.stop(true);
}
