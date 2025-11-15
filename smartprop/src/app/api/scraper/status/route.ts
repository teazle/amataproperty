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

      // Helper function to check if process is running
      const isProcessRunning = async (pid: number): Promise<boolean> => {
        try {
          const { execSync } = await import('child_process');
          execSync(`ps -p ${pid} > /dev/null 2>&1`);
          return true;
        } catch {
          return false;
        }
      };

      // Send initial status
      const sendStatus = async () => {
        try {
          // Check for stale locks and sync completed jobs
          const platforms = ['propertyguru', 'edgeprop'] as const;
          for (const platform of platforms) {
            const lockFile = path.join(process.cwd(), 'storage', 
              platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');
            const completedFile = lockFile.replace('.lock', '.completed.json');
            
            // First, check for completed.json files and sync them automatically
            if (fs.existsSync(completedFile) && !fs.existsSync(lockFile)) {
              try {
                const completedData = JSON.parse(fs.readFileSync(completedFile, 'utf-8'));
                if (completedData.status === 'completed') {
                  // Find matching job by platform and started_at time (within 1 hour window)
                  const startedAt = new Date(completedData.startedAt);
                  const windowStart = new Date(startedAt.getTime() - 60 * 60 * 1000); // 1 hour before
                  const windowEnd = new Date(startedAt.getTime() + 60 * 60 * 1000); // 1 hour after

                  const { data: matchingJobs } = await supabase
                    .from('scraper_jobs')
                    .select('id, status')
                    .eq('platform', platform)
                    .in('status', ['running', 'queued'])
                    .gte('started_at', windowStart.toISOString())
                    .lte('started_at', windowEnd.toISOString())
                    .order('started_at', { ascending: false })
                    .limit(1);

                  if (matchingJobs && matchingJobs.length > 0) {
                    const job = matchingJobs[0];
                    // Auto-sync: Update database to completed status
                    await supabase
                      .from('scraper_jobs')
                      .update({
                        status: 'completed',
                        completed_at: completedData.completedAt || new Date().toISOString(),
                        listings_processed: completedData.progress?.listingsProcessed || completedData.stats?.totalSuccess || 0,
                        stats: completedData.stats || null,
                        current_page: completedData.progress?.currentPage || null,
                        current_district: completedData.progress?.currentDistrict || null
                      })
                      .eq('id', job.id);
                    console.log(`✅ Status API: Auto-synced completed job ${job.id} for ${platform}`);
                  }
                }
              } catch (error) {
                console.error(`Error auto-syncing completed job for ${platform}:`, error);
              }
            }
            
            // Then check for stale locks
            if (fs.existsSync(lockFile)) {
              try {
                const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
                const pid = lockData.pid;
                
                if (pid && typeof pid === 'number') {
                  const isRunning = await isProcessRunning(pid);
                  if (!isRunning) {
                    // Stale lock detected - clean it up
                    console.log(`🧹 Status API: Cleaning stale lock file (process ${pid} not running)`);
                    fs.unlinkSync(lockFile);
                    
                    // Mark corresponding job as failed
                    const { data: jobs } = await supabase
                      .from('scraper_jobs')
                      .select('id, status')
                      .eq('platform', platform)
                      .in('status', ['queued', 'running'])
                      .order('started_at', { ascending: false })
                      .limit(1);
                    
                    if (jobs && jobs.length > 0) {
                      await supabase
                        .from('scraper_jobs')
                        .update({
                          status: 'failed',
                          completed_at: new Date().toISOString(),
                          error_message: 'Stale lock detected and cleaned'
                        })
                        .eq('id', jobs[0].id);
                    }
                  }
                }
              } catch (error) {
                // Lock file might be corrupted, try to remove it
                try {
                  fs.unlinkSync(lockFile);
                  console.log(`🧹 Status API: Removed corrupted lock file`);
                } catch {}
              }
            }
          }
          
          // Get active job from database - prefer job with lock file (actually running)
          // Get all active jobs first
          const { data: allActiveJobs } = await supabase
            .from('scraper_jobs')
            .select('*')
            .in('status', ['queued', 'running'])
            .order('started_at', { ascending: false });

          if (!allActiveJobs || allActiveJobs.length === 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'idle' })}\n\n`));
            return;
          }

          // Find job that has a lock file (actually running)
          let job = null;
          for (const activeJob of allActiveJobs) {
            const checkLockFile = path.join(process.cwd(), 'storage',
              activeJob.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');
            
            if (fs.existsSync(checkLockFile)) {
              // Check if process is actually running
              try {
                const lockData = JSON.parse(fs.readFileSync(checkLockFile, 'utf-8'));
                const pid = lockData.pid;
                if (pid && typeof pid === 'number') {
                  const isRunning = await isProcessRunning(pid);
                  if (isRunning) {
                    job = activeJob;
                    break; // Found a job that's actually running
                  }
                }
              } catch (e) {
                // Lock file exists but can't read it - skip this job
              }
            }
          }

          // If no job with lock file found, use the most recent one
          if (!job) {
            job = allActiveJobs[0];
          }

          if (!job) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'idle' })}\n\n`));
            return;
          }

          // Read lock file for real-time progress
          const lockFile = path.join(process.cwd(), 'storage',
            job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');
          const completedFile = lockFile.replace('.lock', '.completed.json');

          let progress = {
            currentDistrict: job.current_district,
            currentPage: job.current_page,
            listingsProcessed: job.listings_processed
          };
          let statusMessage = 'Scraping...';
          let realtimeStats = job.stats;

          // First try to read from lock file (active job)
          if (fs.existsSync(lockFile)) {
            try {
              const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
              progress = lockData.progress || progress;
              statusMessage = lockData.statusMessage || statusMessage;
              // Use real-time stats from lock file if available
              realtimeStats = lockData.stats || job.stats;
            } catch (e) {
              console.error('Error reading lock file:', e);
            }
          } 
          // If lock file doesn't exist, try reading from completed.json (recently completed job)
          else if (fs.existsSync(completedFile)) {
            try {
              const completedData = JSON.parse(fs.readFileSync(completedFile, 'utf-8'));
              progress = completedData.progress || progress;
              statusMessage = completedData.statusMessage || statusMessage;
              // Use stats from completed file if available
              realtimeStats = completedData.stats || job.stats;
            } catch (e) {
              console.error('Error reading completed file:', e);
            }
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

