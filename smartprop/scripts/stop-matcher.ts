#!/usr/bin/env bun

/**
 * Stop Matcher Job Script
 * This script stops the running matcher job by releasing the advisory lock
 * 
 * Usage:
 *   bun scripts/stop-matcher.ts
 *   NEXT_PUBLIC_APP_URL=http://your-ec2-url:3000 bun scripts/stop-matcher.ts
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const API_URL = `${BASE_URL}/api/jobs/match`;

async function stopMatcher() {
  try {
    console.log('Stopping matcher job...');
    console.log(`API URL: ${API_URL}`);
    console.log('');

    const response = await fetch(API_URL, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    console.log(`Response Status: ${response.status}`);
    console.log('Response Body:');
    console.log(JSON.stringify(data, null, 2));
    console.log('');

    if (response.ok) {
      if (data.success) {
        console.log('✅ Matcher job stopped successfully!');
        process.exit(0);
      } else {
        console.log('ℹ️  No active matcher job found');
        console.log(`   ${data.message || 'The job may have already completed'}`);
        process.exit(0);
      }
    } else {
      console.error('❌ Failed to stop matcher job');
      console.error(`   Error: ${data.error || data.message || 'Unknown error'}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error stopping matcher job:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

stopMatcher();

