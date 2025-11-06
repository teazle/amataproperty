import { NextRequest } from 'next/server';
import { getSupabaseClient } from '../../../../workers/supa';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

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

      // Send initial status
      const sendStatus = async () => {
        if (isClosed) return;
        
        try {
          // Get active job from database
          const { data: job, error: queryError } = await supabase
            .from('scraper_jobs')
            .select('*')
            .in('status', ['queued', 'running'])
            .order('started_at', { ascending: false })
            .limit(1)
            .single();

          if (queryError && queryError.code !== 'PGRST116') { // PGRST116 = no rows returned
            console.error('Error querying scraper_jobs:', queryError);
            if (!isClosed) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'error', error: queryError.message })}\n\n`));
            }
            return;
          }

          if (!job) {
            if (!isClosed) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'idle' })}\n\n`));
            }
            return;
          }

          // Verify process is actually running if we have a PID
          let pid: number | null | undefined = job.pid || null;
          let lockFile = path.join(process.cwd(), 'storage',
            job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');
          
          // Try to get PID from lock file if not in database
          if (!pid && fs.existsSync(lockFile)) {
            try {
              const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
              pid = lockData.pid || null;
            } catch (error) {
              // Ignore lock file read errors
            }
          }

          // Check if process is actually running
          if (pid && typeof pid === 'number' && pid > 0) {
            const processRunning = await new Promise<boolean>((resolve) => {
              exec(`kill -0 ${pid}`, (error: any) => {
                resolve(!error); // Process exists if no error
              });
            });

            if (!processRunning) {
              // Process is not running but job is marked as active - this is a stuck job
              console.warn(`Job ${job.id} is marked as ${job.status} but process ${pid} is not running. Reporting as idle.`);
              
              // Send idle status instead of active
              if (!isClosed) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'idle' })}\n\n`));
              }
              return;
            }
          } else if (fs.existsSync(lockFile) && !pid) {
            // Lock file exists but no PID - this is also a stuck state
            console.warn(`Job ${job.id} has lock file but no PID. Reporting as idle.`);
            if (!isClosed) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'idle' })}\n\n`));
            }
            return;
          }

          // Read lock file for real-time progress
          let progress = {
            currentDistrict: job.current_district,
            currentPage: job.current_page,
            listingsProcessed: job.listings_processed
          };
          let statusMessage = 'Scraping...';
          let realtimeStats = job.stats;

          try {
            if (fs.existsSync(lockFile)) {
              const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
              progress = lockData.progress || progress;
              statusMessage = lockData.statusMessage || statusMessage;
              // Use real-time stats from lock file if available
              realtimeStats = lockData.stats || job.stats;
            }
          } catch (fileError: any) {
            // Non-fatal error - just use database values
            console.warn('Error reading lock file:', fileError?.message);
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

          if (!isClosed) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(statusData)}\n\n`));
          }

        } catch (error: any) {
          console.error('Error sending status:', error);
          if (!isClosed) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'error', error: String(error?.message || error) })}\n\n`));
          }
        }
      };

      // Send status every 2 seconds
      try {
        await sendStatus();
      } catch (error) {
        console.error('Error in initial sendStatus:', error);
      }
      
      const interval = setInterval(() => {
        if (!isClosed) {
          sendStatus().catch((error) => {
            console.error('Error in periodic sendStatus:', error);
          });
        }
      }, 2000);

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

