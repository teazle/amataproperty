import { NextRequest } from 'next/server';
import { getSupabaseClient } from '../../../../workers/supa';

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
  const supabase = getSupabaseClient();

    const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;
      // Use supabase client created above

      // Send keepalive message every 30 seconds to keep connection alive
      const keepaliveInterval = setInterval(() => {
        if (!isClosed) {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch (error) {
            console.error('Error sending keepalive:', error);
            isClosed = true;
          }
        }
      }, 30000);

      // Send recent listings
      const sendRecentListings = async () => {
        if (isClosed) return;
        
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
            if (!isClosed) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`));
            }
            return;
          }

          const listingsData = {
            type: 'recent_listings',
            listings: listings || []
          };

          if (!isClosed) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(listingsData)}\n\n`));
          }

        } catch (error: any) {
          console.error('Error fetching recent listings:', error);
          if (!isClosed) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(error?.message || error) })}\n\n`));
          }
        }
      };

      // Send listings every 5 seconds
      try {
        await sendRecentListings();
      } catch (error) {
        console.error('Error in initial sendRecentListings:', error);
      }
      
      const interval = setInterval(() => {
        if (!isClosed) {
          sendRecentListings().catch((error) => {
            console.error('Error in periodic sendRecentListings:', error);
          });
        }
      }, 5000);

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        isClosed = true;
        clearInterval(interval);
        clearInterval(keepaliveInterval);
        try {
          controller.close();
        } catch (error) {
          // Ignore errors on close
        }
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
