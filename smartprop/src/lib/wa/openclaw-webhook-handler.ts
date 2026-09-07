import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { createWebhookHandler, type WebhookDependencies } from './webhook-handler';

const MAX_AGE_SECONDS = 300;

type OpenClawWebhookPayload = {
  version: 1;
  accountId: string;
  from: string;
  to?: string;
  body: string;
  messageId: string;
  timestamp: string | number;
  fromMe?: unknown;
};

export type OpenClawWebhookDependencies = {
  nowSeconds: () => number;
  secret: () => string | undefined;
  provider: () => string | undefined;
  account: () => string;
  webhookDependencies: Partial<WebhookDependencies>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function selectedAccount(value: string | undefined): string {
  return value?.trim() || 'default';
}

function selectedProvider(value: string | undefined): string {
  return value?.trim().toLowerCase() || 'waha';
}

function secureHexEquals(provided: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;
  const left = Buffer.from(provided, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function validTimestamp(value: string | null, nowSeconds: number): boolean {
  if (!value || !/^\d+$/.test(value)) return false;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && Math.abs(nowSeconds - timestamp) <= MAX_AGE_SECONDS;
}

function canonicalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /@(g\.us|lid)$/i.test(trimmed)) return null;

  const jid = trimmed.match(/^(\d+)@(s\.whatsapp\.net|c\.us)$/i);
  const digits = jid ? jid[1] : trimmed;
  const singaporeNumber = digits.match(/^(?:\+?65)?([689]\d{7})$/);
  return singaporeNumber ? `65${singaporeNumber[1]}@s.whatsapp.net` : null;
}

function parsePayload(rawBody: string, expectedAccount: string): {
  message: OpenClawWebhookPayload;
  from: string;
  to?: string;
  providerMessageId: string;
} | null {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const record = asRecord(value);
  if (!record || record.version !== 1 || record.fromMe === true ||
    typeof record.accountId !== 'string' || record.accountId.trim() !== expectedAccount ||
    typeof record.from !== 'string' || typeof record.body !== 'string' || !record.body.trim() ||
    typeof record.messageId !== 'string' || !record.messageId.trim() ||
    (typeof record.timestamp !== 'string' && typeof record.timestamp !== 'number') ||
    (record.to !== undefined && typeof record.to !== 'string')) {
    return null;
  }

  const from = canonicalizeAddress(record.from);
  const to = record.to === undefined ? undefined : canonicalizeAddress(record.to);
  if (!from || (record.to !== undefined && !to)) return null;

  return {
    message: record as OpenClawWebhookPayload,
    from,
    to: to || undefined,
    providerMessageId: `openclaw:${expectedAccount}:${record.messageId.trim()}`,
  };
}

function accountMatches(rawBody: string, expectedAccount: string): boolean {
  try {
    const record = asRecord(JSON.parse(rawBody));
    return typeof record?.accountId === 'string' && record.accountId.trim() === expectedAccount;
  } catch {
    return false;
  }
}

export function createOpenClawWebhookHandler(overrides: Partial<OpenClawWebhookDependencies> = {}) {
  const nowSeconds = overrides.nowSeconds || (() => Math.floor(Date.now() / 1_000));
  const secret = overrides.secret || (() => process.env.SMARTPROP_OPENCLAW_WEBHOOK_SECRET);
  const provider = overrides.provider || (() => process.env.SMARTPROP_WHATSAPP_PROVIDER);
  const account = overrides.account || (() => selectedAccount(process.env.SMARTPROP_OPENCLAW_WHATSAPP_ACCOUNT));

  return async function POST(request: NextRequest) {
    if (selectedProvider(provider()) !== 'openclaw') {
      return NextResponse.json({ error: 'OpenClaw ingress is disabled' }, { status: 503 });
    }

    const configuredSecret = secret();
    if (!configuredSecret) {
      return NextResponse.json({ error: 'OpenClaw webhook secret is not configured' }, { status: 503 });
    }

    const timestampHeader = request.headers.get('X-Smartprop-Timestamp');
    if (!validTimestamp(timestampHeader, nowSeconds())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.text();
    const expectedSignature = createHmac('sha256', configuredSecret)
      .update(`${timestampHeader}.${rawBody}`)
      .digest('hex');
    if (!secureHexEquals(request.headers.get('X-Smartprop-Signature') || '', expectedSignature)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const expectedAccount = selectedAccount(account());
    if (!accountMatches(rawBody, expectedAccount)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const parsed = parsePayload(rawBody, expectedAccount);
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid OpenClaw webhook payload' }, { status: 400 });
    }

    const delegate = createWebhookHandler({
      ...overrides.webhookDependencies,
      trustedIngressProvider: 'openclaw',
      authorizeRequest: () => null,
    });
    return delegate(new NextRequest(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: parsed.from,
        to: parsed.to,
        body: parsed.message.body,
        id: { _serialized: parsed.providerMessageId },
        timestamp: parsed.message.timestamp,
        fromMe: false,
        openclaw: {
          version: parsed.message.version,
          accountId: parsed.message.accountId,
          messageId: parsed.message.messageId,
        },
      }),
    }));
  };
}
