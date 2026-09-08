import {
  createSelectedWhatsAppCampaignTransport,
  type SelectedTransportDependencies,
} from './selected-transport';
import { randomUUID } from 'node:crypto';
import {
  isCustomerRecipientSuppressed,
  type CustomerSuppressionLookup,
} from './customer-suppression';

export type CustomerTextPurpose =
  | 'initial_cobroking'
  | 'viewing_request'
  | 'manual_outreach'
  | 'auto_reply'
  | 'valuation_reply'
  | 'api_text'
  | 'signing_confirmation';

export interface CustomerTextInput {
  to: string;
  text: string;
  purpose: CustomerTextPurpose;
  /** A durable delivery claim key when the caller has one. */
  idempotencyKey?: string;
}

export type CustomerTransportProvider = 'waha' | 'openclaw' | 'unknown';

export type CustomerTextResult =
  | {
    outcome: 'accepted';
    provider: 'waha' | 'openclaw';
    messageId: string;
    messageText: string;
  }
  | {
    outcome: 'blocked' | 'rejected' | 'unknown';
    provider: CustomerTransportProvider;
    error: string;
  };

export interface CustomerTextTransport {
  sendText: (input: CustomerTextInput) => Promise<CustomerTextResult>;
}

export interface CustomerTextTransportDependencies extends SelectedTransportDependencies {
  isCustomerSuppressed?: CustomerSuppressionLookup;
}

const CUSTOMER_TEXT_PURPOSES = new Set<CustomerTextPurpose>([
  'initial_cobroking',
  'viewing_request',
  'manual_outreach',
  'auto_reply',
  'valuation_reply',
  'api_text',
  'signing_confirmation',
]);

function configuredProvider(value: string | undefined): CustomerTransportProvider {
  const normalized = (value || 'waha').trim().toLowerCase();
  if (normalized === 'waha' || normalized === 'openclaw') return normalized;
  return 'unknown';
}

function normalizeSingaporeCustomerRecipient(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (/@(?:g\.us|lid)$/i.test(raw)) return null;
  const phone = raw.replace(/@(?:c\.us|s\.whatsapp\.net)$/i, '');
  if (phone.includes('@') || !/^[+\d\s()-]+$/.test(phone)) return null;

  const plusCount = phone.match(/\+/g)?.length || 0;
  if (plusCount > 1 || (plusCount === 1 && !phone.startsWith('+'))) return null;

  let parenthesisDepth = 0;
  for (const character of phone) {
    if (character === '(') parenthesisDepth += 1;
    if (character === ')') parenthesisDepth -= 1;
    if (parenthesisDepth < 0 || parenthesisDepth > 1) return null;
  }
  if (parenthesisDepth !== 0) return null;

  const compact = phone.replace(/[\s()-]/g, '');
  const match = compact.match(/^(?:\+?65)?([89]\d{7})$/);
  return match ? `+65${match[1]}` : null;
}

function validateInput(input: unknown): { recipient: string; text: string } | { error: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { error: 'customer text input is invalid' };
  const candidate = input as Partial<CustomerTextInput>;
  const recipient = normalizeSingaporeCustomerRecipient(candidate.to);
  if (!recipient) return { error: 'customer recipient must be an individual Singapore WhatsApp number' };
  if (typeof candidate.text !== 'string' || candidate.text.trim() === '') return { error: 'customer message text must not be blank' };
  if (!CUSTOMER_TEXT_PURPOSES.has(candidate.purpose as CustomerTextPurpose)) return { error: 'customer message purpose is unsupported' };
  return { recipient, text: candidate.text };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown customer transport error';
}

/**
 * Customer-message adapter for individual transactional texts. Consent and
 * workflow policy belong to the caller; this adapter only validates the send
 * boundary and maps the selected provider's terminal outcome.
 */
export function createCustomerTextTransport(
  dependencies: CustomerTextTransportDependencies = {},
): CustomerTextTransport {
  const provider = configuredProvider(
    dependencies.provider ?? process.env.SMARTPROP_WHATSAPP_PROVIDER,
  );
  const selectedTransport = createSelectedWhatsAppCampaignTransport(dependencies);
  const isSuppressed = dependencies.isCustomerSuppressed || isCustomerRecipientSuppressed;

  return {
    sendText: async (input) => {
      const validated = validateInput(input);
      if ('error' in validated) return { outcome: 'rejected', provider, error: validated.error };
      if (provider === 'unknown') {
        return {
          outcome: 'blocked',
          provider,
          error: `Unsupported SMARTPROP_WHATSAPP_PROVIDER: ${dependencies.provider ?? process.env.SMARTPROP_WHATSAPP_PROVIDER}`,
        };
      }

      try {
        if (await isSuppressed(validated.recipient)) {
          return {
            outcome: 'blocked',
            provider,
            error: 'customer recipient is suppressed after a persisted STOP request',
          };
        }
      } catch (error) {
        return {
          outcome: 'blocked',
          provider,
          error: `customer suppression lookup failed closed: ${errorMessage(error)}`,
        };
      }

      try {
        const readiness = await selectedTransport.preflight();
        if (!readiness.ready) {
          return {
            outcome: 'blocked',
            provider,
            error: readiness.error || 'selected WhatsApp provider is not ready',
          };
        }
      } catch (error) {
        return { outcome: 'unknown', provider, error: errorMessage(error) };
      }

      try {
        const idempotencyKey = typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
          ? input.idempotencyKey.trim()
          : `customer:${randomUUID()}`;
        const result = await selectedTransport.transport(
          validated.recipient,
          validated.text,
          idempotencyKey,
        );
        if (result.outcome === 'accepted') {
          const messageId = typeof result.messageId === 'string' ? result.messageId.trim() : '';
          if (messageId) {
            return { outcome: 'accepted', provider, messageId, messageText: validated.text };
          }
          return {
            outcome: 'unknown',
            provider,
            error: 'selected WhatsApp provider accepted a send without a message id',
          };
        }
        if (result.outcome === 'rejected') {
          return { outcome: 'rejected', provider, error: result.error };
        }
        return { outcome: result.outcome, provider, error: result.error };
      } catch (error) {
        return { outcome: 'unknown', provider, error: errorMessage(error) };
      }
    },
  };
}
