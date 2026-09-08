import { normalizeNewsletterOptOutRecipient } from '../newsletter/whatsapp-opt-out';

export interface NewsletterSuppressionClient {
  from(table: 'newsletter_suppressions'): {
    select(columns: 'recipient_key'): {
      eq(column: 'recipient_key', recipient: string): {
        limit(count: 1): PromiseLike<{
          data: unknown;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

export type CustomerSuppressionLookup = (recipient: string) => Promise<boolean>;

export async function lookupCustomerSuppression(
  recipient: string,
  client: NewsletterSuppressionClient,
): Promise<boolean> {
  const normalizedRecipient = normalizeNewsletterOptOutRecipient(recipient);
  if (!normalizedRecipient) throw new Error('customer suppression recipient must normalize to E.164');

  const { data, error } = await client
    .from('newsletter_suppressions')
    .select('recipient_key')
    .eq('recipient_key', normalizedRecipient)
    .limit(1);
  if (error) throw new Error(`customer suppression lookup failed: ${error.message}`);
  if (!Array.isArray(data)) throw new Error('customer suppression lookup returned malformed data');
  return data.length > 0;
}

export async function isCustomerRecipientSuppressed(recipient: string): Promise<boolean> {
  const { getSupabaseClient } = await import('@/workers/supa');
  return lookupCustomerSuppression(recipient, getSupabaseClient() as unknown as NewsletterSuppressionClient);
}
