import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE!;

/**
 * Server-Sent Events endpoint for real-time scraper status updates
 * 
 * Usage from client:
 *   const eventSource = new EventSource('/api/scraper/status');
 *   eventSource.onmessage = (event) => {
 *     const status = JSON.parse(event.data);
 *     // Update UI
 *   };
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Send initial status
      const sendStatus = async () => {
        try {
          // Get active job from database
          const { data: job } = await supabase
            .from('scraper_jobs')
            .select('*')
            .in('status', ['queued', 'running'])
            .order('started_at', { ascending: false })
            .limit(1)
            .single();

          if (!job) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'idle' })}\n\n`));
            return;
          }

          // Read lock file for real-time progress
          const lockFile = path.join(process.cwd(), 'storage',
            job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');

          let progress = {
            currentDistrict: job.current_district,
            currentPage: job.current_page,
            listingsProcessed: job.listings_processed
          };
          let statusMessage = 'Scraping...';
          let realtimeStats = job.stats;

          if (fs.existsSync(lockFile)) {
            const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
            progress = lockData.progress || progress;
            statusMessage = lockData.statusMessage || statusMessage;
            // Use real-time stats from lock file if available
            realtimeStats = lockData.stats || job.stats;
          }

          const statusData = {
            status: 'active',
            job: {
              id: job.id,
              platform: job.platform,
              status: job.status,
              config: job.config,
              ...progress,
              totalPages: job.total_pages,
              stats: realtimeStats,
              startedAt: job.started_at,
              statusMessage: statusMessage
            }
          };

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(statusData)}\n\n`));

        } catch (error: any) {
          console.error('Error sending status:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'error', error: String(error) })}\n\n`));
        }
      };

      // Send status every 2 seconds
      await sendStatus();
      const interval = setInterval(sendStatus, 2000);

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

