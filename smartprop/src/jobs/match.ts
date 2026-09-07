/**
 * Property Matching Job
 * Fetches new listings and creates outreach entries for agents
 */

import { createClient } from '@supabase/supabase-js';
import { generateCoBrokingInquiryMessage } from '@/lib/wa/waha';
import { logWhatsAppMessage } from '@/lib/wa/message-log';
import { createCustomerTextTransport, type CustomerTextTransport } from '../lib/wa/customer-transport';
import { createCustomerDeliveryStore, type CustomerDeliveryStore } from '../lib/wa/customer-delivery-store';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;

// Create a client with service role key for admin operations
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface Listing {
  id: string;
  portal: string;
  url: string;
  title: string;
  price: number;
  district: string;
  property_type: string;
  agent_id: string;
  posted_at: string;
}

interface Agent {
  id: string;
  name: string;
  phone: string;
  email: string;
  agency: string;
  cea_reg_no: string;
  source: string;
}

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
};

type MatchingJobDependencies = {
  deliveryStore?: CustomerDeliveryStore;
  customerTransport?: CustomerTextTransport;
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
};

/**
 * Fetches new listings from the last 24 hours matching criteria
 */
async function fetchNewListings(): Promise<Listing[]> {
  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
  
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .gte('posted_at', twentyFourHoursAgo.toISOString())
    .gte('price', 1000000)
    .lte('price', 2999000)
    .in('portal', ['propertyguru', 'edgeprop'])
    .order('posted_at', { ascending: false });

  if (error) {
    console.error('Error fetching listings:', error);
    throw new Error(`Failed to fetch listings: ${error.message}`);
  }

  return data || [];
}

/**
 * Fetches all active agents
 */
async function fetchAgents(): Promise<Agent[]> {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .order('name');

  if (error) {
    console.error('Error fetching agents:', error);
    throw new Error(`Failed to fetch agents: ${error.message}`);
  }

  return data || [];
}

/**
 * Creates outreach entries for agent-listing combinations that don't exist
 */
async function upsertOutreachEntries(
  listings: Listing[],
  agents: Agent[],
  options: MatchingJobOptions = {}
): Promise<Partial<Outreach>[]> {
  const outreachEntries: Partial<Outreach>[] = [];
  
  // Create all possible agent-listing combinations
  for (const listing of listings) {
    for (const agent of agents) {
      // Skip if this is the listing's own agent
      if (listing.agent_id === agent.id) {
        continue;
      }
      
      outreachEntries.push({
        agent_id: agent.id,
        listing_id: listing.id,
        channel: 'whatsapp',
        template_name: 'new_property_alert',
        status: 'queued'
      });
    }
  }

  if (outreachEntries.length === 0) {
    return [];
  }

  // Check for existing outreach entries to avoid duplicates
  const { data: existingEntries, error: checkError } = await supabase
    .from('outreach')
    .select('agent_id, listing_id')
    .in('agent_id', outreachEntries.map(e => e.agent_id))
    .in('listing_id', outreachEntries.map(e => e.listing_id));

  if (checkError) {
    console.error('Error checking existing outreach:', checkError);
    throw new Error(`Failed to check existing outreach: ${checkError.message}`);
  }

  // Filter out combinations that already exist
  const existingCombinations = new Set(
    (existingEntries || []).map(e => `${e.agent_id}-${e.listing_id}`)
  );
  
  const newEntries = outreachEntries.filter(entry => 
    !existingCombinations.has(`${entry.agent_id}-${entry.listing_id}`)
  );

  if (newEntries.length === 0) {
    console.log('No new outreach entries to create');
    return [];
  }

  if (options.dryRun) {
    console.log(`[dry-run] Would create ${newEntries.length} outreach entries`);
    return newEntries;
  }

  // Insert new outreach entries
  const { data: insertedEntries, error: insertError } = await supabase
    .from('outreach')
    .insert(newEntries)
    .select();

  if (insertError) {
    console.error('Error inserting outreach entries:', insertError);
    throw new Error(`Failed to insert outreach entries: ${insertError.message}`);
  }

  console.log(`Created ${insertedEntries?.length || 0} new outreach entries`);
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
      listings!inner(title, price, district, property_type, url)
    `)
    .eq('status', 'queued')
    .eq('channel', 'whatsapp')
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

  if (options.dryRun) {
    console.log(`[dry-run] Would process ${queuedOutreach.length} queued outreach messages`);
    const previews = queuedOutreach.map((outreach) => ({
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
      processed: queuedOutreach.length,
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

  // Process each message with delay between messages to avoid rate limiting
  for (let i = 0; i < queuedOutreach.length; i++) {
    const outreach = queuedOutreach[i];
    
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
      result = await customerTransport.sendText({ to: outreach.agents.phone, text: message, purpose: 'initial_cobroking' });
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
      console.error(`⚠️ Failed to log accepted outreach ${outreach.id}:`, error);
    }
    console.log(`✅ WhatsApp message sent successfully to ${outreach.agents.phone} (${i + 1}/${queuedOutreach.length})`);
    sent++;
  }

  return { 
    processed: queuedOutreach.length, 
    sent, 
    failed,
    ...(reconciliationRequired ? { reconciliationRequired, reconciliationErrors } : {}),
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
    console.log(`Starting property matching job${options.dryRun ? ' (dry-run)' : ''}...`);

    // Fetch new listings
    const listings = await fetchNewListings();
    console.log(`Found ${listings.length} new listings matching criteria`);

    // Fetch agents
    const agents = await fetchAgents();
    console.log(`Found ${agents.length} agents`);

    // Create outreach entries
    const outreachEntries = await upsertOutreachEntries(listings, agents, options);
    console.log(`${options.dryRun ? 'Would create' : 'Created'} ${outreachEntries.length} new outreach entries`);

    // Process queued messages (use provided limit or default)
    const messageStats = await processOutreachMessages(outreachLimit, undefined, options, dependencies);
    console.log(`${options.dryRun ? 'Would process' : 'Processed'} ${messageStats.processed} messages: ${messageStats.sent} sent, ${messageStats.failed} failed`);
    const reconciliationRequired = messageStats.reconciliationRequired || 0;
    const deliveryFailed = messageStats.failed > 0;

    return {
      success: !deliveryFailed && reconciliationRequired === 0,
      message: reconciliationRequired > 0
        ? 'Matching job completed with reconciliation required'
        : deliveryFailed
          ? 'Matching job completed with delivery failures'
        : options.dryRun ? 'Matching job dry-run completed successfully' : 'Matching job completed successfully',
      dryRun: options.dryRun || undefined,
      stats: {
        listingsFound: listings.length,
        agentsFound: agents.length,
        outreachCreated: outreachEntries.length,
        messagesProcessed: messageStats.processed,
        messagesSent: messageStats.sent,
        messagesFailed: messageStats.failed,
        messagesQueued: messageStats.queued,
        previewMessages: messageStats.previews?.length,
        ...(reconciliationRequired ? { messagesReconciliationRequired: reconciliationRequired } : {}),
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
