export interface LinkedInNewsletterRecipientInput {
  name: string;
  profileUrl: string;
  location?: string | null;
  headline?: string | null;
}

export interface ApprovedLinkedInNewsletterBatch {
  campaignSlug: string;
  newsletterTitle: string;
  newsletterUrl: string;
  linkedinMessageTemplate: string;
  approvedBy?: string;
  approvedAt?: string;
  recipients: LinkedInNewsletterRecipientInput[];
}

export interface RenderLinkedInNewsletterMessageInput {
  template: string;
  recipientName: string | null;
  newsletterTitle: string;
  newsletterUrl: string;
}

export interface SuppressionInput {
  lastSentAt: string | null;
  now?: Date;
  suppressionDays?: number;
}

const HONORIFICS = new Set(['MR', 'MRS', 'MS', 'MISS', 'MDM', 'DR', 'PROF']);
const DEFAULT_MAX_LINKEDIN_DM_CHARS = 700;
const DEFAULT_SUPPRESSION_DAYS = 90;

function titleCase(word: string): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function firstNameForLinkedIn(fullName: string | null | undefined): string {
  const cleaned = (fullName || '').trim();
  if (!cleaned) return 'there';

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 'there';

  const first = tokens[0].toUpperCase().replace(/[^A-Z]/g, '');
  if (HONORIFICS.has(first) && tokens.length > 1) {
    return `${titleCase(tokens[0])} ${titleCase(tokens[1])}`;
  }
  if (HONORIFICS.has(first)) return 'there';
  return titleCase(tokens[0]);
}

export function isSingaporeLinkedInLocation(location: string | null | undefined): boolean {
  const normalized = (location || '').trim().toLowerCase();
  if (!normalized) return false;
  return /(^|[\s,])singapore($|[\s,])/.test(normalized);
}

export function renderLinkedInNewsletterMessage(input: RenderLinkedInNewsletterMessageInput): string {
  const message = input.template
    .replace(/\{firstName\}/g, firstNameForLinkedIn(input.recipientName))
    .replace(/\{newsletterTitle\}/g, input.newsletterTitle.trim())
    .replace(/\{newsletterUrl\}/g, input.newsletterUrl.trim())
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!message) {
    throw new Error('LinkedIn newsletter message cannot be empty');
  }

  if (message.length > DEFAULT_MAX_LINKEDIN_DM_CHARS) {
    throw new Error(`LinkedIn newsletter message exceeds ${DEFAULT_MAX_LINKEDIN_DM_CHARS} characters`);
  }

  return message;
}

export function validateApprovedLinkedInNewsletterBatch(
  batch: ApprovedLinkedInNewsletterBatch,
): ApprovedLinkedInNewsletterBatch {
  if (!batch.campaignSlug?.trim()) {
    throw new Error('campaignSlug is required');
  }
  if (!batch.newsletterTitle?.trim()) {
    throw new Error('newsletterTitle is required');
  }
  if (!batch.newsletterUrl?.trim()) {
    throw new Error('newsletterUrl is required');
  }
  if (!batch.linkedinMessageTemplate?.trim()) {
    throw new Error('linkedinMessageTemplate is required');
  }
  if (!batch.approvedBy?.trim()) {
    throw new Error('approvedBy is required');
  }
  if (!batch.approvedAt?.trim()) {
    throw new Error('approvedAt is required');
  }
  const approvedAt = Date.parse(batch.approvedAt);
  if (!Number.isFinite(approvedAt)) {
    throw new Error('approvedAt must be an ISO timestamp');
  }
  if (!Array.isArray(batch.recipients)) {
    throw new Error('recipients must be an array');
  }

  return batch;
}

export function shouldSuppressNewsletterRecipient(input: SuppressionInput): boolean {
  if (!input.lastSentAt) return false;
  const sentAt = Date.parse(input.lastSentAt);
  if (!Number.isFinite(sentAt)) return false;

  const now = input.now || new Date();
  const suppressionDays = input.suppressionDays ?? DEFAULT_SUPPRESSION_DAYS;
  const ageMs = now.getTime() - sentAt;
  return ageMs >= 0 && ageMs < suppressionDays * 24 * 60 * 60 * 1000;
}
