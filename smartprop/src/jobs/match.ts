/**
 * Property Matching Job
 * Fetches new listings and creates outreach entries for agents
 */

import { createClient } from '@supabase/supabase-js';
import { generateCoBrokingInquiryMessage } from '@/lib/wa/waha';
import { logWhatsAppMessage } from '@/lib/wa/message-log';
import { normalizeNewsletterOptOutRecipient } from '@/lib/newsletter/whatsapp-opt-out';
import { createCustomerTextTransport, type CustomerTextTransport } from '../lib/wa/customer-transport';
import { createCustomerDeliveryStore, type CustomerDeliveryStore } from '../lib/wa/customer-delivery-store';
import {
  matcherExecutionPlan,
  selectRecentListingAgentOutreach,
  type ExistingOutreach,
  type MatcherAgent,
  type MatcherCandidate,
  type MatcherListing,
} from './matcher-selection';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;

// Create a client with service role key for admin operations
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const PAGE_SIZE = 500;
const IN_FILTER_CHUNK_SIZE = 250;
type MatcherDatabase = Pick<typeof supabase, 'from'>;

interface Outreach {
  id: string;
  agent_id: string;
  listing_id: string;
  channel: string;
  template_name: string;
  status: string;
  created_at: string;
}

type MatchingJobOptions = {
  dryRun?: boolean;
  preview?: boolean;
  confirmedListingIds?: string[];
  selectedOutreachIds?: string[];
};

type MatchingJobDependencies = {
  deliveryStore?: CustomerDeliveryStore;
  customerTransport?: CustomerTextTransport;
  matcherDatabase?: MatcherDatabase;
};

type OutreachProcessStats = {
  processed: number;
  sent: number;
  failed: number;
  queued?: number;
  dryRun?: boolean;
  previews?: Array<{
    outreachId: string;
    agentName: string;
    phone: string;
    message: string;
  }>;
  wahaReady?: boolean;
  wahaError?: string;
  reconciliationRequired?: number;
  reconciliationErrors?: string[];
  reconciliationOutreachIds?: string[];
};

/**
 * Fetches listings refreshed within the last 24 hours. Listing sources do not
 * provide a reliable posted_at value, so this intentionally describes scrape
 * recency rather than publication recency.
 */
function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function paginatedRows<T>(label: string, fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function fetchRecentlyRefreshedListings(database: MatcherDatabase): Promise<MatcherListing[]> {
  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
  return paginatedRows<MatcherListing>('fetch recently refreshed listings', async (from, to) => {
    return await database
      .from('listings')
      .select('id, agent_id, price, scraped_at, title, url')
      .gte('scraped_at', twentyFourHoursAgo.toISOString())
      .gte('price', 1000000)
      .lte('price', 2999000)
      .in('portal', ['propertyguru', 'edgeprop'])
      .order('scraped_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);
  });
}

/**
 * Fetches only agents that own a candidate listing. Chunking keeps each `in`
 * filter below the response cap and pagination covers every matching owner.
 */
async function fetchAgents(database: MatcherDatabase, listings: MatcherListing[]): Promise<MatcherAgent[]> {
  const agentIds = Array.from(new Set(listings.map((listing) => listing.agent_id).filter((id): id is string => Boolean(id))));
  const agents = await Promise.all(chunks(agentIds, IN_FILTER_CHUNK_SIZE).map((agentIdChunk) =>
    paginatedRows<MatcherAgent>('fetch candidate listing agents', async (from, to) => {
      return await database
        .from('agents')
        .select('id, name, phone')
        .in('id', agentIdChunk)
        .order('id', { ascending: true })
        .range(from, to);
    }),
  ));
  return agents.flat();
}

/**
 * Collects all rows that could suppress a selected listing-agent pair. The
 * pair query protects deduplication while the opted-out query suppresses an
 * agent even when their opt-out was recorded on an earlier listing.
 */
async function fetchOutreachGuards(database: MatcherDatabase, listings: MatcherListing[], agents: MatcherAgent[]): Promise<{
  existingOutreach: ExistingOutreach[];
  optedOutAgentIds: string[];
  suppressedRecipientKeys: string[];
}> {
  const agentIds = Array.from(new Set(listings.map((listing) => listing.agent_id).filter((id): id is string => Boolean(id))));
  const listingIds = listings.map((listing) => listing.id);
  if (agentIds.length === 0 || listingIds.length === 0) {
    return { existingOutreach: [], optedOutAgentIds: [], suppressedRecipientKeys: [] };
  }

  const ownerByListingId = new Map(listings.map((listing) => [listing.id, listing.agent_id]));
  const existingPages = await Promise.all(chunks(listingIds, IN_FILTER_CHUNK_SIZE).map((listingIdChunk) =>
    paginatedRows<ExistingOutreach>('fetch existing outreach guards', async (from, to) => {
      return await database
        .from('outreach')
        .select('agent_id, listing_id, status')
        .in('listing_id', listingIdChunk)
        .order('listing_id', { ascending: true })
        .order('agent_id', { ascending: true })
        .range(from, to);
    }),
  ));
  const optedOutPages = await Promise.all(chunks(agentIds, IN_FILTER_CHUNK_SIZE).map((agentIdChunk) =>
    paginatedRows<{ agent_id: string | null }>('fetch opted-out agent guards', async (from, to) => {
      return await database
        .from('outreach')
        .select('agent_id')
        .in('agent_id', agentIdChunk)
        .eq('status', 'opted_out')
        .order('agent_id', { ascending: true })
        .range(from, to);
    }),
  ));

  const recipientKeys = Array.from(new Set(agents
    .map((agent) => agent.phone)
    .filter((phone): phone is string => Boolean(phone))
    .map((phone) => normalizeNewsletterOptOutRecipient(phone))
    .filter((recipientKey): recipientKey is string => Boolean(recipientKey))));
  const suppressionPages = await Promise.all(chunks(recipientKeys, IN_FILTER_CHUNK_SIZE).map((recipientKeyChunk) =>
    paginatedRows<{ recipient_key: string }>('fetch newsletter suppression guards', async (from, to) => {
      return await database
        .from('newsletter_suppressions')
        .select('recipient_key')
        .in('recipient_key', recipientKeyChunk)
        .order('recipient_key', { ascending: true })
        .range(from, to);
    }),
  ));

  return {
    existingOutreach: existingPages.flat().filter((entry) => entry.listing_id && entry.agent_id === ownerByListingId.get(entry.listing_id)),
    optedOutAgentIds: optedOutPages.flat()
      .map((entry) => entry.agent_id)
      .filter((id): id is string => Boolean(id)),
    suppressedRecipientKeys: suppressionPages.flat().map((entry) => entry.recipient_key),
  };
}

async function insertPreparedOutreachEntries(database: MatcherDatabase, candidates: MatcherCandidate[]): Promise<Partial<Outreach>[]> {
  const newEntries = candidates.map(({ listing: _listing, agent: _agent, ...entry }) => entry);

  if (newEntries.length === 0) {
    return [];
  }

  // Insert new outreach entries
  const { data: insertedEntries, error: insertError } = await database
    .from('outreach')
    .upsert(newEntries, { ignoreDuplicates: true, onConflict: 'agent_id,listing_id' })
    .select();

  if (insertError) {
    console.error('Error inserting outreach entries:', insertError);
    throw new Error(`Failed to insert outreach entries: ${insertError.message}`);
  }

  return insertedEntries || [];
}

/**
 * Processes queued outreach messages
 * @param limit - Maximum number of messages to process (default: 15, recommended: 10-20 to avoid WhatsApp rate limiting)
 * @param delayBetweenMessages - Delay in milliseconds between messages (default: 1000ms = 1 second)
 */
export async function processOutreachMessages(
  limit: number = 15,
  delayBetweenMessages: number = 1000,
  options: MatchingJobOptions = {},
  dependencies: MatchingJobDependencies = {}
): Promise<OutreachProcessStats> {
  const selectedOutreachIds = Array.from(new Set(options.selectedOutreachIds || []));
  if (selectedOutreachIds.length === 0) {
    return { processed: 0, sent: 0, failed: 0, dryRun: options.dryRun || undefined };
  }

  // Ensure limit is within safe range (10-20 recommended by WAHA docs)
  const safeLimit = Math.max(1, Math.min(limit, 20));
  
  if (limit > 20) {
    console.warn(`⚠️  Outreach limit ${limit} exceeds recommended maximum of 20. Using ${safeLimit} instead.`);
  }
  
  // Fetch queued outreach messages
  const { data: queuedOutreach, error: fetchError } = await supabase
    .from('outreach')
    .select(`
      *,
      agents!inner(name, phone),
      listings!inner(agent_id, title, price, district, property_type, url)
    `)
    .eq('status', 'queued')
    .eq('channel', 'whatsapp')
    .in('id', selectedOutreachIds)
    .limit(safeLimit)
    .order('created_at', { ascending: true });

  if (fetchError) {
    console.error('Error fetching queued outreach:', fetchError);
    throw new Error(`Failed to fetch queued outreach: ${fetchError.message}`);
  }

  if (!queuedOutreach || queuedOutreach.length === 0) {
    console.log('No queued outreach messages found');
    return { processed: 0, sent: 0, failed: 0, dryRun: options.dryRun || undefined };
  }

  const selectedOwnerRows = queuedOutreach.filter((outreach) => outreach.listings.agent_id === outreach.agent_id);
  const selectedAgentIds = Array.from(new Set(selectedOwnerRows.map((outreach) => outreach.agent_id)));
  const { data: optedOutRows, error: optedOutError } = selectedAgentIds.length === 0
    ? { data: [], error: null }
    : await supabase
      .from('outreach')
      .select('agent_id')
      .in('agent_id', selectedAgentIds)
      .eq('status', 'opted_out')
      .limit(1000)
      .order('created_at', { ascending: false });

  if (optedOutError) {
    throw new Error(`Failed to recheck opted-out agents: ${optedOutError.message}`);
  }

  const optedOutAgentIds = new Set((optedOutRows || []).map((row) => row.agent_id));
  const eligibleOutreach = selectedOwnerRows.filter((outreach) => !optedOutAgentIds.has(outreach.agent_id));

  if (eligibleOutreach.length === 0) {
    return { processed: 0, sent: 0, failed: 0, dryRun: options.dryRun || undefined };
  }

  if (options.dryRun) {
    console.log(`[dry-run] Would process ${eligibleOutreach.length} selected queued outreach messages`);
    const previews = eligibleOutreach.map((outreach) => ({
      outreachId: outreach.id,
      agentName: outreach.agents.name,
      phone: outreach.agents.phone,
      message: generateCoBrokingInquiryMessage(
        outreach.agents.name,
        outreach.listings.title || 'New Property',
        outreach.listings.url
      ),
    }));

    return {
      processed: eligibleOutreach.length,
      sent: 0,
      failed: 0,
      dryRun: true,
      previews: options.preview === false ? undefined : previews,
    };
  }

  const deliveryStore = dependencies.deliveryStore ?? createCustomerDeliveryStore(supabase);
  const customerTransport = dependencies.customerTransport ?? createCustomerTextTransport();
  let sent = 0;
  let failed = 0;
  let reconciliationRequired = 0;
  const reconciliationErrors: string[] = [];
  const reconciliationOutreachIds: string[] = [];

  // Process each message with delay between messages to avoid rate limiting
  for (let i = 0; i < eligibleOutreach.length; i++) {
    const outreach = eligibleOutreach[i];
    
    // Add delay before sending (except for the first message)
    if (i > 0 && delayBetweenMessages > 0) {
      console.log(`⏳ Waiting ${delayBetweenMessages}ms before sending next message (rate limiting protection)...`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenMessages));
    }
    
    const key = `initial_cobroking:${outreach.agent_id}:${outreach.listing_id}`;
    let token: string | null;
    try {
      token = await deliveryStore.claim({ key, purpose: 'initial_cobroking', recipient: outreach.agents.phone });
    } catch (error) {
      console.error(`❌ Failed to claim outreach ${outreach.id}:`, error);
      failed++;
      continue;
    }
    if (!token) continue;

    const message = generateCoBrokingInquiryMessage(
      outreach.agents.name,
      outreach.listings.title || 'New Property',
      outreach.listings.url
    );
    let result: Awaited<ReturnType<CustomerTextTransport['sendText']>>;
    try {
      const deliveryInput = {
        to: outreach.agents.phone,
        text: message,
        purpose: 'initial_cobroking' as const,
        idempotencyKey: key,
      };
      result = await customerTransport.sendText(deliveryInput);
    } catch (error) {
      result = { outcome: 'unknown', provider: 'unknown', error: error instanceof Error ? error.message : String(error) };
    }

    let finalized = false;
    try {
      finalized = await deliveryStore.finish({
        key,
        token,
        outcome: result.outcome,
        provider: result.provider,
        ...(result.outcome === 'accepted' ? { messageId: result.messageId } : { error: result.error }),
      });
    } catch (error) {
      console.error(`❌ Failed to finalize outreach ${outreach.id}:`, error);
    }
    if (!finalized) {
      failed++;
      reconciliationRequired++;
      reconciliationOutreachIds.push(outreach.id);
      reconciliationErrors.push(`Outreach ${outreach.id} requires reconciliation: delivery finalization was not confirmed`);
      if (result.outcome === 'accepted' && result.messageId.trim()) sent++;
      continue;
    }
    if (result.outcome !== 'accepted' || !result.messageId.trim()) {
      if (result.outcome !== 'blocked') failed++;
      continue;
    }

    const timestamp = new Date().toISOString();
    const initialMessage = { role: 'user', message: result.messageText, timestamp };
    try {
      const { error: updateError } = await supabase
        .from('outreach')
        .update({
          status: 'sent',
          message_text: result.messageText,
          wa_conversation_id: JSON.stringify(result.messageId),
          first_message_sent_at: timestamp,
          conversation_history: [initialMessage]
        })
        .eq('id', outreach.id);
      if (updateError) throw updateError;
    } catch (error) {
      const message = `Accepted outreach ${outreach.id} requires reconciliation: ${error instanceof Error ? error.message : String(error)}`;
      console.error(message);
      reconciliationRequired++;
      reconciliationOutreachIds.push(outreach.id);
      reconciliationErrors.push(message);
      sent++;
      continue;
    }

    try {
      await logWhatsAppMessage({
        outreachId: outreach.id,
        agentId: outreach.agent_id,
        direction: 'outbound',
        phone: outreach.agents.phone,
        wahaMessageId: result.messageId,
        body: result.messageText,
        rawPayload: result,
      });
    } catch (error) {
      const message = `Accepted outreach ${outreach.id} requires reconciliation: conversation log persistence failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error(message);
      reconciliationRequired++;
      reconciliationOutreachIds.push(outreach.id);
      reconciliationErrors.push(message);
      sent++;
      continue;
    }
    console.log(`✅ WhatsApp message sent successfully to ${outreach.agents.phone} (${i + 1}/${eligibleOutreach.length})`);
    sent++;
  }

  return { 
    processed: eligibleOutreach.length,
    sent, 
    failed,
    ...(reconciliationRequired ? {
      reconciliationRequired,
      reconciliationErrors,
      reconciliationOutreachIds: Array.from(new Set(reconciliationOutreachIds)),
    } : {}),
  };
}

/**
 * Main matching job function
 * @param outreachLimit - Optional limit for outreach messages (defaults to 15 if not provided)
 */
export async function runMatchingJob(
  outreachLimit?: number,
  options: MatchingJobOptions = {},
  dependencies: MatchingJobDependencies = {},
): Promise<{
  success: boolean;
  message: string;
  dryRun?: boolean;
  previews?: Array<{
    listingId: string;
    title: string | null;
    scrapedAt: string | null;
    agentId: string;
    agentName: string;
  }>;
  stats: {
    listingsFound: number;
    agentsFound: number;
    outreachCreated: number;
    messagesProcessed: number;
    messagesSent: number;
    messagesFailed: number;
    messagesQueued?: number;
    previewMessages?: number;
    messagesReconciliationRequired?: number;
  };
}> {
  try {
    const plan = matcherExecutionPlan(options);
    const database = dependencies.matcherDatabase || supabase;
    console.log(`Starting recently refreshed property matcher (${plan.mode})...`);

    const listings = await fetchRecentlyRefreshedListings(database);
    console.log(`Found ${listings.length} recently refreshed listings matching criteria`);

    // Fetch agents
    const agents = await fetchAgents(database, listings);
    console.log(`Found ${agents.length} agents`);

    const guards = await fetchOutreachGuards(database, listings, agents);
    const candidates = selectRecentListingAgentOutreach({
      now: new Date(),
      listings,
      agents,
      existingOutreach: guards.existingOutreach,
      optedOutAgentIds: guards.optedOutAgentIds,
      suppressedRecipientKeys: guards.suppressedRecipientKeys,
      allowedListingIds: options.confirmedListingIds,
    });
    const outreachEntries = plan.writesOutreach
      ? await insertPreparedOutreachEntries(database, candidates)
      : candidates;

    return {
      success: true,
      message: plan.mode === 'preview'
        ? 'Recently refreshed matcher preview completed; no outreach was prepared or sent'
        : 'Selected outreach prepared; no messages were sent',
      dryRun: plan.mode === 'preview' || undefined,
      previews: plan.mode === 'preview'
        ? candidates.map((candidate) => ({
            listingId: candidate.listing_id,
            title: candidate.listing.title,
            scrapedAt: candidate.listing.scraped_at,
            agentId: candidate.agent_id,
            agentName: candidate.agent.name,
          }))
        : undefined,
      stats: {
        listingsFound: listings.length,
        agentsFound: agents.length,
        outreachCreated: plan.writesOutreach ? outreachEntries.length : 0,
        messagesProcessed: 0,
        messagesSent: 0,
        messagesFailed: 0,
        messagesQueued: plan.mode === 'prepare_selected' ? outreachEntries.length : undefined,
        previewMessages: plan.mode === 'preview' ? candidates.length : undefined,
      }
    };
  } catch (error) {
    console.error('Error in matching job:', error);
    return {
      success: false,
      message: `Matching job failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      dryRun: options.dryRun || undefined,
      stats: {
        listingsFound: 0,
        agentsFound: 0,
        outreachCreated: 0,
        messagesProcessed: 0,
        messagesSent: 0,
        messagesFailed: 0
      }
    };
  }
}
