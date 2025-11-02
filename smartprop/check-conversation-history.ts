import { getSupabaseClient } from './src/workers/supa';

async function checkConversationHistory() {
  const supabase = getSupabaseClient();
  
  console.log('🔍 Checking conversation history format...\n');
  
  const { data: outreach, error } = await supabase
    .from('outreach')
    .select('conversation_history')
    .eq('id', '8529aa53-ff4f-4235-89d2-ed4f8053b593')
    .single();
    
  if (error || !outreach) {
    console.log('❌ Error fetching outreach record:', error);
    return;
  }
  
  console.log('📜 Raw conversation_history value:');
  console.log('Type:', typeof outreach.conversation_history);
  console.log('Value:', outreach.conversation_history);
  console.log('');
  
  if (outreach.conversation_history) {
    console.log('📝 First 200 characters:');
    console.log(JSON.stringify(outreach.conversation_history).substring(0, 200));
    console.log('');
    
    // Try different parsing approaches
    console.log('🧪 Testing different parsing approaches:');
    
    try {
      if (typeof outreach.conversation_history === 'string') {
        const parsed = JSON.parse(outreach.conversation_history);
        console.log('✅ String parsing successful:', parsed);
      } else if (Array.isArray(outreach.conversation_history)) {
        console.log('✅ Already an array:', outreach.conversation_history);
      } else if (typeof outreach.conversation_history === 'object') {
        console.log('✅ Already an object:', outreach.conversation_history);
      }
    } catch (e: unknown) {
      console.log('❌ Parsing error:', e instanceof Error ? e.message : String(e));
    }
  }
}

checkConversationHistory().catch((error) => console.error(error));