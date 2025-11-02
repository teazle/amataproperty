'use server'

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
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
    
    if (config.platform === 'propertyguru') {
      const district = config.district!.replace('D', '');
      const cmd = `cd ${cwd} && PG_DISTRICTS="${district}" PG_MAX_PAGES=${config.pages} PG_JOB_ID="${job.id}" bun src/workers/pg.districts.ts > /tmp/pg-scraper-${job.id}.log 2>&1 &`;
      
      execAsync(cmd).catch(err => {
        console.error('Error starting PG scraper:', err);
      });
    } else {
      // EdgeProp scraper
      const cmd = `cd ${cwd} && EP_MAX_PAGES=${config.pages} EP_JOB_ID="${job.id}" bun src/workers/ep.live.ts > /tmp/ep-scraper-${job.id}.log 2>&1 &`;
      
      execAsync(cmd).catch(err => {
        console.error('Error starting EP scraper:', err);
      });
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
      .select('id, platform, pid')
      .in('status', ['queued', 'running'])
      .limit(1);

    if (!activeJobs || activeJobs.length === 0) {
      return {
        success: false,
        error: 'No active scraper jobs found'
      };
    }

    const job = activeJobs[0];

    // Kill the process if we have a PID
    if (job.pid) {
      try {
        process.kill(job.pid, 'SIGTERM');
        console.log(`Killed process ${job.pid} for job ${job.id}`);
      } catch (killError) {
        console.log(`Process ${job.pid} may have already stopped`);
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

