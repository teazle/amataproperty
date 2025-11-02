import { getSupabaseClient } from './src/workers/supa';

async function checkMessages() {
  try {
    const supabase = getSupabaseClient();
    
    // Get the specific outreach record
    const { data, error } = await supabase
      .from('outreach')
      .select('*')
      .eq('id', '61666cc9-d9d8-4d27-bb0e-5f177a317766')
      .single();
    
    if (error) {
      console.error('Supabase error:', error);
      return;
    }
    
    if (!data) {
      console.log('No conversation found');
      return;
    }
    
    console.log('=== CONVERSATION DETAILS ===');
    console.log('Outreach ID:', data.id);
    console.log('Agent ID:', data.agent_id);
    console.log('Status:', data.status);
    console.log('Co-broking Status:', data.co_broking_status);
    console.log('Conversation Phase:', data.conversation_phase);
    console.log('Reply Text:', data.reply_text);
    console.log('Auto Reply Count:', data.auto_reply_count);
    console.log('Created At:', data.created_at);
    console.log('Updated At:', data.updated_at);
    
    console.log('\n=== CONVERSATION HISTORY ===');
    
    if (data.conversation_history) {
      const history = Array.isArray(data.conversation_history) 
        ? data.conversation_history 
        : JSON.parse(data.conversation_history);
      
      history.forEach((msg: any, i: number) => {
        console.log(`\n${i+1}. [${msg.role.toUpperCase()}] ${msg.timestamp}`);
        console.log(`   Message: ${msg.message}`);
        if (msg.metadata) {
          console.log(`   Metadata:`, JSON.stringify(msg.metadata, null, 2));
        }
      });
    } else {
      console.log('No conversation history found');
    }
    
    // Also get the agent details
    const { data: agentData } = await supabase
      .from('agents')
      .select('*')
      .eq('id', data.agent_id)
      .single();
    
    if (agentData) {
      console.log('\n=== AGENT DETAILS ===');
      console.log('Name:', agentData.name);
      console.log('Phone:', agentData.phone);
      console.log('Email:', agentData.email);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkMessages().catch((error) => console.error(error));