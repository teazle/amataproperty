/**
 * Property Matching Job
 * Fetches new listings and creates outreach entries for agents
 */

import { createClient } from '@supabase/supabase-js';
import {
  generateCoBrokingInquiryMessage,
  getWAHAReadiness,
  sendCoBrokingInquiry
} from '@/lib/wa/waha';
import { logWhatsAppMessage } from '@/lib/wa/message-log';

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
  options: MatchingJobOptions = {}
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
    const previews = queuedOutreach.map((outreach: any) => ({
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

  const waha = await getWAHAReadiness();
  if (!waha.ready) {
    console.warn(`WAHA is not ready; leaving ${queuedOutreach.length} outreach messages queued: ${waha.error || 'unknown readiness error'}`);
    return {
      processed: queuedOutreach.length,
      sent: 0,
      failed: 0,
      queued: queuedOutreach.length,
      wahaReady: false,
      wahaError: waha.error || 'WAHA is not ready',
    };
  }

  let sent = 0;
  let failed = 0;

  // Process each message with delay between messages to avoid rate limiting
  for (let i = 0; i < queuedOutreach.length; i++) {
    const outreach = queuedOutreach[i];
    
    // Add delay before sending (except for the first message)
    if (i > 0 && delayBetweenMessages > 0) {
      console.log(`⏳ Waiting ${delayBetweenMessages}ms before sending next message (rate limiting protection)...`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenMessages));
    }
    
    try {
      // Update status to 'sent' first
      const { error: updateError } = await supabase
        .from('outreach')
        .update({ status: 'sent' })
        .eq('id', outreach.id);

      if (updateError) {
        console.error(`Failed to update outreach status for ${outreach.id}:`, updateError);
        failed++;
        continue;
      }

      // Send co-broking inquiry via WhatsApp
      try {
        const result = await sendCoBrokingInquiry(
          outreach.agents.phone,
          outreach.agents.name,
          outreach.listings.title || 'New Property',
          outreach.listings.url
        );

        if (result.success) {
          // Initialize conversation history with the initial message
          const initialMessage = {
            role: 'user',
            message: result.messageText || 'Co-broking inquiry sent',
            timestamp: new Date().toISOString()
          };

          // Update outreach record with message details and conversation history
          await supabase
            .from('outreach')
            .update({ 
              status: 'sent',
              message_text: result.messageText || 'Co-broking inquiry sent',
              wa_conversation_id: result.messageId ? JSON.stringify(result.messageId) : null,
              first_message_sent_at: new Date().toISOString(),
              conversation_history: [initialMessage]
            })
            .eq('id', outreach.id);

          await logWhatsAppMessage({
            outreachId: outreach.id,
            agentId: outreach.agent_id,
            direction: 'outbound',
            phone: outreach.agents.phone,
            wahaMessageId: result.messageId || null,
            body: result.messageText || 'Co-broking inquiry sent',
            rawPayload: result,
          });

          console.log(`✅ WhatsApp message sent successfully to ${outreach.agents.phone} (${i + 1}/${queuedOutreach.length})`);
          sent++;
        } else {
          throw new Error(result.error || 'Failed to send message');
        }
      } catch (error) {
        console.error(`❌ Failed to send WhatsApp message to ${outreach.agents.phone}:`, error);
        
        // Update status to 'failed'
        await supabase
          .from('outreach')
          .update({ status: 'failed' })
          .eq('id', outreach.id);
        
        failed++;
      }
    } catch (error) {
      console.error(`❌ Error processing outreach ${outreach.id}:`, error);
      
      // Update status to 'failed'
      await supabase
        .from('outreach')
        .update({ status: 'failed' })
        .eq('id', outreach.id);
      
      failed++;
    }
  }

  return { 
    processed: queuedOutreach.length, 
    sent, 
    failed 
  };
}

/**
 * Main matching job function
 * @param outreachLimit - Optional limit for outreach messages (defaults to 15 if not provided)
 */
export async function runMatchingJob(outreachLimit?: number, options: MatchingJobOptions = {}): Promise<{
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
    const messageStats = await processOutreachMessages(outreachLimit, undefined, options);
    console.log(`${options.dryRun ? 'Would process' : 'Processed'} ${messageStats.processed} messages: ${messageStats.sent} sent, ${messageStats.failed} failed`);

    return {
      success: true,
      message: options.dryRun ? 'Matching job dry-run completed successfully' : 'Matching job completed successfully',
      dryRun: options.dryRun || undefined,
      stats: {
        listingsFound: listings.length,
        agentsFound: agents.length,
        outreachCreated: outreachEntries.length,
        messagesProcessed: messageStats.processed,
        messagesSent: messageStats.sent,
        messagesFailed: messageStats.failed,
        messagesQueued: messageStats.queued,
        previewMessages: messageStats.previews?.length
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
