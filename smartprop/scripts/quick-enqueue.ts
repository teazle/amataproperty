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

// Get job details from database to determine platform and config
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRole);

const { data: job, error } = await supabase
  .from('scraper_jobs')
  .select('platform, config')
  .eq('id', jobId)
  .single();

if (error || !job) {
  console.error('Failed to fetch job:', error);
  process.exit(1);
}

await enqueueScraperJob({
  platform: job.platform as 'propertyguru' | 'edgeprop',
  config: job.config as { pages: number; district?: string; maxListings?: number },
  jobId,
  priority: 1,
  source: 'manual',
  idempotencyKey: jobId,
});

console.log('✅ Job enqueued:', jobId);
process.exit(0);

