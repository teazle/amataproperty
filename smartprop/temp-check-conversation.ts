import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkConversation() {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('agent_phone', '6591051399')
    .order('created_at', { ascending: false })
    .limit(1);
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Conversation Data:', JSON.stringify(data[0], null, 2));
  
  // Also check conversation history
  const { data: history, error: historyError } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('conversation_id', data[0]?.id)
    .order('created_at', { ascending: true });
    
  if (historyError) {
    console.error('History Error:', historyError);
    return;
  }
  
  console.log('\nConversation History:');
  history?.forEach((msg, i) => {
    console.log(`${i + 1}. [${msg.sender}]: "${msg.message}"`);
  });
}

checkConversation().catch((error) => console.error(error));