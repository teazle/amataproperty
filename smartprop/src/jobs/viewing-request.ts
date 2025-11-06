/**
 * Automated Viewing Request Job
 * 
 * Sends WhatsApp messages to agents requesting viewing timeslots
 * for newly scraped listings that haven't been contacted yet.
 */

import { getSupabaseClient } from '../workers/supa';
import { sendViewingRequest } from '@/lib/wa/waha';
import { tryAdvisoryLock, advisoryUnlock } from './lock';

const JOB_NAME = 'viewing-request';
const _LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

interface ListingWithAgent {
  id: string;
  url: string;
  title: string;
  agent_id: string;
  viewing_status: string;
  agents: {
    name: string;
    phone: string;
  } | null;
}

/**
 * Process listings that need viewing timeslot requests
 * - Only sends to listings with status 'pending'
 * - Creates outreach records for tracking
 * - Updates listing status to 'requested'
 * 
 * @param limit - Maximum number of messages to send per run (default: 10)
 */
export async function sendViewingRequests(limit: number = 10): Promise<{
  success: boolean;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
}> {
  const supabase = getSupabaseClient();
  const results = {
    success: true,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  // Try to acquire lock
  // Use hash of job name as lock key
  const lockKey = JOB_NAME.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const acquired = await tryAdvisoryLock(lockKey);

  if (!acquired) {
    console.log(`⏳ [${JOB_NAME}] Job already running, skipping...`);
    results.skipped = limit;
    return results;
  }

  try {
    console.log(`🚀 [${JOB_NAME}] Starting viewing request job...`);

    // Fetch listings that need viewing requests
    // - viewing_status = 'pending' (not yet requested)
    // - Has agent information
    // - Has title (for message)
    const { data: listings, error: fetchError } = await supabase
      .from('listings')
      .select(`
        id,
        url,
        title,
        agent_id,
        viewing_status,
        agents!inner(name, phone)
      `)
      .eq('viewing_status', 'pending')
      .not('agent_id', 'is', null)
      .not('title', 'is', null)
      .limit(limit) as { data: ListingWithAgent[] | null; error: unknown };

    if (fetchError) {
      const errorMsg = `Failed to fetch listings: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`;
      console.error(`❌ [${JOB_NAME}] ${errorMsg}`);
      results.errors.push(errorMsg);
      results.success = false;
      return results;
    }

    if (!listings || listings.length === 0) {
      console.log(`✅ [${JOB_NAME}] No pending listings found. All done!`);
      return results;
    }

    console.log(`📋 [${JOB_NAME}] Found ${listings.length} listings to process`);

    // Process each listing
    for (const listing of listings) {
      try {
        if (!listing.agents) {
          console.log(`⚠️  [${JOB_NAME}] Listing ${listing.id} has no agent, skipping...`);
          results.skipped++;
          continue;
        }

        const { name: agentName, phone: agentPhone } = listing.agents;
        const propertyTitle = listing.title || 'Property';
        const propertyUrl = listing.url;

        console.log(`📤 [${JOB_NAME}] Sending request for: ${propertyTitle}`);
        console.log(`   👤 Agent: ${agentName} (${agentPhone})`);

        // Send the viewing request
        const result = await sendViewingRequest(
          agentPhone,
          agentName,
          propertyTitle
        );

        if (result.success) {
          // Create outreach record
          const { error: outreachError } = await supabase
            .from('outreach')
            .insert({
              agent_id: listing.agent_id,
              listing_id: listing.id,
              channel: 'whatsapp',
              status: 'sent',
              message_text: `Viewing request for ${propertyTitle}`,
              wa_conversation_id: result.messageId,
            });

          if (outreachError) {
            console.error(`⚠️  Failed to create outreach record:`, outreachError);
          }

          // Update listing status
          const { error: updateError } = await supabase
            .from('listings')
            .update({
              viewing_status: 'requested',
              viewing_requested_at: new Date().toISOString(),
            })
            .eq('id', listing.id);

          if (updateError) {
            console.error(`⚠️  Failed to update listing status:`, updateError);
          }

          results.sent++;
          console.log(`✅ [${JOB_NAME}] Message sent successfully (${results.sent}/${limit})`);
        } else {
          results.failed++;
          const errorMsg = `Failed to send to ${agentPhone}: ${result.error}`;
          results.errors.push(errorMsg);
          console.error(`❌ [${JOB_NAME}] ${errorMsg}`);

          // Update listing status to failed
          await supabase
            .from('listings')
            .update({ viewing_status: 'failed' })
            .eq('id', listing.id);
        }

        // Small delay to avoid rate limiting (1 second between messages)
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        results.failed++;
        const errorMsg = `Error processing listing ${listing.id}: ${error}`;
        results.errors.push(errorMsg);
        console.error(`❌ [${JOB_NAME}] ${errorMsg}`);
      }
    }

    console.log(`\n📊 [${JOB_NAME}] Job completed:`);
    console.log(`   ✅ Sent: ${results.sent}`);
    console.log(`   ❌ Failed: ${results.failed}`);
    console.log(`   ⏭️  Skipped: ${results.skipped}`);

    return results;

  } catch (error) {
    console.error(`❌ [${JOB_NAME}] Unexpected error:`, error);
    results.success = false;
    results.errors.push(error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error');
    return results;
  } finally {
    // Release lock
    await advisoryUnlock(lockKey);
  }
}

