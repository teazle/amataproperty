import { getSupabaseClient } from '../../workers/supa';
import {
  type ApprovedLinkedInNewsletterBatch,
  type LinkedInNewsletterRecipientInput,
  validateApprovedLinkedInNewsletterBatch,
} from './newsletter';

export interface LinkedInNewsletterCampaignDraft {
  campaignSlug: string;
  newsletterTitle?: string | null;
  newsletterUrl?: string | null;
  linkedinMessageTemplate?: string | null;
}

export interface StoredLinkedInNewsletterRecipient {
  id: string;
  campaign_id: string;
  name: string;
  profile_url: string;
  headline: string | null;
  visible_location: string | null;
  message_body: string | null;
  status: string;
  sent_at: string | null;
  error: string | null;
}

function normalizeProfileUrl(profileUrl: string): string {
  const trimmed = profileUrl.trim();
  if (!trimmed) return trimmed;
  const url = new URL(trimmed, 'https://www.linkedin.com');
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '/');
}

export async function upsertLinkedInNewsletterDraftCampaign(
  draft: LinkedInNewsletterCampaignDraft,
): Promise<string> {
  const supabase = getSupabaseClient();
  const campaignSlug = draft.campaignSlug.trim();
  if (!campaignSlug) throw new Error('campaignSlug is required');

  const { data, error } = await supabase
    .from('linkedin_newsletter_campaigns')
    .upsert(
      {
        campaign_slug: campaignSlug,
        newsletter_title: draft.newsletterTitle ?? null,
        newsletter_url: draft.newsletterUrl ?? null,
        linkedin_message_template: draft.linkedinMessageTemplate ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'campaign_slug' },
    )
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to upsert LinkedIn newsletter campaign: ${error.message}`);
  }
  return data.id;
}

export async function upsertApprovedLinkedInNewsletterCampaign(
  batch: ApprovedLinkedInNewsletterBatch,
): Promise<string> {
  const approved = validateApprovedLinkedInNewsletterBatch(batch);
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('linkedin_newsletter_campaigns')
    .upsert(
      {
        campaign_slug: approved.campaignSlug.trim(),
        newsletter_title: approved.newsletterTitle.trim(),
        newsletter_url: approved.newsletterUrl.trim(),
        linkedin_message_template: approved.linkedinMessageTemplate.trim(),
        approval_status: 'approved',
        approved_by: approved.approvedBy!.trim(),
        approved_at: approved.approvedAt!,
        status: 'approved',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'campaign_slug' },
    )
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to upsert approved LinkedIn newsletter campaign: ${error.message}`);
  }
  return data.id;
}

export async function upsertLinkedInNewsletterRecipients(
  campaignId: string,
  recipients: LinkedInNewsletterRecipientInput[],
  status: 'candidate' | 'approved' | 'queued' = 'candidate',
): Promise<number> {
  if (recipients.length === 0) return 0;
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const rows = recipients.map((recipient) => ({
    campaign_id: campaignId,
    name: recipient.name.trim() || 'Unknown',
    profile_url: normalizeProfileUrl(recipient.profileUrl),
    headline: recipient.headline?.trim() || null,
    visible_location: recipient.location?.trim() || null,
    status,
    updated_at: now,
  }));

  const { error } = await supabase
    .from('linkedin_newsletter_recipients')
    .upsert(rows, { onConflict: 'campaign_id,profile_url' });

  if (error) {
    throw new Error(`Failed to upsert LinkedIn newsletter recipients: ${error.message}`);
  }
  return rows.length;
}

export async function listApprovedLinkedInNewsletterRecipients(
  campaignSlug: string,
  limit: number,
): Promise<StoredLinkedInNewsletterRecipient[]> {
  const supabase = getSupabaseClient();
  const { data: campaign, error: campaignError } = await supabase
    .from('linkedin_newsletter_campaigns')
    .select('id')
    .eq('campaign_slug', campaignSlug)
    .single();

  if (campaignError) {
    throw new Error(`Failed to load campaign ${campaignSlug}: ${campaignError.message}`);
  }

  const { data, error } = await supabase
    .from('linkedin_newsletter_recipients')
    .select('*')
    .eq('campaign_id', campaign.id)
    .in('status', ['approved', 'queued'])
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list LinkedIn newsletter recipients: ${error.message}`);
  }
  return (data || []) as StoredLinkedInNewsletterRecipient[];
}

export async function getLastLinkedInNewsletterSentAt(
  profileUrl: string,
  excludingCampaignId?: string,
): Promise<string | null> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('linkedin_newsletter_recipients')
    .select('sent_at')
    .eq('profile_url', normalizeProfileUrl(profileUrl))
    .eq('status', 'sent')
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(1);

  if (excludingCampaignId) {
    query = query.neq('campaign_id', excludingCampaignId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`Failed to check LinkedIn newsletter duplicate history: ${error.message}`);
  }
  return data?.sent_at ?? null;
}

export async function updateLinkedInNewsletterRecipientStatus(
  id: string,
  updates: {
    status: StoredLinkedInNewsletterRecipient['status'];
    messageBody?: string | null;
    error?: string | null;
    sentAt?: string | null;
  },
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('linkedin_newsletter_recipients')
    .update({
      status: updates.status,
      message_body: updates.messageBody,
      error: updates.error ?? null,
      sent_at: updates.sentAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to update LinkedIn newsletter recipient ${id}: ${error.message}`);
  }
}
