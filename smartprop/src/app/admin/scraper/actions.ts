'use server'

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE!;
const supabase = createClient(supabaseUrl, supabaseKey);

export interface ScraperConfig {
  platform: 'propertyguru' | 'edgeprop';
  district?: string; // For PropertyGuru only (D01-D28)
  pages: number;
  minPrice?: number;
  maxPrice?: number;
}

export interface ScraperJobStatus {
  id: string;
  platform: string;
  status: string;
  currentDistrict?: string;
  currentPage?: number;
  totalPages?: number;
  listingsProcessed?: number;
  stats?: {
    saved: number;
    skipped: number;
    errors: number;
    phoneSuccessRate?: number;
  };
  startedAt: string;
  completedAt?: string;
  [key: string]: unknown;
  error?: string;
}

/**
 * Start a new scraper job
 */
export async function startScrapeJob(config: ScraperConfig) {
  try {
    // Check for active jobs
    const { data: activeJobs } = await supabase
      .from('scraper_jobs')
      .select('id, platform, started_at')
      .in('status', ['queued', 'running'])
      .limit(1);

    if (activeJobs && activeJobs.length > 0) {
      return {
        success: false,
        error: `Another scraper (${activeJobs[0].platform}) is already running. Please wait for it to complete.`
      };
    }

    // Validate config
    if (config.platform === 'propertyguru' && !config.district) {
      return {
        success: false,
        error: 'District is required for PropertyGuru scraper'
      };
    }

    if (config.platform === 'propertyguru') {
      // Validate district format
      const districtNum = config.district?.replace('D', '');
      const num = parseInt(districtNum || '0', 10);
      if (num < 1 || num > 28) {
        return {
          success: false,
          error: 'Invalid district. Must be D01-D28'
        };
      }
    }

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from('scraper_jobs')
      .insert({
        platform: config.platform,
        status: 'queued',
        config: config,
        total_pages: config.pages * (config.platform === 'propertyguru' ? 1 : 1), // 1 district at a time
      })
      .select()
      .single();

    if (jobError) {
      throw jobError;
    }

    // Trigger the scraper in background
    const cwd = path.join(process.cwd());
    // Find bun path - try common locations or use PATH
    const homeDir = process.env.HOME || '/home/ec2-user';
    const bunPath = process.env.BUN_PATH || `${homeDir}/.bun/bin/bun`;
    
    if (config.platform === 'propertyguru') {
      const district = config.district!.replace('D', '');
      // Use spawn with absolute path to bun for better control
      const logFile = `/tmp/pg-scraper-${job.id}.log`;
      const logFd = fs.openSync(logFile, 'a');
      
      const env = {
        ...process.env,
        PATH: `${homeDir}/.bun/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
        PG_DISTRICTS: district,
        PG_MAX_PAGES: config.pages.toString(),
        PG_JOB_ID: job.id,
        HOME: homeDir,
      };
      
      const child = spawn(bunPath, ['src/workers/pg.districts.ts'], {
        cwd,
        env,
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });
      
      // Close the file descriptor in the parent process
      fs.closeSync(logFd);
      child.unref(); // Allow parent process to exit independently
      
      console.log(`Started PG scraper with job ID: ${job.id}, PID: ${child.pid}, bun path: ${bunPath}`);
    } else {
      // EdgeProp scraper
      const logFile = `/tmp/ep-scraper-${job.id}.log`;
      const logFd = fs.openSync(logFile, 'a');
      
      const env = {
        ...process.env,
        PATH: `${homeDir}/.bun/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
        EP_MAX_PAGES: config.pages.toString(),
        EP_JOB_ID: job.id,
        HOME: homeDir,
      };
      
      const child = spawn(bunPath, ['src/workers/ep.live.ts'], {
        cwd,
        env,
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });
      
      // Close the file descriptor in the parent process
      fs.closeSync(logFd);
      child.unref(); // Allow parent process to exit independently
      
      console.log(`Started EP scraper with job ID: ${job.id}, PID: ${child.pid}, bun path: ${bunPath}`);
    }

    // Update job status to running
    await supabase
      .from('scraper_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', job.id);

    revalidatePath('/admin/scraper');

    return {
      success: true,
      jobId: job.id,
      message: `Scraper started for ${config.platform}${config.district ? ` - District ${config.district}` : ''}`
    };

  } catch (error) {
    console.error('Error starting scraper:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error) || 'Failed to start scraper'
    };
  }
}

/**
 * Check if a process is actually running
 */
async function isProcessRunning(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`kill -0 ${pid}`, (error) => {
      resolve(!error); // Process exists if no error
    });
  });
}

/**
 * Get current active scraper job status
 */
export async function getActiveJob(): Promise<ScraperJobStatus | null> {
  try {
    const { data: job } = await supabase
      .from('scraper_jobs')
      .select('*')
      .in('status', ['queued', 'running'])
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (!job) return null;

    // Also check lock file for real-time progress
    const lockFile = path.join(process.cwd(), 'storage', 
      job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');

    let lockData: { progress?: { currentDistrict?: string; currentPage?: number; listingsProcessed?: number } } | null = null;
    if (fs.existsSync(lockFile)) {
      lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
    }

    return {
      id: job.id,
      platform: job.platform,
      status: job.status,
      currentDistrict: lockData?.progress?.currentDistrict || job.current_district,
      currentPage: lockData?.progress?.currentPage || job.current_page,
      totalPages: job.total_pages,
      listingsProcessed: lockData?.progress?.listingsProcessed || job.listings_processed,
      stats: job.stats,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      error: job.error_message
    };

  } catch (error) {
    console.error('Error getting active job:', error);
    return null;
  }
}

/**
 * Get scraper job history
 */
export async function getJobHistory(limit: number = 10) {
  try {
    const { data: jobs, error } = await supabase
      .from('scraper_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return { success: true, jobs: jobs || [] };

  } catch (error) {
    console.error('Error getting job history:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error), jobs: [] };
  }
}

/**
 * Get district metadata
 */
export async function getDistrictMetadata() {
  try {
    const { data: districts, error } = await supabase
      .from('district_metadata')
      .select('*')
      .order('district', { ascending: true });

    if (error) throw error;

    return { success: true, districts: districts || [] };

  } catch (error) {
    console.error('Error getting district metadata:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error), districts: [] };
  }
}

/**
 * Get data quality metrics
 */
export async function getDataQualityMetrics() {
  try {
    // Get latest metrics for each platform
    const { data: metrics, error } = await supabase
      .from('scraper_metrics')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(2);

    if (error) throw error;

    // Calculate stale listings (not seen in 7+ days)
    const { count: staleCount } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .lt('scraped_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    // Get today's duplicates (upserted listings)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { count: totalToday } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .gte('scraped_at', today.toISOString());

    // Calculate completeness score
    const { data: recentListings } = await supabase
      .from('listings')
      .select('*')
      .order('scraped_at', { ascending: false })
      .limit(100);

    let completenessScore = 0;
    let phoneValidationRate = 0;

    if (recentListings && recentListings.length > 0) {
      const requiredFields = ['address', 'price', 'beds', 'baths', 'size_sqft'];
      const optionalFields = ['price_psf', 'year_built', 'tenure', 'property_type'];
      
      let totalScore = 0;
      let phoneCount = 0;

      recentListings.forEach((listing: unknown) => {
        const listingObj = listing as Record<string, unknown>;
        let listingScore = 0;
        
        // Required fields: 70% weight
        requiredFields.forEach(field => {
          if (listingObj[field] != null) listingScore += (0.7 / requiredFields.length);
        });
        
        // Optional fields: 30% weight
        optionalFields.forEach(field => {
          if (listingObj[field] != null) listingScore += (0.3 / optionalFields.length);
        });
        
        totalScore += listingScore;
      });

      completenessScore = (totalScore / recentListings.length);

      // Get agents for these listings and check phone rate
      const agentIds = recentListings.map((l: unknown) => (l as Record<string, unknown>).agent_id).filter(Boolean);
      const { data: agents } = await supabase
        .from('agents')
        .select('phone')
        .in('id', agentIds);

      if (agents) {
        phoneCount = agents.filter(a => a.phone && a.phone.length > 0).length;
        phoneValidationRate = phoneCount / agents.length;
      }
    }

    return {
      success: true,
      metrics: {
        completenessScore: Math.round(completenessScore * 100),
        phoneValidationRate: Math.round(phoneValidationRate * 100),
        duplicatesToday: totalToday || 0,
        staleListings: staleCount || 0
      }
    };

  } catch (error) {
    console.error('Error getting data quality metrics:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      metrics: {
        completenessScore: 0,
        phoneValidationRate: 0,
        duplicatesToday: 0,
        staleListings: 0
      }
    };
  }
}

/**
 * Trigger re-authentication for a platform
 */
export async function triggerReAuth(platform: 'propertyguru' | 'edgeprop') {
  try {
    const cwd = path.join(process.cwd());
    const authScript = platform === 'propertyguru' ? 'auth.pg.ts' : 'auth.ep.ts';
    const cmd = `cd ${cwd} && bun src/workers/${authScript}`;

    await execAsync(cmd);

    return {
      success: true,
      message: `Re-authentication completed for ${platform}`
    };

  } catch (error) {
    console.error('Error re-authenticating:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error) || 'Re-authentication failed'
    };
  }
}

/**
 * Check authentication status by reading state files
 */
export async function checkAuthStatus() {
  try {
    const pgStateFile = path.join(process.cwd(), 'storage', 'pg.state.json');
    const epStateFile = path.join(process.cwd(), 'storage', 'ep.state.json');

    const pgExists = fs.existsSync(pgStateFile);
    const epExists = fs.existsSync(epStateFile);

    let pgLastAuth = null;
    let epLastAuth = null;

    if (pgExists) {
      const stats = fs.statSync(pgStateFile);
      pgLastAuth = stats.mtime.toISOString();
    }

    if (epExists) {
      const stats = fs.statSync(epStateFile);
      epLastAuth = stats.mtime.toISOString();
    }

    return {
      success: true,
      auth: {
        propertyguru: {
          isAuthenticated: pgExists,
          lastAuth: pgLastAuth
        },
        edgeprop: {
          isAuthenticated: epExists,
          lastAuth: epLastAuth
        }
      }
    };

  } catch (error) {
    console.error('Error checking auth status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      auth: {
        propertyguru: { isAuthenticated: false, lastAuth: null },
        edgeprop: { isAuthenticated: false, lastAuth: null }
      }
    };
  }
}

/**
 * Get recent listings
 */
export async function getRecentListings(limit: number = 5) {
  try {
    const { data: listings, error } = await supabase
      .from('listings')
      .select(`
        *,
        agents:agent_id (name, phone, agency)
      `)
      .order('scraped_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return { success: true, listings: listings || [] };

  } catch (error) {
    console.error('Error getting recent listings:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error), listings: [] };
  }
}

/**
 * Stop active scraper job
 */
export async function stopScraperJob() {
  try {
    // Find active jobs
    const { data: activeJobs } = await supabase
      .from('scraper_jobs')
      .select('id, platform')
      .in('status', ['queued', 'running'])
      .limit(1);

    if (!activeJobs || activeJobs.length === 0) {
      return {
        success: false,
        error: 'No active scraper jobs found'
      };
    }

    const job = activeJobs[0];

    // Try to get PID from lock file and kill the process
    let pid: number | null = null;
    try {
      const lockFile = path.join(process.cwd(), 'storage', 
        job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');
      if (fs.existsSync(lockFile)) {
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
        pid = lockData.pid || null;
      }
    } catch (error) {
      console.log(`Could not read lock file for job ${job.id}:`, error);
    }

    if (pid && typeof pid === 'number' && pid > 0) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`Killed process ${pid} for job ${job.id}`);
      } catch (killError) {
        console.log(`Process ${pid} may have already stopped`);
      }
    }

    // Update job status to failed
    const { error: updateError } = await supabase
      .from('scraper_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: 'Stopped by user'
      })
      .eq('id', job.id);

    if (updateError) throw updateError;

    // Remove lock file
    const lockFile = path.join(process.cwd(), 'storage', 
      job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');
    
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
      console.log(`Removed lock file: ${lockFile}`);
    }

    revalidatePath('/admin/scraper');

    return {
      success: true,
      message: `Stopped ${job.platform} scraper job`
    };

  } catch (error) {
    console.error('Error stopping scraper:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Delete scraper job history
 */
export async function deleteScraperHistory() {
  try {
    // Delete all completed and failed jobs
    const { error } = await supabase
      .from('scraper_jobs')
      .delete()
      .in('status', ['completed', 'failed']);

    if (error) throw error;

    revalidatePath('/admin/scraper');

    return {
      success: true,
      message: 'Scraper history deleted successfully'
    };

  } catch (error) {
    console.error('Error deleting scraper history:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Delete specific scraper job
 */
export async function deleteScraperJob(jobId: string) {
  try {
    const { error } = await supabase
      .from('scraper_jobs')
      .delete()
      .eq('id', jobId);

    if (error) throw error;

    revalidatePath('/admin/scraper');

    return {
      success: true,
      message: 'Scraper job deleted successfully'
    };

  } catch (error) {
    console.error('Error deleting scraper job:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Force reset stuck jobs - marks all queued/running jobs as failed and removes lock files
 * Use this when jobs are stuck and can't be stopped normally
 */
export async function forceResetStuckJobs() {
  try {
    // Find all stuck jobs
    // Note: pid column may not exist in database, so we'll get it from lock files instead
    const { data: stuckJobs, error: queryError } = await supabase
      .from('scraper_jobs')
      .select('id, platform')
      .in('status', ['queued', 'running']);

    if (queryError) {
      console.error('Error querying stuck jobs:', queryError);
    }

    const jobsToReset = stuckJobs || [];
    const pidsToKill: Array<{ pid: number; jobId: string }> = [];

    // Collect PIDs and verify processes are actually running
    for (const job of jobsToReset) {
      let pid: number | null | undefined = null;
      
      // Try to get PID from lock file if not in database
      if (!pid) {
        try {
          const lockFile = path.join(process.cwd(), 'storage', 
            job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');
          
          if (fs.existsSync(lockFile)) {
            const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
            pid = lockData.pid || null;
          }
        } catch (error) {
          console.log(`Could not read lock file for job ${job.id}:`, error);
        }
      }

      if (pid && typeof pid === 'number' && pid > 0) {
        // Verify process is actually running before adding to kill list
        const isRunning = await isProcessRunning(pid);
        if (isRunning) {
          pidsToKill.push({ pid, jobId: job.id });
        } else {
          console.log(`Process ${pid} for job ${job.id} is not running, will just clean up database and lock file`);
        }
      }
    }

    // Kill all processes that are actually running
    const killPromises = pidsToKill.map(({ pid, jobId }) => {
      return new Promise<void>((resolve) => {
        // Try SIGTERM first
        exec(`kill -TERM ${pid}`, async (error) => {
          if (error) {
            // Try SIGKILL if TERM fails
            exec(`kill -KILL ${pid}`, async () => {
              // Wait a moment and verify it's gone
              await new Promise(resolve => setTimeout(resolve, 500));
              const stillRunning = await isProcessRunning(pid);
              if (!stillRunning) {
                console.log(`Successfully killed process ${pid} for job ${jobId}`);
              }
              resolve();
            });
          } else {
            // Wait a moment and check if still running
            await new Promise(resolve => setTimeout(resolve, 1000));
            const stillRunning = await isProcessRunning(pid);
            if (stillRunning) {
              // Try SIGKILL
              exec(`kill -KILL ${pid}`, () => {
                console.log(`Sent SIGKILL to process ${pid} for job ${jobId}`);
                resolve();
              });
            } else {
              console.log(`Process ${pid} for job ${jobId} terminated successfully`);
              resolve();
            }
          }
        });
      });
    });

    // Wait for all kills to complete
    await Promise.all(killPromises);

    // Mark all stuck jobs as failed - update by specific job IDs for reliability
    if (jobsToReset.length > 0) {
      const jobIds = jobsToReset.map(job => job.id);
      
      // Update each job individually to ensure they all get updated
      let updateCount = 0;
      for (const jobId of jobIds) {
        // Try update without pid first (pid column may not exist)
        const updateData: any = {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: 'Force reset by user - job was stuck'
        };
        
        const { error: updateError } = await supabase
          .from('scraper_jobs')
          .update(updateData)
          .eq('id', jobId);

        if (updateError) {
          console.error(`Error updating job ${jobId}:`, updateError);
        } else {
          updateCount++;
        }
      }

      console.log(`Successfully marked ${updateCount}/${jobsToReset.length} job(s) as failed`);
      
      // Wait a moment for database to propagate
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify the updates worked by checking the database multiple times
      let verificationAttempts = 0;
      const maxAttempts = 5;
      
      while (verificationAttempts < maxAttempts) {
        const { data: verifyJobs } = await supabase
          .from('scraper_jobs')
          .select('id, status')
          .in('id', jobIds);
        
        const stillActive = verifyJobs?.filter(j => j.status === 'queued' || j.status === 'running');
        
        if (!stillActive || stillActive.length === 0) {
          // All jobs successfully updated
          break;
        }
        
        console.warn(`Attempt ${verificationAttempts + 1}: ${stillActive.length} job(s) still show as active, retrying...`);
        
        // Force update again for jobs that are still active
        for (const job of stillActive) {
          const retryUpdateData: any = {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: 'Force reset by user - job was stuck'
          };
          
          await supabase
            .from('scraper_jobs')
            .update(retryUpdateData)
            .eq('id', job.id);
        }
        
        // Wait before next verification
        await new Promise(resolve => setTimeout(resolve, 500));
        verificationAttempts++;
      }
    }

    // Remove all lock files
    const pgLockFile = path.join(process.cwd(), 'storage', 'pg-scraper.lock');
    const epLockFile = path.join(process.cwd(), 'storage', 'ep-scraper.lock');

    try {
      if (fs.existsSync(pgLockFile)) {
        fs.unlinkSync(pgLockFile);
        console.log('Removed PG lock file');
      }
    } catch (error) {
      console.error('Error removing PG lock file:', error);
    }

    try {
      if (fs.existsSync(epLockFile)) {
        fs.unlinkSync(epLockFile);
        console.log('Removed EP lock file');
      }
    } catch (error) {
      console.error('Error removing EP lock file:', error);
    }

    try {
      revalidatePath('/admin/scraper');
    } catch (revalidateError) {
      console.error('Error revalidating path:', revalidateError);
    }

    // Final verification - make sure no jobs are still active
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for final propagation
    
    const { data: finalCheck } = await supabase
      .from('scraper_jobs')
      .select('id, status')
      .in('status', ['queued', 'running'])
      .limit(10);

    if (finalCheck && finalCheck.length > 0) {
      console.warn(`⚠️  Still found ${finalCheck.length} active job(s) after reset. Force updating individually...`);
      // Update each remaining job individually
      for (const job of finalCheck) {
        const finalUpdateData: any = {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: 'Force reset by user - job was stuck'
        };
        
        await supabase
          .from('scraper_jobs')
          .update(finalUpdateData)
          .eq('id', job.id);
      }
    }

    // One final check to confirm all jobs are reset
    await new Promise(resolve => setTimeout(resolve, 500));
    const { data: ultimateCheck } = await supabase
      .from('scraper_jobs')
      .select('id, status, platform, started_at')
      .in('status', ['queued', 'running'])
      .limit(10);

    const finalActiveCount = ultimateCheck?.length || 0;
    if (finalActiveCount > 0) {
      console.error(`⚠️  CRITICAL: ${finalActiveCount} job(s) still active after all reset attempts.`);
      console.error('Stuck jobs:', JSON.stringify(ultimateCheck, null, 2));
      
      // Try one more time with even more aggressive approach - direct SQL update
      const stuckJobIds = ultimateCheck?.map(j => j.id) || [];
      
      // Try using RPC or direct update with explicit error handling
      for (const stuckJob of ultimateCheck || []) {
        try {
          // Try updating with explicit where clause (without pid field)
          const finalUpdateData: any = {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: 'Force reset by user - job was stuck (final attempt)'
          };
          
          const { error: finalError, data: finalData } = await supabase
            .from('scraper_jobs')
            .update(finalUpdateData)
            .eq('id', stuckJob.id)
            .eq('status', stuckJob.status) // Only update if status hasn't changed
            .select();
          
          if (finalError) {
            console.error(`Failed to update job ${stuckJob.id}:`, finalError);
          } else {
            console.log(`Successfully updated job ${stuckJob.id} in final attempt`);
          }
        } catch (err) {
          console.error(`Exception updating job ${stuckJob.id}:`, err);
        }
      }
      
      // One more verification after final attempt
      await new Promise(resolve => setTimeout(resolve, 1000));
      const { data: lastCheck } = await supabase
        .from('scraper_jobs')
        .select('id, status, platform')
        .in('id', stuckJobIds);
      
      const stillStuck = lastCheck?.filter(j => j.status === 'queued' || j.status === 'running') || [];
      
      if (stillStuck.length > 0) {
        const stuckJobDetails = stillStuck.map(j => ({
          id: j.id,
          platform: j.platform,
          status: j.status
        }));
        
        return {
          success: false,
          error: `${stillStuck.length} job(s) could not be reset after multiple attempts. Job IDs: ${stillStuck.map(j => j.id).join(', ')}. Try using the diagnostic function or check database manually.`,
          jobsReset: jobsToReset.length - stillStuck.length,
          stuckJobs: stuckJobDetails
        };
      }
    }

    return {
      success: true,
      message: `Reset ${jobsToReset.length} stuck job(s)`,
      jobsReset: jobsToReset.length
    };

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error force resetting stuck jobs:', errorMsg);
    return {
      success: false,
      error: errorMsg || 'Unknown error occurred'
    };
  }
}

/**
 * Diagnose stuck jobs - returns detailed information about jobs that can't be reset
 */
export async function diagnoseStuckJobs() {
  try {
    // Get all active jobs
    const { data: activeJobs, error: queryError } = await supabase
      .from('scraper_jobs')
      .select('id, platform, status, started_at, error_message')
      .in('status', ['queued', 'running'])
      .order('started_at', { ascending: false });

    if (queryError) {
      return {
        success: false,
        error: `Error querying jobs: ${queryError.message}`,
        stuckJobs: []
      };
    }

    const stuckJobs = [];
    
    for (const job of activeJobs || []) {
      let pid: number | null | undefined = null;
      
      // Try to get PID from lock file
      try {
        const lockFile = path.join(process.cwd(), 'storage', 
          job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');
        
        if (fs.existsSync(lockFile)) {
          const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
          pid = lockData.pid || pid;
        }
      } catch (error) {
        // Ignore lock file errors
      }

      let isProcessRunningValue = false;
      if (pid && typeof pid === 'number' && pid > 0) {
        isProcessRunningValue = await isProcessRunning(pid);
      }

      stuckJobs.push({
        id: job.id,
        platform: job.platform,
        status: job.status,
        startedAt: job.started_at,
        pid: pid,
        isProcessRunning: isProcessRunningValue,
        hasLockFile: fs.existsSync(path.join(process.cwd(), 'storage', 
          job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock')),
        errorMessage: job.error_message,
        sqlFix: `UPDATE scraper_jobs SET status = 'failed', completed_at = NOW(), error_message = 'Manually fixed - job was stuck' WHERE id = '${job.id}';`
      });
    }

    return {
      success: true,
      stuckJobs: stuckJobs,
      count: stuckJobs.length
    };

  } catch (error) {
    console.error('Error diagnosing stuck jobs:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stuckJobs: []
    };
  }
}

/**
 * Force fix a specific stuck job by ID - uses multiple approaches
 */
export async function forceFixStuckJob(jobId: string) {
  try {
    // First, get the job details
    const { data: job, error: jobError } = await supabase
      .from('scraper_jobs')
      .select('id, platform, status')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return {
        success: false,
        error: `Job ${jobId} not found: ${jobError?.message || 'Unknown error'}`
      };
    }

    // Kill process if PID exists and process is running
    // Get PID from lock file (pid column doesn't exist in database)
    let pid: number | null | undefined = null;
    
      try {
        const lockFile = path.join(process.cwd(), 'storage', 
          job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');
        
        if (fs.existsSync(lockFile)) {
          const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
          pid = lockData.pid || null;
        }
      } catch (error) {
        // Ignore
    }

    if (pid && typeof pid === 'number' && pid > 0) {
      const processRunning = await isProcessRunning(pid);
      if (processRunning) {
        try {
          exec(`kill -TERM ${pid}`, async (error) => {
            if (error) {
              exec(`kill -KILL ${pid}`, () => {});
            } else {
              await new Promise(resolve => setTimeout(resolve, 1000));
              const stillRunning = await isProcessRunning(pid);
              if (stillRunning) {
                exec(`kill -KILL ${pid}`, () => {});
              }
            }
          });
        } catch (killError) {
          console.error(`Error killing process ${pid}:`, killError);
        }
      }
    }

    // Remove lock file
    try {
      const lockFile = path.join(process.cwd(), 'storage', 
        job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock');
      
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
    } catch (lockError) {
      console.error('Error removing lock file:', lockError);
    }

    // Try multiple update approaches
    const updateData: any = {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: 'Manually fixed - job was stuck'
    };

    // Only try to set pid if column might exist (will fail silently if it doesn't)
    try {
      updateData.pid = null;
    } catch (e) {
      // Ignore if pid column doesn't exist
    }

    // Approach 1: Standard update
    let { error: updateError } = await supabase
      .from('scraper_jobs')
      .update(updateData)
      .eq('id', jobId);

    if (updateError) {
      console.error('Standard update failed:', updateError);
      
      // Approach 2: Update without pid field
      const { pid: _, ...updateWithoutPid } = updateData;
      const { error: updateError2 } = await supabase
        .from('scraper_jobs')
        .update(updateWithoutPid)
        .eq('id', jobId);

      if (updateError2) {
        console.error('Update without pid also failed:', updateError2);
        return {
          success: false,
          error: `Could not update job. Database error: ${updateError2.message}. You may need to run SQL manually: UPDATE scraper_jobs SET status = 'failed', completed_at = NOW(), error_message = 'Manually fixed' WHERE id = '${jobId}';`,
          sqlFix: `UPDATE scraper_jobs SET status = 'failed', completed_at = NOW(), error_message = 'Manually fixed - job was stuck' WHERE id = '${jobId}';`
        };
      }
    }

    // Verify update worked
    await new Promise(resolve => setTimeout(resolve, 500));
    const { data: verifyJob } = await supabase
      .from('scraper_jobs')
      .select('id, status')
      .eq('id', jobId)
      .single();

    if (verifyJob && (verifyJob.status === 'queued' || verifyJob.status === 'running')) {
      return {
        success: false,
        error: `Job status still shows as '${verifyJob.status}' after update. This may indicate a database constraint issue. Please run SQL manually: UPDATE scraper_jobs SET status = 'failed', completed_at = NOW(), error_message = 'Manually fixed' WHERE id = '${jobId}';`,
        sqlFix: `UPDATE scraper_jobs SET status = 'failed', completed_at = NOW(), error_message = 'Manually fixed - job was stuck' WHERE id = '${jobId}';`
      };
    }

    revalidatePath('/admin/scraper');

    return {
      success: true,
      message: `Successfully fixed stuck job ${jobId}`
    };

  } catch (error) {
    console.error('Error force fixing stuck job:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

