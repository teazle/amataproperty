#!/usr/bin/env bun

/**
 * Outreach Worker
 * Processes queued outreach messages and sends WhatsApp messages
 */

import { processOutreachMessages } from './src/jobs/match';

console.log('🚀 Starting outreach worker...');

async function runWorker() {
  try {
    const stats = await processOutreachMessages();
    console.log(`📊 Worker cycle completed: ${stats.processed} processed, ${stats.sent} sent, ${stats.failed} failed`);
  } catch (error) {
    console.error('❌ Worker error:', error);
  }
}

// Run immediately
await runWorker();

// Then run every 5 seconds
setInterval(async () => {
  await runWorker();
}, 5000);

console.log('⏰ Worker scheduled to run every 5 seconds');
