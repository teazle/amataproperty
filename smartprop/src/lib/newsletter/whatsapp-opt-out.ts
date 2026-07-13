import { normalizeSingaporeRecipient } from './recipient';

const STOP_KEYWORDS = new Set(['STOP', 'UNSUBSCRIBE', 'CANCEL', 'OPTOUT', 'OPT OUT']);

export interface NewsletterOptOutClient {
  rpc(name: string, args: Record<string, string>): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

export interface RecordNewsletterOptOutInput {
  recipient: string;
  messageId: string | null;
  client: NewsletterOptOutClient;
}

export function isNewsletterOptOutKeyword(body: string): boolean {
  return STOP_KEYWORDS.has(body.trim().toUpperCase());
}

export function normalizeNewsletterOptOutRecipient(value: string): string | null {
  return normalizeSingaporeRecipient(value.replace(/@(c\.us|s\.whatsapp\.net)$/i, ''));
}

export async function recordNewsletterOptOut({
  recipient,
  messageId,
  client,
}: RecordNewsletterOptOutInput): Promise<void> {
  const normalizedRecipient = normalizeNewsletterOptOutRecipient(recipient);
  if (!normalizedRecipient) throw new Error('recipient must normalize to E.164');

  const normalizedMessageId = messageId?.trim();
  if (!normalizedMessageId) throw new Error('provider message id is required for STOP deduplication');

  const { error } = await client.rpc('record_newsletter_opt_out', {
    p_recipient: normalizedRecipient,
    p_message_id: normalizedMessageId,
    p_reason: 'whatsapp_stop',
  });
  if (error) throw new Error(`record newsletter opt-out: ${error.message}`);
}
