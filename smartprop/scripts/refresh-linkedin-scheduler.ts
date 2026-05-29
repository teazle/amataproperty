/**
 * Refresh LinkedIn scheduler via API endpoint
 * This will work if the server is running
 * Run with: bun run scripts/refresh-linkedin-scheduler.ts
 */

async function refreshScheduler() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  console.log(`🔄 Refreshing LinkedIn scheduler via API...`);
  console.log(`   URL: ${baseUrl}/api/linkedin/scheduler/refresh\n`);

  try {
    const response = await fetch(`${baseUrl}/api/linkedin/scheduler/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Scheduler refreshed successfully!');
      console.log('   Response:', data);
    } else {
      console.error('❌ Failed to refresh scheduler');
      console.error('   Error:', data.error || data);
    }
  } catch (error) {
    console.error('❌ Error calling API:', error.message);
    console.error('\n💡 Make sure the server is running!');
    console.error('   Start with: bun run dev');
  }
}

refreshScheduler();
