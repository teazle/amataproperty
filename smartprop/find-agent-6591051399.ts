import { getSupabaseClient } from './src/workers/supa';

async function findAgent() {
  const supabase = getSupabaseClient();
  
  console.log('🔍 Finding agent with phone 6591051399...\n');
  
  const { data: agents, error } = await supabase
    .from('agents')
    .select('*')
    .eq('phone', '6591051399');
    
  if (error) {
    console.log('❌ Error finding agents:', error);
    return;
  }
  
  if (!agents || agents.length === 0) {
    console.log('📭 No agents found with phone 6591051399');
    return;
  }
  
  console.log(`📊 Found ${agents.length} agents with phone 6591051399:`);
  
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    console.log(`\n${i + 1}. Agent Details:`);
    console.log(`   ID: ${agent.id}`);
    console.log(`   Name: ${agent.name}`);
    console.log(`   Phone: ${agent.phone}`);
    console.log(`   Email: ${agent.email || 'N/A'}`);
    console.log(`   Agency: ${agent.agency || 'N/A'}`);
    console.log(`   Last Seen: ${agent.last_seen_at}`);
    
    // Find outreach records for this agent
    const { data: outreach, error: outreachError } = await supabase
      .from('outreach')
      .select('*')
      .eq('agent_id', agent.id)
      .order('created_at', { ascending: false });
      
    if (outreachError) {
      console.log('   ❌ Error fetching outreach:', outreachError);
      continue;
    }
    
    if (!outreach || outreach.length === 0) {
      console.log('   📭 No outreach records found for this agent');
      continue;
    }
    
    console.log(`   📊 Found ${outreach.length} outreach records:`);
    outreach.forEach((record, index) => {
      console.log(`   ${index + 1}. Outreach ID: ${record.id}`);
      console.log(`      Status: ${record.status}`);
      console.log(`      Co-broking Status: ${record.co_broking_status}`);
      console.log(`      Phase: ${record.conversation_phase || 'N/A'}`);
      console.log(`      Reply Text: ${record.reply_text || 'N/A'}`);
      console.log(`      Created: ${record.created_at}`);
      console.log('');
    });
  }
}

findAgent().catch((error) => console.error(error));