import {
  createPublicLeadOptionsHandler,
  createPublicLeadPostHandler,
} from '@/lib/crm/public-lead-handler';

export const OPTIONS = createPublicLeadOptionsHandler();
export const POST = createPublicLeadPostHandler();
