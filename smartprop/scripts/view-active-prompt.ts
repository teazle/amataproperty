import { getActivePrompt } from '../src/lib/ai/prompt-manager';

async function viewActivePrompt() {
  console.log('📋 Viewing full active AI prompt...\n');

  try {
    const activePrompt = await getActivePrompt();
    
    if (activePrompt) {
      console.log('✅ ACTIVE PROMPT CONTENT:');
      console.log('=' .repeat(80));
      console.log(activePrompt);
      console.log('=' .repeat(80));
      console.log(`\nPrompt length: ${activePrompt.length} characters`);
    } else {
      console.log('❌ No active prompt found in database.');
    }

  } catch (error) {
    console.error('❌ Error viewing active prompt:', error);
  }
}

viewActivePrompt();