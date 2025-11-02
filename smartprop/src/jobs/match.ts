/**
 * Property Matching Job
 * Fetches new listings and creates outreach entries for agents
 */

import { createClient } from '@supabase/supabase-js';
import { sendCoBrokingInquiry } from '@/lib/wa/waha';

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
async function upsertOutreachEntries(listings: Listing[], agents: Agent[]): Promise<Outreach[]> {
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
 * Processes up to 25 queued outreach messages
 */
export async function processOutreachMessages(): Promise<{ processed: number; sent: number; failed: number }> {
  // Fetch up to 25 queued outreach messages
  const { data: queuedOutreach, error: fetchError } = await supabase
    .from('outreach')
    .select(`
      *,
      agents!inner(name, phone),
      listings!inner(title, price, district, property_type, url)
    `)
    .eq('status', 'queued')
    .eq('channel', 'whatsapp')
    .limit(25)
    .order('created_at', { ascending: true });

  if (fetchError) {
    console.error('Error fetching queued outreach:', fetchError);
    throw new Error(`Failed to fetch queued outreach: ${fetchError.message}`);
  }

  if (!queuedOutreach || queuedOutreach.length === 0) {
    console.log('No queued outreach messages found');
    return { processed: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  // Process each message
  for (const outreach of queuedOutreach) {
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

          console.log(`WhatsApp message sent successfully to ${outreach.agents.phone}`);
          sent++;
        } else {
          throw new Error(result.error || 'Failed to send message');
        }
      } catch (error) {
        console.error(`Failed to send WhatsApp message to ${outreach.agents.phone}:`, error);
        
        // Update status to 'failed'
        await supabase
          .from('outreach')
          .update({ status: 'failed' })
          .eq('id', outreach.id);
        
        failed++;
      }
    } catch (error) {
      console.error(`Error processing outreach ${outreach.id}:`, error);
      
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
 */
export async function runMatchingJob(): Promise<{
  success: boolean;
  message: string;
  stats: {
    listingsFound: number;
    agentsFound: number;
    outreachCreated: number;
    messagesProcessed: number;
    messagesSent: number;
    messagesFailed: number;
  };
}> {
  try {
    console.log('Starting property matching job...');

    // Fetch new listings
    const listings = await fetchNewListings();
    console.log(`Found ${listings.length} new listings matching criteria`);

    // Fetch agents
    const agents = await fetchAgents();
    console.log(`Found ${agents.length} agents`);

    // Create outreach entries
    const outreachEntries = await upsertOutreachEntries(listings, agents);
    console.log(`Created ${outreachEntries.length} new outreach entries`);

    // Process queued messages
    const messageStats = await processOutreachMessages();
    console.log(`Processed ${messageStats.processed} messages: ${messageStats.sent} sent, ${messageStats.failed} failed`);

    return {
      success: true,
      message: 'Matching job completed successfully',
      stats: {
        listingsFound: listings.length,
        agentsFound: agents.length,
        outreachCreated: outreachEntries.length,
        messagesProcessed: messageStats.processed,
        messagesSent: messageStats.sent,
        messagesFailed: messageStats.failed
      }
    };
  } catch (error) {
    console.error('Error in matching job:', error);
    return {
      success: false,
      message: `Matching job failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
