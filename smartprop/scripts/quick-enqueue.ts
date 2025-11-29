import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';
import { enqueueScraperJob } from '../src/lib/queue/scraper-queue.ts';

config({ path: path.resolve(process.cwd(), '.env.local') });

const jobId = process.argv[2];
if (!jobId) {
  console.error('Usage: bun scripts/quick-enqueue.ts <job-id>');
  process.exit(1);
}

await enqueueScraperJob({
  platform: 'edgeprop',
  config: { pages: 1, maxListings: 5 },
  jobId,
  priority: 1,
  source: 'manual',
  idempotencyKey: jobId,
});

console.log('✅ Job enqueued:', jobId);
process.exit(0);

