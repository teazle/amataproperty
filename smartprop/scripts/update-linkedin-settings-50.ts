import { getLinkedInSettings, updateLinkedInSettings } from '../src/lib/linkedin/tracker';

async function updateSettings() {
  const current = await getLinkedInSettings();
  console.log('Current messages_per_job:', current?.messages_per_job);
  
  if (current) {
    console.log('\nUpdating messages_per_job to 50...');
    const updated = await updateLinkedInSettings({ messages_per_job: 50 });
    console.log('✅ Updated! New messages_per_job:', updated?.messages_per_job);
  } else {
    console.log('❌ No settings found');
  }
}

updateSettings().catch(console.error);
