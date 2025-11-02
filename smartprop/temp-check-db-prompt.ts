import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function checkDatabasePrompt() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  
  const { data, error } = await supabase
    .from('ai_prompts')
    .select('prompt_content')
    .eq('is_active', true)
    .single();
    
  if (error) {
    console.error('Error:', error);
    console.log('No active prompt found in database');
    return;
  }
  
  console.log('Active prompt from database:');
  console.log('='.repeat(50));
  console.log(data?.prompt_content || 'No active prompt found');
}

checkDatabasePrompt().catch((error) => console.error(error));