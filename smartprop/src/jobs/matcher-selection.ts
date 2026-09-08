import { normalizeNewsletterOptOutRecipient } from '@/lib/newsletter/whatsapp-opt-out';

export type MatcherListing = {
  id: string;
  agent_id: string | null;
  price: number | null;
  scraped_at: string | null;
  title: string | null;
  url: string | null;
};

export type MatcherAgent = {
  id: string;
  name: string;
  phone: string | null;
};

export type ExistingOutreach = {
  agent_id: string | null;
  listing_id: string | null;
  status: string | null;
};

export type MatcherCandidate = {
  agent_id: string;
  listing_id: string;
  channel: 'whatsapp';
  template_name: 'new_property_alert';
  status: 'queued';
  listing: MatcherListing;
  agent: MatcherAgent;
};

const MIN_PRICE = 1_000_000;
const MAX_PRICE = 2_999_000;
const RECENTLY_REFRESHED_MS = 24 * 60 * 60 * 1000;

function isRecentlyRefreshed(scrapedAt: string | null, now: Date) {
  if (!scrapedAt) return false;
  const timestamp = new Date(scrapedAt).getTime();
  return Number.isFinite(timestamp) && timestamp >= now.getTime() - RECENTLY_REFRESHED_MS && timestamp <= now.getTime();
}

export function selectRecentListingAgentOutreach(input: {
  now: Date;
  listings: MatcherListing[];
  agents: MatcherAgent[];
  existingOutreach: ExistingOutreach[];
  optedOutAgentIds: string[];
  suppressedRecipientKeys?: string[];
  allowedListingIds?: string[];
}): MatcherCandidate[] {
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]));
  const optedOut = new Set(input.optedOutAgentIds);
  const suppressedRecipientKeys = new Set(input.suppressedRecipientKeys || []);
  const existingPairs = new Set(
    input.existingOutreach
      .filter((outreach) => outreach.agent_id && outreach.listing_id)
      .map((outreach) => `${outreach.agent_id}:${outreach.listing_id}`),
  );
  const allowedListingIds = input.allowedListingIds ? new Set(input.allowedListingIds) : null;

  return input.listings.flatMap((listing) => {
    if (!listing.agent_id || !listing.price || !isRecentlyRefreshed(listing.scraped_at, input.now)) return [];
    if (listing.price < MIN_PRICE || listing.price > MAX_PRICE) return [];
    if (allowedListingIds && !allowedListingIds.has(listing.id)) return [];

    const agent = agentById.get(listing.agent_id);
    if (!agent || !agent.phone || optedOut.has(agent.id)) return [];
    const recipientKey = normalizeNewsletterOptOutRecipient(agent.phone);
    if (!recipientKey || suppressedRecipientKeys.has(recipientKey)) return [];
    if (existingPairs.has(`${agent.id}:${listing.id}`)) return [];

    return [{
      agent_id: agent.id,
      listing_id: listing.id,
      channel: 'whatsapp' as const,
      template_name: 'new_property_alert' as const,
      status: 'queued' as const,
      listing,
      agent,
    }];
  });
}

export function matcherExecutionPlan(input: { confirmedListingIds?: string[] }) {
  if (input.confirmedListingIds && input.confirmedListingIds.length > 0) {
    return { mode: 'prepare_selected' as const, writesOutreach: true, sendsMessages: false };
  }

  return { mode: 'preview' as const, writesOutreach: false, sendsMessages: false };
}
