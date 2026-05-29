import { getActivePrompt, getAllPrompts } from '../src/lib/ai/prompt-manager';

async function checkActivePrompt() {
  console.log('🔍 Checking active AI prompt...\n');

  try {
    // Get active prompt
    const activePrompt = await getActivePrompt();
    
    if (activePrompt) {
      console.log('✅ Active prompt found in database:');
      console.log('Length:', activePrompt.length, 'characters');
      console.log('First 200 characters:');
      console.log(activePrompt.substring(0, 200) + '...\n');
    } else {
      console.log('❌ No active prompt found in database. Will use fallback prompt.\n');
    }

    // Get all prompts for context
    const allPrompts = await getAllPrompts();
    console.log(`📊 Total prompts in database: ${allPrompts.length}`);
    
    if (allPrompts.length > 0) {
      console.log('\nPrompt details:');
      allPrompts.forEach((prompt: unknown, index: number) => {
        console.log(`${index + 1}. ID: ${prompt.id}, Active: ${prompt.is_active}, Created: ${prompt.created_at}`);
        console.log(`   Name: ${prompt.name || 'Unnamed'}`);
        console.log(`   Length: ${prompt.prompt_content?.length || 0} characters\n`);
      });
    }

  } catch (error) {
    console.error('❌ Error checking active prompt:', error);
  }
}

checkActivePrompt();