import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isNewsletterOptOutKeyword, recordNewsletterOptOut, type NewsletterOptOutClient, type RecordNewsletterOptOutInput } from '@/lib/newsletter/whatsapp-opt-out';

function secureEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function webhookAuthorizationStatus(request: NextRequest): 401 | 503 | null {
  const expected = process.env.WAHA_WEBHOOK_SECRET;
  if (!expected) return process.env.NODE_ENV === 'production' ? 503 : null;

  const provided = request.headers.get('X-WAHA-Webhook-Secret') || '';

  return secureEquals(provided, expected) ? null : 401;
}

type WahaWebhookBody = Record<string, unknown> & {
  payload?: Record<string, unknown>;
  event?: string;
  session?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalStringOrNumber(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value;
  return null;
}

function extractMessage(body: unknown) {
  const bodyRecord = asRecord(body) as WahaWebhookBody;
  const payload = asRecord(bodyRecord.payload || bodyRecord);
  if (!payload?.body || !payload?.from) {
    return null;
  }

  const id = asRecord(payload.id);
  return {
    from: payload.from as string,
    to: optionalString(payload.to),
    body: payload.body as string,
    id: optionalString(id._serialized) || optionalString(payload.id) || optionalString(payload.messageId) || null,
    timestamp: optionalStringOrNumber(payload.timestamp),
    fromMe: payload.fromMe === true,
    rawPayload: payload,
  };
}

function summarize(body: unknown) {
  const bodyRecord = asRecord(body) as WahaWebhookBody;
  const payload = asRecord(bodyRecord.payload || bodyRecord);
  const id = asRecord(payload.id);
  return {
    event: bodyRecord.event || 'direct',
    session: bodyRecord.session,
    from: payload?.from,
    to: payload?.to,
    fromMe: payload?.fromMe,
    messageId: id._serialized || payload?.id || payload?.messageId,
    messageLength: typeof payload?.body === 'string' ? payload.body.length : 0,
  };
}

type UnknownSendQuery = {
  select(columns: string): UnknownSendQuery;
  eq(column: string, value: string): UnknownSendQuery;
  limit(value: number): PromiseLike<{
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  }>;
};

type WebhookSupabaseClient = NewsletterOptOutClient & {
  from(table: 'newsletter_sends'): UnknownSendQuery;
};

type WebhookDependencies = {
  processInboundMessage: (input: {
    from: string;
    to?: string;
    body: string;
    messageId: string | null;
    timestamp: string | number | null;
    rawPayload: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  logMessage: (input: {
    outreachId?: string | null;
    agentId?: string | null;
    direction: 'inbound' | 'outbound';
    phone: string;
    chatId?: string | null;
    wahaMessageId?: string | null;
    body: string;
    rawPayload?: unknown;
    occurredAt?: string;
  }) => Promise<{ duplicate: boolean }>;
  findLatestOutreach: (phone: string) => Promise<{ id: string; agent_id: string | null } | null>;
  normalizePhone: (phone: string) => string;
  getSupabaseClient: () => WebhookSupabaseClient;
  recordOptOut: (input: Omit<RecordNewsletterOptOutInput, 'client'>) => Promise<void>;
};

async function resolveMessageLogDependencies(overrides: Partial<WebhookDependencies>) {
  const messageLog = overrides.normalizePhone && overrides.findLatestOutreach && overrides.logMessage
    ? null
    : await import('@/lib/wa/message-log');

  return {
    normalizePhone: overrides.normalizePhone || messageLog!.normalizeWhatsAppPhone,
    findLatestOutreach: overrides.findLatestOutreach || messageLog!.findLatestOutreachByPhone,
    logMessage: overrides.logMessage || messageLog!.logWhatsAppMessage,
  };
}

async function reconcileUnknownOutboundMessage(
  providerMessageId: string | null,
  client: WebhookSupabaseClient,
): Promise<void> {
  const normalizedMessageId = providerMessageId?.trim();
  if (!normalizedMessageId) {
    console.warn('[WAHA Webhook] Outbound event has no provider message ID; unknown reconciliation skipped.');
    return;
  }

  const { data, error } = await client
    .from('newsletter_sends')
    .select('id')
    .eq('waha_message_id', normalizedMessageId)
    .eq('status', 'unknown')
    .limit(2);
  if (error) throw new Error(`load outbound newsletter unknown: ${error.message}`);

  if (data?.length !== 1) {
    console.warn(`[WAHA Webhook] Outbound unknown reconciliation skipped; matched ${data?.length || 0} attempts.`);
    return;
  }

  const { error: resolutionError } = await client.rpc('resolve_newsletter_unknown', {
    p_send_id: data[0].id,
    p_resolver: 'waha-webhook',
    p_resolution: 'sent',
    p_reason: 'matched outbound WAHA webhook provider message id',
  });
  if (resolutionError) throw new Error(`resolve outbound newsletter unknown: ${resolutionError.message}`);
}

export function createWebhookHandler(overrides: Partial<WebhookDependencies> = {}) {
  return async function POST(request: NextRequest) {
    try {
      const authorizationStatus = webhookAuthorizationStatus(request);
      if (authorizationStatus) {
        return NextResponse.json(
          { error: authorizationStatus === 503 ? 'WAHA webhook secret is not configured' : 'Unauthorized' },
          { status: authorizationStatus },
        );
      }

      const body = await request.json();
      console.log('[WAHA Webhook] Received:', summarize(body));

      const message = extractMessage(body);
      if (!message) {
        return NextResponse.json({ success: true, ignored: true, reason: 'No message payload' });
      }

      if (message.fromMe) {
        const messageLog = await resolveMessageLogDependencies(overrides);
        const phone = messageLog.normalizePhone(message.to || message.from);
        const outreach = await messageLog.findLatestOutreach(phone);
        const logged = await messageLog.logMessage({
          outreachId: outreach?.id || null,
          agentId: outreach?.agent_id || null,
          direction: 'outbound',
          phone,
          chatId: message.to || message.from,
          wahaMessageId: message.id,
          body: message.body,
          rawPayload: message.rawPayload,
          occurredAt: message.timestamp
            ? new Date(typeof message.timestamp === 'number' ? message.timestamp * 1000 : message.timestamp).toISOString()
            : new Date().toISOString(),
        });
        const getClient = overrides.getSupabaseClient || (await import('@/workers/supa')).getSupabaseClient;
        await reconcileUnknownOutboundMessage(message.id, getClient() as WebhookSupabaseClient);

        return NextResponse.json({
          success: true,
          fromMe: true,
          duplicate: logged.duplicate,
          outreachId: outreach?.id || null,
        });
      }

      if (isNewsletterOptOutKeyword(message.body)) {
        if (overrides.recordOptOut) {
          await overrides.recordOptOut({ recipient: message.from, messageId: message.id });
        } else {
          const getClient = overrides.getSupabaseClient || (await import('@/workers/supa')).getSupabaseClient;
          await recordNewsletterOptOut({
            recipient: message.from,
            messageId: message.id,
            client: getClient() as unknown as WebhookSupabaseClient,
          });
        }

        const messageLog = await resolveMessageLogDependencies(overrides);
        const phone = messageLog.normalizePhone(message.from);
        const outreach = await messageLog.findLatestOutreach(phone);
        const logged = await messageLog.logMessage({
          outreachId: outreach?.id || null,
          agentId: outreach?.agent_id || null,
          direction: 'inbound',
          phone,
          chatId: message.from,
          wahaMessageId: message.id,
          body: message.body,
          rawPayload: message.rawPayload,
          occurredAt: message.timestamp
            ? new Date(typeof message.timestamp === 'number' ? message.timestamp * 1000 : message.timestamp).toISOString()
            : new Date().toISOString(),
        });

        return NextResponse.json({
          success: true,
          optedOut: true,
          duplicate: logged.duplicate,
          outreachId: outreach?.id || null,
        });
      }

      const processInboundMessage = overrides.processInboundMessage
        || (await import('@/lib/ai/whatsapp-conversation-engine')).processInboundWhatsAppMessage;
      const result = await processInboundMessage({
        from: message.from,
        to: message.to,
        body: message.body,
        messageId: message.id,
        timestamp: message.timestamp,
        rawPayload: message.rawPayload,
      });

      return NextResponse.json(result);
    } catch (error) {
      console.error('Error processing WAHA webhook:', error);
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown webhook error',
      }, { status: 503 });
    }
  };
}

export const POST = createWebhookHandler();
