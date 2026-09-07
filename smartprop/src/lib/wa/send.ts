import {
  createCustomerTextTransport,
  type CustomerTextResult,
  type CustomerTextTransport,
  type CustomerTransportProvider,
} from './customer-transport';

export interface SendTemplateResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  outcome: CustomerTextResult['outcome'];
  provider: CustomerTransportProvider;
}

export interface SendTemplateOptions {
  customerTransport?: CustomerTextTransport;
}

function validateHttpsListingUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '' ? value : null;
  } catch {
    return null;
  }
}

function signingNotificationText(templateName: string, parameters: string[]): string | null {
  if (templateName !== 'agreement_received' || parameters.length !== 2) return null;
  const [agreementName, listingUrl] = parameters;
  if (agreementName !== 'Co-broking Agreement') return null;
  const validListingUrl = validateHttpsListingUrl(listingUrl);
  return validListingUrl
    ? `We have received your Co-broking Agreement. Property: ${validListingUrl}`
    : null;
}

function blockedTemplate(): SendTemplateResponse {
  return {
    success: false,
    outcome: 'blocked',
    provider: 'unknown',
    error: 'Unsupported signing notification template or parameters',
  };
}

function transportFailure(result: Exclude<CustomerTextResult, { outcome: 'accepted' }>): SendTemplateResponse {
  return {
    success: false,
    outcome: result.outcome,
    provider: result.provider,
    error: result.error,
  };
}

/**
 * Compatibility seam for the one approved signing notification. It accepts
 * only the route's existing agreement template intent and sends deterministic
 * plain text through the customer transport; no template/media translation is
 * inferred for other callers.
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  parameters: string[] = [],
  options: SendTemplateOptions = {},
): Promise<SendTemplateResponse> {
  const text = signingNotificationText(templateName, parameters);
  if (!text) return blockedTemplate();

  const customerTransport = options.customerTransport || createCustomerTextTransport();
  try {
    const result = await customerTransport.sendText({
      to,
      text,
      purpose: 'signing_confirmation',
    });
    if (result.outcome !== 'accepted') return transportFailure(result);

    const messageId = result.messageId.trim();
    if (!messageId) {
      return {
        success: false,
        outcome: 'unknown',
        provider: result.provider,
        error: 'Customer transport accepted a signing notification without a message id',
      };
    }
    return {
      success: true,
      messageId,
      outcome: 'accepted',
      provider: result.provider,
    };
  } catch (error) {
    return {
      success: false,
      outcome: 'unknown',
      provider: 'unknown',
      error: error instanceof Error ? error.message : 'Unknown customer transport error',
    };
  }
}
