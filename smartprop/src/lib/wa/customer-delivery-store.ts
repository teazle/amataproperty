import type { SupabaseClient } from '@supabase/supabase-js';

export interface CustomerDeliveryClaim {
  key: string;
  purpose: 'initial_cobroking' | 'viewing_request';
  recipient: string;
}
export interface CustomerDeliveryFinish {
  key: string;
  token: string;
  outcome: 'accepted' | 'blocked' | 'rejected' | 'unknown';
  provider: string;
  messageId?: string;
  error?: string;
}
export interface CustomerDeliveryStore {
  claim(input: CustomerDeliveryClaim): Promise<string | null>;
  finish(input: CustomerDeliveryFinish): Promise<boolean>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Service-role RPC boundary. Missing migration or ambiguous results always stop sending. */
export function createCustomerDeliveryStore(db: Pick<SupabaseClient, 'rpc'>): CustomerDeliveryStore {
  return {
    async claim(input) {
      if (!input.key.trim() || !input.recipient.trim()) throw new Error('Delivery claim needs key and recipient');
      const { data, error } = await db.rpc('claim_customer_delivery', {
        p_key: input.key, p_purpose: input.purpose, p_recipient: input.recipient,
      });
      if (error) throw new Error(`Delivery claim failed: ${error.message}`);
      if (data === null) return null;
      if (typeof data !== 'string' || !UUID.test(data)) throw new Error('Delivery claim returned an invalid token');
      return data;
    },
    async finish(input) {
      if (!UUID.test(input.token)) throw new Error('Delivery finalization needs the exact claim token');
      if (input.outcome === 'accepted' && !input.messageId?.trim()) throw new Error('Accepted delivery needs a provider message ID');
      const { data, error } = await db.rpc('finish_customer_delivery', {
        p_key: input.key, p_token: input.token, p_outcome: input.outcome,
        p_provider: input.provider, p_message_id: input.messageId?.trim() || null,
        p_error: input.error || null,
      });
      if (error) throw new Error(`Delivery finalization failed: ${error.message}`);
      if (typeof data !== 'boolean') throw new Error('Delivery finalization returned an invalid result');
      return data;
    },
  };
}
