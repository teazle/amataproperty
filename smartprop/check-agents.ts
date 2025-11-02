import { getSupabaseClient } from './src/workers/supa';

async function checkAgents() {
  const supabase = getSupabaseClient();
  
  console.log('🔍 Checking all agents in database...\n');
  
  const { data: agents, error } = await supabase
    .from('agents')
    .select('*')
    .order('last_seen_at', { ascending: false });
    
  if (error) {
    console.log('❌ Error fetching agents:', error);
    return;
  }
  
  if (!agents || agents.length === 0) {
    console.log('📭 No agents found in database');
    return;
  }
  
  console.log(`📊 Found ${agents.length} agents:`);
  agents.forEach((agent, index) => {
    console.log(`${index + 1}. ID: ${agent.id}`);
    console.log(`   Name: ${agent.name}`);
    console.log(`   Phone: ${agent.phone}`);
    console.log(`   Email: ${agent.email || 'N/A'}`);
    console.log(`   Last Seen: ${agent.last_seen_at}`);
    console.log('');
  });
  
  // Also check outreach records
  console.log('🔍 Checking outreach records...\n');
  
  const { data: outreach, error: outreachError } = await supabase
    .from('outreach')
    .select('*')
    .order('created_at', { ascending: false });
    
  if (outreachError) {
    console.log('❌ Error fetching outreach:', outreachError);
    return;
  }
  
  if (!outreach || outreach.length === 0) {
    console.log('📭 No outreach records found');
    return;
  }
  
  console.log(`📊 Found ${outreach.length} outreach records:`);
  outreach.forEach((record, index) => {
    console.log(`${index + 1}. ID: ${record.id}`);
    console.log(`   Agent ID: ${record.agent_id}`);
    console.log(`   Status: ${record.status}`);
    console.log(`   Co-broking Status: ${record.co_broking_status}`);
    console.log(`   Phase: ${record.phase}`);
    console.log(`   Reply Text: ${record.reply_text}`);
    console.log(`   Created: ${record.created_at}`);
    console.log('');
  });
}

checkAgents().catch((error) => console.error(error));