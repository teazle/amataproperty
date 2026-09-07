import {
  createCustomerTextTransport,
  type CustomerTextPurpose,
  type CustomerTextResult,
  type CustomerTextTransport,
} from './customer-transport';
import { generateCoBrokingInquiryMessage } from './waha';

type ApiTextInput = {
  to: string;
  text?: string;
  type?: string;
  agentName?: string;
  propertyTitle?: string;
  propertyUrl?: string;
  transport?: CustomerTextTransport;
};

function apiTextPayload(input: ApiTextInput): { text: string; purpose: CustomerTextPurpose } {
  if (input.type === 'co_broking_inquiry') {
    return {
      text: generateCoBrokingInquiryMessage(input.agentName!, input.propertyTitle!, input.propertyUrl!),
      purpose: 'initial_cobroking',
    };
  }

  return { text: input.text!, purpose: 'api_text' };
}

export async function sendApiText(input: ApiTextInput): Promise<CustomerTextResult> {
  const payload = apiTextPayload(input);
  const transport = input.transport ?? createCustomerTextTransport();
  return transport.sendText({ to: input.to, ...payload });
}
