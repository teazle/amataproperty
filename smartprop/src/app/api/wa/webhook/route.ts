import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { processInboundWhatsAppMessage } from '@/lib/ai/whatsapp-conversation-engine';
import { logWhatsAppMessage, normalizeWhatsAppPhone, findLatestOutreachByPhone } from '@/lib/wa/message-log';

function secureEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyWebhookSecret(request: NextRequest): boolean {
  const expected = process.env.WAHA_WEBHOOK_SECRET;
  if (!expected) return true;

  const provided =
    request.headers.get('x-waha-webhook-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    '';

  return secureEquals(provided, expected);
}

function extractMessage(body: any) {
  const payload = body?.payload || body;
  if (!payload?.body || !payload?.from) {
    return null;
  }

  return {
    from: payload.from as string,
    to: payload.to as string | undefined,
    body: payload.body as string,
    id: payload.id?._serialized || payload.id || payload.messageId || null,
    timestamp: payload.timestamp || null,
    fromMe: Boolean(payload.fromMe),
    rawPayload: payload,
  };
}

function summarize(body: any) {
  const payload = body?.payload || body;
  return {
    event: body?.event || 'direct',
    session: body?.session,
    from: payload?.from,
    to: payload?.to,
    fromMe: payload?.fromMe,
    messageId: payload?.id?._serialized || payload?.id || payload?.messageId,
    messageLength: typeof payload?.body === 'string' ? payload.body.length : 0,
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!verifyWebhookSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    console.log('[WAHA Webhook] Received:', summarize(body));

    const message = extractMessage(body);
    if (!message) {
      return NextResponse.json({ success: true, ignored: true, reason: 'No message payload' });
    }

    if (message.fromMe) {
      const phone = normalizeWhatsAppPhone(message.to || message.from);
      const outreach = await findLatestOutreachByPhone(phone);
      const logged = await logWhatsAppMessage({
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

      return NextResponse.json({
        success: true,
        fromMe: true,
        duplicate: logged.duplicate,
        outreachId: outreach?.id || null,
      });
    }

    const result = await processInboundWhatsAppMessage({
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
      success: true,
      error: error instanceof Error ? error.message : 'Unknown webhook error',
    });
  }
}
