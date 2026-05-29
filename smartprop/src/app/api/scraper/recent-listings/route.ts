import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE!;

/**
 * Server-Sent Events endpoint for real-time recent listings updates
 * 
 * Usage from client:
 *   const eventSource = new EventSource('/api/scraper/recent-listings');
 *   eventSource.onmessage = (event) => {
 *     const listings = JSON.parse(event.data);
 *     // Update UI
 *   };
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Send recent listings
      const sendRecentListings = async () => {
        try {
          const { data: listings, error } = await supabase
            .from('listings')
            .select(`
              id,
              title,
              address,
              district,
              price,
              beds,
              baths,
              size_sqft,
              posted_at,
              scraped_at,
              agents:agent_id (name, phone, agency)
            `)
            .order('scraped_at', { ascending: false })
            .limit(5);

          if (error) {
            console.error('Error fetching recent listings:', error);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`));
            return;
          }

          const listingsData = {
            type: 'recent_listings',
            listings: listings || []
          };

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(listingsData)}\n\n`));

        } catch (error) {
    console.error('Error fetching recent listings:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(error) })}\n\n`));
        }
      };

      // Send listings every 30 seconds (reduced frequency to avoid rate limits)
      await sendRecentListings();
      const interval = setInterval(sendRecentListings, 30000);

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
