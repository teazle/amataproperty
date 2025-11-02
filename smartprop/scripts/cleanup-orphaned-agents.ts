/**
 * Cleanup Orphaned Agents
 * 
 * This script finds and removes agents that don't have any associated listings.
 * This can happen if a listing save fails but the agent was already created.
 * 
 * Usage:
 *   bun scripts/cleanup-orphaned-agents.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE!; // Need service role for delete

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanupOrphanedAgents() {
  console.log('🧹 Starting orphaned agents cleanup...\n');

  try {
    // Find agents without any listings
    const { data: orphanedAgents, error: findError } = await supabase
      .from('agents')
      .select('id, name, phone, source')
      .is('id', null) // This won't work, need a different approach
      
    // Better approach: Use a query to find agents with no listings
    const { data: allAgents, error: agentsError } = await supabase
      .from('agents')
      .select('id, name, phone, source, last_seen_at');

    if (agentsError) {
      throw agentsError;
    }

    console.log(`📊 Total agents in database: ${allAgents.length}`);

    // Check each agent for listings
    const orphaned: unknown[] = [];
    
    for (const agent of allAgents) {
      const { data: listings, error } = await supabase
        .from('listings')
        .select('id')
        .eq('agent_id', agent.id)
        .limit(1);

      if (error) {
        console.error(`Error checking agent ${agent.id}:`, error);
        continue;
      }

      if (!listings || listings.length === 0) {
        orphaned.push(agent);
      }
    }

    console.log(`🔍 Found ${orphaned.length} orphaned agents (no listings)\n`);

    if (orphaned.length === 0) {
      console.log('✅ No orphaned agents found! Database is clean.');
      return;
    }

    // Show orphaned agents
    console.log('Orphaned Agents:');
    orphaned.forEach((agent, i) => {
      console.log(`${i + 1}. ${agent.name} (${agent.phone}) - ${agent.source} - Last seen: ${agent.last_seen_at}`);
    });

    console.log('\n⚠️  These agents will be deleted.');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Delete orphaned agents
    const { error: deleteError } = await supabase
      .from('agents')
      .delete()
      .in('id', orphaned.map(a => a.id));

    if (deleteError) {
      throw deleteError;
    }

    console.log(`✅ Deleted ${orphaned.length} orphaned agents`);
    console.log('🎉 Cleanup complete!\n');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

cleanupOrphanedAgents().catch(console.error);

