import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildScraperStatusPayload } from '@/lib/scraper/runtime-state';

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

      // Track last cleanup time to avoid excessive queries
      let lastCleanupTime = 0;
      const CLEANUP_INTERVAL = 30000; // Only run cleanup every 30 seconds

      // Send initial status
      const sendStatus = async () => {
        try {
          const now = Date.now();
          const shouldRunCleanup = (now - lastCleanupTime) >= CLEANUP_INTERVAL;

          if (shouldRunCleanup) {
            lastCleanupTime = now;
          }

          const statusData = await buildScraperStatusPayload(supabase, {
            reconcile: shouldRunCleanup,
          });
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(statusData)}\n\n`));

        } catch (error: any) {
          console.error('Error sending status:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'error', error: String(error) })}\n\n`));
        }
      };

      // Send status every 10 seconds (reduced frequency to avoid rate limits)
      // This endpoint makes multiple queries per call, so we need to be conservative
      await sendStatus();
      const interval = setInterval(sendStatus, 10000);

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
