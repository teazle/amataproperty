/**
 * PropertyGuru District-based Scraper
 * 
 * This script scrapes PropertyGuru listings by district (D01-D28)
 * with configurable price range.
 * 
 * Usage:
 *   bun src/workers/pg.districts.ts
 * 
 * Environment Variables:
 *   PG_DISTRICTS - Comma-separated list of districts to scrape (e.g., "01,09,10,11")
 *                  Default: All districts (01-28)
 *   PG_MIN_PRICE - Minimum price filter (default: 1000000)
 *   PG_MAX_PRICE - Maximum price filter (default: 3000000)
 *   PG_MAX_PAGES - Max pages per district (default: 3)
 * 
 * Examples:
 *   PG_DISTRICTS="09,10,11" bun src/workers/pg.districts.ts
 *   PG_DISTRICTS="01,02,03" PG_MAX_PAGES=5 bun src/workers/pg.districts.ts
 */

import { chromium, type Page, type BrowserContextOptions, type Browser, type BrowserContext } from 'playwright-ghost';
import plugins from 'playwright-ghost/plugins';
import path from 'path';
import fs from 'fs';
import { CHROME_UA, humanPause } from './stealth.js';
import { upsertAgentAndListing } from './upsert.js';
import { execSync, exec } from 'child_process';
import { supabase } from './supa.js';
import { 
  solveCloudflareWithFlaresolverr, 
  applyFlaresolverrToContext, 
  FLARESOLVERR_UA,
  createFlaresolverrSession
} from './flaresolverr.js';

// Helper function to re-authenticate if needed
async function reAuthenticate() {
  console.log('\n🔄 Re-authenticating to PropertyGuru...');
  try {
    // Use xvfb-run for headless environments (EC2)
    // Force Bun to not use cache by clearing cache and touching the file to invalidate cache
    // Clear any potential cache first, then touch the file to force recompilation
    execSync('rm -rf .bun/install/cache node_modules/.cache 2>/dev/null; touch src/workers/auth.pg.ts; true', { cwd: process.cwd() });
    execSync('xvfb-run -a bun --bun src/workers/auth.pg.ts', { 
      cwd: process.cwd(),
      stdio: 'inherit',
      timeout: 600000 // 10 minutes timeout for re-authentication
    });
    console.log('✅ Re-authentication complete!\n');
    return true;
  } catch (_error) {
    console.error('❌ Re-authentication failed:', _error);
    return false;
  }
}

// Import the existing scraper functions
function parsePrice(priceText: string): number | undefined {
  const match = priceText.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (match) {
    return parseFloat(match[1].replace(/,/g, ''));
  }
  return undefined;
}

function cleanPropertyTitle(title: string): string {
  if (!title) return title;
  
  let cleaned = title;
  
  // Remove PropertyGuru suffix
  cleaned = cleaned.replace(/\s*\|\s*PropertyGuru Singapore$/i, '');
  cleaned = cleaned.replace(/\s*\|\s*PropertyGuru$/i, '');
  
  // Remove EdgeProp suffix
  cleaned = cleaned.replace(/\s*\|\s*EdgeProp.*$/i, '');
  
  // Remove "For Sale at S$..." suffix
  cleaned = cleaned.replace(/\s+(For Sale|For Rent)\s+at\s+S\$.*$/i, '');
  
  // Remove just "For Sale" or "For Rent" at the end
  cleaned = cleaned.replace(/\s+(For Sale|For Rent)$/i, '');
  
  // Remove property type at the end if redundant
  cleaned = cleaned.replace(/\s+(Condominium|Apartment|HDB|Landed|Terrace)$/i, '');
  
  return cleaned.trim();
}

function cleanAddress(address: string): string {
  if (!address) return address;
  
  let cleaned = address;
  
  // Remove PropertyGuru suffix
  cleaned = cleaned.replace(/\s*\|\s*PropertyGuru Singapore$/i, '');
  cleaned = cleaned.replace(/\s*\|\s*PropertyGuru$/i, '');
  
  // Remove EdgeProp suffix
  cleaned = cleaned.replace(/\s*\|\s*EdgeProp.*$/i, '');
  
  // Remove "For Sale at S$..." suffix
  cleaned = cleaned.replace(/\s+(For Sale|For Rent)\s+at\s+S\$.*$/i, '');
  
  // Remove just "For Sale" or "For Rent" at the end
  cleaned = cleaned.replace(/\s+(For Sale|For Rent)$/i, '');
  
  // Remove property type at the end if redundant
  cleaned = cleaned.replace(/\s+(Condominium|Apartment|HDB|Landed|Terrace|Shophouse)$/i, '');
  
  return cleaned.trim();
}

async function extractPropertyDetails(page: Page, title: string): Promise<{
  beds: number | undefined;
  baths: number | undefined;
  size_sqft: number | undefined;
  price_psf: number | undefined;
  year_built: number | undefined;
  tenure: string | undefined;
  address: string | undefined;
  property_type: string | undefined;
}> {
  let beds: number | undefined;
  let baths: number | undefined;
  let size_sqft: number | undefined;
  let price_psf: number | undefined;
  let year_built: number | undefined;
  let tenure: string | undefined;
  let address: string | undefined;
  let property_type: string | undefined;

  try {
    console.log(`   🔍 Extracting structured details from PropertyGuru listing...`);

    // Extract amenities (beds, baths, size) from the amenities section
    const amenitiesSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.col-lg-8.col-md-12 > div.row > div > div.property-snapshot-section > div > div > div.amenities';
    const amenitiesText = await page.locator(amenitiesSelector).textContent().catch(() => '');

    if (amenitiesText) {
      console.log(`   📋 Amenities text: ${amenitiesText.substring(0, 100)}`);

      // Extract beds
      const bedsMatch = amenitiesText.match(/(\d+)\s*bed/i);
      if (bedsMatch) beds = parseInt(bedsMatch[1], 10);

      // Extract baths
      const bathsMatch = amenitiesText.match(/(\d+)\s*bath/i);
      if (bathsMatch) baths = parseInt(bathsMatch[1], 10);

      // Extract size
      const sizeMatch = amenitiesText.match(/(\d{1,4}(?:,\d{3})*)\s*sqft/i);
      if (sizeMatch) size_sqft = parseFloat(sizeMatch[1].replace(/,/g, ''));
    }

    // Extract details from the details section (tenure, year built, property type)
    // Column 1 has TOP/Year info, Column 2 has Tenure info
    const detailsCol1Selector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.col-lg-8.col-md-12 > div.row > div > section.details-section > div > table > tbody > tr:nth-child(2) > td:nth-child(1) > div > div > div > div';
    const detailsCol2Selector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.col-lg-8.col-md-12 > div.row > div > section.details-section > div > table > tbody > tr:nth-child(2) > td:nth-child(2) > div > div > div';
    
    const detailsTextCol1 = await page.locator(detailsCol1Selector).textContent().catch(() => '');
    const detailsTextCol2 = await page.locator(detailsCol2Selector).textContent().catch(() => '');
    
    // Combine both columns for parsing
    const detailsText = `${detailsTextCol1} ${detailsTextCol2}`;
    
    if (detailsText) {
      console.log(`   📋 Details text: ${detailsText.substring(0, 100)}`);
      
      // Extract tenure - look for "Freehold tenure", "Freehold", "99-year lease", "103-year lease", etc.
      const tenureMatch = detailsText.match(/(\d+[\s-]*years?(?:\s+lease)?|freehold(?:\s+tenure)?)/i);
      if (tenureMatch) {
        const cleanTenure = tenureMatch[1].trim();
        if (/\d/.test(cleanTenure)) {
          const numMatch = cleanTenure.match(/\d+/);
          tenure = numMatch ? `${numMatch[0]} years` : cleanTenure;
        } else {
          tenure = 'Freehold';
        }
      }
      
      // Extract year built
      const yearMatch = detailsText.match(/(?:TOP|Completed|Built).*?(\d{4})|(\b19\d{2}\b|\b20\d{2}\b)/i);
      if (yearMatch) {
        const year = parseInt(yearMatch[1] || yearMatch[2], 10);
        if (year >= 1900 && year <= 2030) {
          year_built = year;
        }
      }
    }

    // Extract property type from the property snapshot section
    // Look for various property type patterns
    const propertySnapshotSelector = 'div.property-snapshot-section';
    const snapshotText = await page.locator(propertySnapshotSelector).textContent().catch(() => '');
    
    // Try multiple patterns to catch all variations
    const propertyTypePatterns = [
      // Complex types first (more specific)
      /Executive\s+Condominium\s+for\s+(sale|rent)/i,
      /Cluster\s+House\s+for\s+(sale|rent)/i,
      /Walk[- ]up\s+[Aa]partment\s+for\s+(sale|rent)/i,
      /Semi[- ]Detached\s+for\s+(sale|rent)/i,
      /HDB\s+Flat\s+for\s+(sale|rent)/i,
      // Simple types
      /(Condominium|Apartment|HDB|Landed|Terrace|Detached|Bungalow|Townhouse)\s+for\s+(sale|rent)/i,
    ];
    
    if (snapshotText) {
      for (const pattern of propertyTypePatterns) {
        const match = snapshotText.match(pattern);
        if (match) {
          property_type = match[1] || match[0].split(' for ')[0];
          break;
        }
      }
    }

    // Extract price PSF using specific selector
    const pricePsfSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.col-lg-8.col-md-12 > div.row > div > div.property-snapshot-section > div > div > div.amenities > div.amenity.amenity-price-psf > div > p:nth-child(1)';
    const pricePsfText = await page.locator(pricePsfSelector).textContent().catch(() => '');
    if (pricePsfText) {
      const psfMatch = pricePsfText.match(/\$?\s*(\d{1,4}(?:,\d{3})*)/);
      if (psfMatch) {
        price_psf = parseFloat(psfMatch[1].replace(/,/g, ''));
      }
    }

    // Extract address using specific selector
    const addressSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.col-lg-8.col-md-12 > div.row > div > div.property-snapshot-section > div > div > p';
    const addressText = await page.locator(addressSelector).textContent().catch(() => '');
    if (addressText) {
      address = addressText.trim();
    } else if (title) {
      // Fallback to title if selector doesn't work
      address = title.replace(/^(For Sale|For Rent)\s*-?\s*/i, '').trim();
    }

    // Log extracted details
    console.log(`   📊 Extracted details:`);
    if (beds) console.log(`      🛏️  Beds: ${beds}`);
    if (baths) console.log(`      🚿 Baths: ${baths}`);
    if (size_sqft) console.log(`      📏 Size: ${size_sqft} sqft`);
    if (price_psf) console.log(`      💰 Price PSF: $${price_psf}`);
    if (year_built) console.log(`      📅 Year: ${year_built}`);
    if (tenure) console.log(`      📜 Tenure: ${tenure}`);
    if (property_type) console.log(`      🏠 Type: ${property_type}`);
    if (address) console.log(`      📍 Address: ${address}`);

  } catch (_error) {
    console.log(`   ⚠️  Error extracting property details: ${_error}`);
  }

  return {
    beds,
    baths,
    size_sqft,
    price_psf,
    year_built,
    tenure,
    address,
    property_type
  };
}

async function scrapePropertyGuruByDistrict() {
  // Check for active scraper lock
  const lockFile = path.join(process.cwd(), 'storage', 'pg-scraper.lock');
  
  if (fs.existsSync(lockFile)) {
    const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
    const lockAge = Date.now() - new Date(lockData.startedAt).getTime();
    
    // Check if the process is actually running
    let processRunning = false;
    if (lockData.pid) {
      try {
        // Try to send signal 0 to check if process exists (doesn't kill, just checks)
        process.kill(lockData.pid, 0);
        processRunning = true;
        console.log(`   ✓ Process ${lockData.pid} is running`);
      } catch (error: any) {
        // ESRCH means process doesn't exist
        if (error.code === 'ESRCH') {
          processRunning = false;
          console.log(`   ✗ Process ${lockData.pid} is NOT running (ESRCH)`);
        } else {
          // Other error, assume process might be running
          processRunning = true;
          console.log(`   ⚠ Process check error (assuming running): ${error.code || error.message}`);
        }
      }
    } else {
      console.log('   ⚠ No PID in lock file, cannot verify process');
    }
    
    // If process is not running, remove stale lock file
    if (!processRunning) {
      console.log('⚠️  Found stale lock file (process not running), removing...');
      console.log(`   Previous PID: ${lockData.pid || 'unknown'}`);
      console.log(`   Started: ${lockData.startedAt}`);
      if (lockData.districts) {
        console.log(`   Districts: ${lockData.districts}`);
      }
      fs.unlinkSync(lockFile);
    } else if (lockAge > 2 * 60 * 60 * 1000) {
      // If lock is older than 2 hours, assume stale and remove (even if process seems running)
      console.log('⚠️  Found stale lock file (>2h old), removing...');
      console.log(`   PID: ${lockData.pid || 'unknown'}`);
      console.log(`   Started: ${lockData.startedAt}`);
      if (lockData.districts) {
        console.log(`   Districts: ${lockData.districts}`);
      }
      fs.unlinkSync(lockFile);
    } else {
      console.error('❌ Another PropertyGuru scraper is already running!');
      console.error(`   Started: ${lockData.startedAt}`);
      console.error(`   PID: ${lockData.pid || 'unknown'}`);
      if (lockData.districts) {
        console.error(`   Districts: ${lockData.districts}`);
      }
      console.error('   Wait for it to complete or delete storage/pg-scraper.lock manually.');
      process.exit(1);
    }
  }

  // Parse configuration from environment
  const districtsInput = process.env.PG_DISTRICTS || 'ALL';
  const minPrice = parseInt(process.env.PG_MIN_PRICE || '1000000', 10);
  const maxPrice = parseInt(process.env.PG_MAX_PRICE || '3000000', 10);
  const maxPagesPerDistrict = parseInt(process.env.PG_MAX_PAGES || '3', 10);
  const maxListings = process.env.PG_MAX_LISTINGS ? parseInt(process.env.PG_MAX_LISTINGS, 10) : undefined;

  // Build district list
  let districts: string[] = [];
  const validDistricts = Array.from({ length: 28 }, (_, i) => (i + 1).toString().padStart(2, '0'));
  
  if (districtsInput === 'ALL') {
    // All Singapore districts (01-28)
    districts = validDistricts;
  } else {
    // Parse and validate districts
    const requestedDistricts = districtsInput.split(',').map(d => d.trim().padStart(2, '0'));
    
    // Validate each district
    for (const district of requestedDistricts) {
      if (!validDistricts.includes(district)) {
        console.error(`❌ Invalid district: ${district}. Must be 01-28.`);
        // Remove lock file before exit
        if (fs.existsSync(lockFile)) {
          try {
            fs.unlinkSync(lockFile);
            console.log('🔓 Lock file removed');
          } catch (e) {
            console.log('Could not remove lock file:', e);
          }
        }
        process.exit(1);
      }
      districts.push(district);
    }
  }
  
  if (districts.length === 0) {
    console.error('❌ No valid districts specified!');
    // Remove lock file before exit
    if (fs.existsSync(lockFile)) {
      try {
        fs.unlinkSync(lockFile);
        console.log('🔓 Lock file removed');
      } catch (e) {
        console.log('Could not remove lock file:', e);
      }
    }
    process.exit(1);
  }

  // Create lock file with job status
  const jobStatus = {
    startedAt: new Date().toISOString(),
    districts: districts.join(','),
    pid: process.pid,
    status: 'running',
    statusMessage: 'Starting scraper...',
    progress: {
      currentDistrict: null as string | null,
      currentPage: 0,
      totalPages: maxPagesPerDistrict * districts.length,
      listingsProcessed: 0
    },
    completedAt: undefined as string | undefined,
    stats: undefined as typeof overallStats | undefined
  };
  
  fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
  
  // Flag to track if we should stop gracefully
  let shouldStop = false;
  
  // CRITICAL: Browser cleanup function that ensures browsers are ALWAYS closed
  // Declare context variable outside so it's accessible in cleanup
  let context: BrowserContext | null = null;
  
  const cleanupBrowser = async (browserInstance: Browser | null, reason: string = 'cleanup') => {
    try {
      console.log(`🧹 Closing browser resources (${reason})...`);
      
      // Close context first, then browser
      if (context) {
        try {
          await context.close();
          console.log('✅ Context closed successfully');
        } catch (contextError) {
          console.error('⚠️  Error closing context:', contextError);
        }
        context = null;
      }
      
      if (browserInstance && browserInstance.isConnected()) {
        await browserInstance.close();
        console.log('✅ Browser closed successfully');
      }
    } catch (error) {
      console.error('⚠️  Error closing browser gracefully:', error);
      // Force kill Chromium processes if graceful close fails
      try {
        console.log('🔪 Attempting to force-kill Chromium processes...');
        exec('pkill -f "chromium|chrome" || true', (killError) => {
          if (killError && killError.code !== 1) { // code 1 means no processes found
            console.error('⚠️  Failed to force-kill Chromium:', killError);
          } else {
            console.log('✅ Force-killed Chromium processes');
          }
        });
      } catch (killError) {
        console.error('⚠️  Failed to force-kill Chromium processes:', killError);
      }
    }
  };

  // Handle stop signals gracefully - CRITICAL: Close browser BEFORE exiting
  const handleStopSignal = async (signal: string) => {
    console.log(`\n🛑 Received ${signal} signal - stopping scraper gracefully...`);
    shouldStop = true;
    
    // CRITICAL: Close browser FIRST before doing anything else
    await cleanupBrowser(browser, `signal: ${signal}`);
    
    // Update and remove lock file
    if (fs.existsSync(lockFile)) {
      try {
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
        lockData.status = 'stopped';
        lockData.statusMessage = `Stopped by ${signal} signal`;
        lockData.completedAt = new Date().toISOString();
        // Save completed status before removing
        fs.writeFileSync(lockFile.replace('.lock', '.completed.json'), JSON.stringify(lockData, null, 2));
        fs.unlinkSync(lockFile);
        console.log('🔓 Lock file removed');
      } catch (e) {
        console.log('Could not update/remove lock file:', e);
        // Try to remove anyway if update failed
        try {
          if (fs.existsSync(lockFile)) {
            fs.unlinkSync(lockFile);
          }
        } catch (removeError) {
          console.log('Could not remove lock file:', removeError);
        }
      }
    }
    
    // Update database if jobId exists
    const jobId = process.env.PG_JOB_ID;
    if (jobId) {
      try {
        // Use imported supabase client
        await supabase
          .from('scraper_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: `Stopped by ${signal} signal`
          })
          .eq('id', jobId);
      } catch (error) {
        console.error('Failed to update database:', error);
      }
    }
    
    // Clean up and exit
    process.exit(0);
  };
  
  // Register signal handlers
  process.on('SIGTERM', () => handleStopSignal('SIGTERM'));
  process.on('SIGINT', () => handleStopSignal('SIGINT'));
  
  // CRITICAL: Handle uncaught exceptions - close browser before crashing
  process.on('uncaughtException', async (error) => {
    console.error('❌ Uncaught exception:', error);
    await cleanupBrowser(browser, 'uncaughtException');
    process.exit(1);
  });
  
  // CRITICAL: Handle unhandled promise rejections - close browser before crashing
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
    await cleanupBrowser(browser, 'unhandledRejection');
    process.exit(1);
  });
  
  console.log('🚀 Starting PropertyGuru District-based Scraper...');
  console.log(`📍 Districts to scrape: ${districts.join(', ')}`);
  console.log(`💰 Price range: $${minPrice.toLocaleString()} - $${maxPrice.toLocaleString()}`);
  console.log(`📄 Max pages per district: ${maxPagesPerDistrict}`);
  if (maxListings) {
    console.log(`📊 Max listings to scrape: ${maxListings}`);
  }
  console.log(`🔧 Environment: PG_DISTRICTS=${process.env.PG_DISTRICTS}, PG_MAX_PAGES=${process.env.PG_MAX_PAGES}, PG_MAX_LISTINGS=${process.env.PG_MAX_LISTINGS || 'unlimited'}, PG_JOB_ID=${process.env.PG_JOB_ID}`);
  console.log('');

  const stateFilePath = path.join(process.cwd(), 'storage', 'pg.state.json');
  const hasStorageState = fs.existsSync(stateFilePath);
  
  if (!hasStorageState) {
    console.log('⚠️  No storage state found - running without authentication');
    console.log('💡 Run `bun run auth:pg` first to save login state\n');
  }

  // Check if auth state file exists and is recent (less than 24 hours old)
  const stateFileExists = fs.existsSync(stateFilePath);
  let shouldReAuth = !stateFileExists;
  
  if (stateFileExists) {
    const stats = fs.statSync(stateFilePath);
    const ageInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    if (ageInHours > 24) {
      console.log(`⚠️  Auth state file is ${ageInHours.toFixed(1)} hours old, re-authenticating...`);
      shouldReAuth = true;
    } else {
      console.log(`✅ Using existing auth state file (${ageInHours.toFixed(1)} hours old)`);
    }
  }
  
  // Re-authenticate only if needed
  if (shouldReAuth) {
    console.log('🔄 Re-authenticating before scraping to ensure fresh session...');
    const authSuccess = await reAuthenticate();
    
    if (!authSuccess) {
      console.error('❌ Re-authentication failed! Cannot proceed without authentication.');
      // Update lock file and database, then remove lock file
      if (fs.existsSync(lockFile)) {
        try {
          jobStatus.status = 'failed';
          jobStatus.statusMessage = 'Re-authentication failed';
          jobStatus.completedAt = new Date().toISOString();
          fs.writeFileSync(lockFile.replace('.lock', '.completed.json'), JSON.stringify(jobStatus, null, 2));
          fs.unlinkSync(lockFile);
          console.log('🔓 Lock file removed');
        } catch (e) {
          console.log('Could not update/remove lock file:', e);
          // Try to remove anyway
          try {
            if (fs.existsSync(lockFile)) {
              fs.unlinkSync(lockFile);
            }
          } catch (removeError) {
            console.log('Could not remove lock file:', removeError);
          }
        }
      }
      
      const jobId = process.env.PG_JOB_ID;
      if (jobId) {
        try {
          // Use imported supabase client
          await supabase
            .from('scraper_jobs')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: 'Re-authentication failed'
            })
            .eq('id', jobId);
        } catch (error) {
          console.error('Failed to update database:', error);
        }
      }
      
      process.exit(1);
    }
    
    // Verify auth state exists after re-auth
    const updatedStateExists = fs.existsSync(stateFilePath);
    if (!updatedStateExists) {
      console.error('❌ Authentication state file not found after re-authentication!');
      // Update lock file and database, then remove lock file
      if (fs.existsSync(lockFile)) {
        try {
          jobStatus.status = 'failed';
          jobStatus.statusMessage = 'Authentication state file not found';
          jobStatus.completedAt = new Date().toISOString();
          fs.writeFileSync(lockFile.replace('.lock', '.completed.json'), JSON.stringify(jobStatus, null, 2));
          fs.unlinkSync(lockFile);
          console.log('🔓 Lock file removed');
        } catch (e) {
          console.log('Could not update/remove lock file:', e);
          // Try to remove anyway
          try {
            if (fs.existsSync(lockFile)) {
              fs.unlinkSync(lockFile);
            }
          } catch (removeError) {
            console.log('Could not remove lock file:', removeError);
          }
        }
      }
      
      const jobId = process.env.PG_JOB_ID;
      if (jobId) {
        try {
          // Use imported supabase client
          await supabase
            .from('scraper_jobs')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: 'Authentication state file not found'
            })
            .eq('id', jobId);
        } catch (error) {
          console.error('Failed to update database:', error);
        }
      }
      
      process.exit(1);
    }
  }
  
  // Final check: ensure auth state file exists before proceeding
  if (!fs.existsSync(stateFilePath)) {
    console.error('❌ Authentication state file not found! Cannot proceed.');
    // Update lock file and database, then remove lock file
    if (fs.existsSync(lockFile)) {
      try {
        jobStatus.status = 'failed';
        jobStatus.statusMessage = 'Authentication state file not found';
        jobStatus.completedAt = new Date().toISOString();
        fs.writeFileSync(lockFile.replace('.lock', '.completed.json'), JSON.stringify(jobStatus, null, 2));
        fs.unlinkSync(lockFile);
        console.log('🔓 Lock file removed');
      } catch (e) {
        console.log('Could not update/remove lock file:', e);
        // Try to remove anyway
        try {
          if (fs.existsSync(lockFile)) {
            fs.unlinkSync(lockFile);
          }
        } catch (removeError) {
          console.log('Could not remove lock file:', removeError);
        }
      }
    }
    
    process.exit(1);
  }
  

  // CRITICAL: Create a Flaresolverr session at the start to maintain cookies across all requests
  // Sessions retain cookies until destroyed, which is essential for Cloudflare bypass across multiple pages
  console.log('\n🔧 Creating Flaresolverr session for persistent cookie management...');
  const flaresolverrSessionId = await createFlaresolverrSession();
  if (flaresolverrSessionId) {
    console.log(`✅ Flaresolverr session created: ${flaresolverrSessionId}`);
    console.log('   ℹ️  This session will be reused for all requests to maintain Cloudflare cookies');
  } else {
    console.log('⚠️  Failed to create Flaresolverr session - will use temporary sessions (may cause cookie issues)');
  }

  // Launch browser once for all districts
  // Match Flaresolverr's browser fingerprint exactly for cookie compatibility
  const isHeadless = process.env.HEADLESS !== 'false' && process.env.HEADLESS !== '0'; // Default to headless unless explicitly disabled
  let browser: Browser | null = null;
  
  // Initialize overallStats BEFORE try block so it's accessible in finally block
  const overallStats = {
    totalDistricts: 0,
    totalListings: 0,
    totalSuccess: 0,
    totalErrors: 0,
    totalSkippedNoPhone: 0,
  };
  
  try {
    browser = await chromium.launch({
    headless: isHeadless, // Use headless mode on EC2/server environments
    plugins: [
      ...plugins.recommended({
        humanize: {
          click: { delay: { min: 200, max: 600 } },
          cursor: false,
          dialog: { delay: { min: 800, max: 2000 } }
        }
      }),
      // Additional plugins for better Cloudflare bypass (from Context7 research)
      plugins.utils.fingerprint(), // Randomize browser fingerprint
      plugins.polyfill.webGL(), // Mask WebGL fingerprinting
    ],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
    ]
  });

  // Don't set userAgent explicitly - let playwright-ghost handle it for better stealth
  // This matches the approach in auth.pg.ts for cookie compatibility
  
  const contextOptions: BrowserContextOptions = {
    // userAgent: removed - let playwright-ghost handle it
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 },
    colorScheme: 'light' as const,
    // Enhanced HTTP headers matching EdgeProp scraper (works on EC2)
    extraHTTPHeaders: {
      'Accept-Language': 'en-SG,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    }
  };

  // Always use the fresh auth state after re-auth
  contextOptions.storageState = stateFilePath;

  context = await browser.newContext(contextOptions);

  // Enhanced stealth script matching EdgeProp scraper (works on EC2)
  await context.addInitScript(() => {
    // Remove webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Mock chrome object
    (window as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome = {
      runtime: {},
    };
    
    // Override permissions API
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: PermissionDescriptor) => (
      (parameters as PermissionDescriptor & { name: string }).name === 'notifications' ?
        Promise.resolve({ state: Notification.permission } as PermissionStatus) :
        originalQuery(parameters)
    );
    
    // Mock plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Mock mimeTypes
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Override getBattery
    if ('getBattery' in navigator && typeof (navigator as any).getBattery === 'function') {
      (navigator as any).getBattery = () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1
      });
    }
  });

  let consecutiveNoPhone = 0;
  const MAX_CONSECUTIVE_NO_PHONE = 2; // Re-auth if 2 consecutive listings have no phone
  
  // Track processed URLs to avoid duplicates across pages
  const processedUrls = new Set<string>();
  
  // Track cookie saves to avoid excessive file I/O
  let listingsSinceLastCookieSave = 0;
  const COOKIE_SAVE_INTERVAL = 5; // Save cookies every 5 listings

  // Loop through each district
  for (const district of districts) {
    const districtCode = `D${district}`;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📍 Starting District ${district} (${districtCode})`);
    console.log(`${'='.repeat(60)}`);

    overallStats.totalDistricts++;

    // Track if Flaresolverr has been called for search page (to avoid multiple calls)
    let flaresolverrCalledForSearchPage = false;

    const page = await context.newPage();

    try {
      for (let pageNum = 1; pageNum <= maxPagesPerDistrict; pageNum++) {
        // Update job status
        jobStatus.progress.currentDistrict = district;
        jobStatus.progress.currentPage = pageNum;
        jobStatus.progress.listingsProcessed = overallStats.totalSuccess;
        jobStatus.statusMessage = `Scraping District ${district} - Page ${pageNum}/${maxPagesPerDistrict}`;
        fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
        
        // Build search URL with proper query string handling
        const baseUrl = 'https://www.propertyguru.com.sg/property-for-sale';
        const params = new URLSearchParams({
          listingType: 'sale',
          isCommercial: 'false',
          page: pageNum.toString(),
          minPrice: minPrice.toString(),
          maxPrice: maxPrice.toString(),
          districtCode: districtCode
        });
        const searchUrl = `${baseUrl}?${params.toString()}`;
        
        console.log(`\n📖 District ${district} - Page ${pageNum}/${maxPagesPerDistrict}...`);
        console.log(`🔗 URL: ${searchUrl}`);

        // Navigate with retry logic for Cloudflare (similar to EP scraper)
        let navigationSuccess = false;
        let navRetryCount = 0;
        const maxNavRetries = 3;
        
        while (!navigationSuccess && navRetryCount < maxNavRetries) {
          try {
              // Try Flaresolverr first if this is the first attempt for search page
              // Use useSession: false to prevent multiple Chrome instances and OOM kills
              if (navRetryCount === 0 && !flaresolverrCalledForSearchPage) {
              // IMPORTANT: Navigate to PropertyGuru domain first to ensure cookies from storageState are active
              // This ensures login cookies are properly loaded before applying Flaresolverr cookies
              try {
                await page.goto('https://www.propertyguru.com.sg', { waitUntil: 'domcontentloaded', timeout: 30000 });
                await humanPause(1000, 1500); // Give cookies time to be set
                console.log(`   🔐 Navigated to PropertyGuru domain to activate login cookies from storageState`);
              } catch (navError) {
                console.log(`   ⚠️  Pre-navigation failed, continuing anyway: ${navError}`);
              }
              
              // Use the persistent session for search page
              const flaresolverrResult = await solveCloudflareWithFlaresolverr(searchUrl, true, flaresolverrSessionId || undefined);
              
              if (flaresolverrResult && flaresolverrResult.cookies.length > 0) {
                // Apply cookies and user-agent from Flaresolverr
                await applyFlaresolverrToContext(context, flaresolverrResult);
                
                // Always save cookies immediately after search page (first fresh cookies)
                try {
                  await context.storageState({ path: stateFilePath });
                  console.log(`   💾 Saved fresh Cloudflare cookies to storage state (search page)`);
                  listingsSinceLastCookieSave = 0; // Reset counter after saving
                } catch (saveError) {
                  console.log(`   ⚠️  Failed to save cookies: ${saveError}`);
                }
                
                // Small delay to ensure cookies are set before navigation
                await humanPause(500, 1000);
                flaresolverrCalledForSearchPage = true;
              }
            }
            
            // Navigate to the page
            await page.goto(searchUrl, { 
              waitUntil: 'domcontentloaded', 
              timeout: 60000,
              // Add referer to make it look more natural
              referer: 'https://www.propertyguru.com.sg/',
            });
            await humanPause(3000, 5000); // Normal wait
            
            // Check for Cloudflare using EdgeProp's approach: check for actual errors AND content
            const pageText = await page.textContent('body').catch(() => null) || '';
            const pageTitle = await page.title().catch(() => '') || '';
            
            // Check for actual Cloudflare errors (not just Cloudflare presence)
            const hasActualError = pageText.includes('Pardon Our Interruption') || 
                                   pageText.includes('Verify you are human') ||
                                   pageText.includes('Enable JavaScript and cookies to continue') ||
                                   (pageText.includes('Just a moment') && pageText.length < 500) || // Short page = challenge page
                                   (pageTitle.includes('Just a moment') && pageText.length < 500);
            
            // Check for actual property content (positive check) - matching EdgeProp approach
            const hasPropertyContent = pageText.includes('Bed') || 
                                     pageText.includes('Bath') ||
                                     pageText.includes('sqft') ||
                                     pageText.includes('Property Type') ||
                                     pageText.includes('District') ||
                                     pageText.includes('Bedrooms') ||
                                     pageText.includes('Bathrooms') ||
                                     pageText.length > 10000 || // Large page = likely loaded
                                     (await page.locator('div.listing-card-v2').count().catch(() => 0) > 0);
            
            // If we have actual errors AND no property content, it's a real Cloudflare error
            if (hasActualError && !hasPropertyContent) {
              navRetryCount++;
              if (navRetryCount < maxNavRetries) {
                console.log(`   ⚠️  Cloudflare detected (attempt ${navRetryCount}/${maxNavRetries}), retrying...`);
                await humanPause(2000, 3000); // Short retry - if it can't solve, waiting won't help
                continue;
              } else {
                console.log(`   ❌ Cloudflare persists after ${maxNavRetries} attempts. Skipping this page.`);
                break;
              }
            }
            
            // If we have property content, page loaded successfully (even if it mentions cloudflare)
            if (hasPropertyContent) {
              console.log(`   ✅ Page loaded successfully (found property content)`);
              navigationSuccess = true;
            } else if (!hasActualError) {
              // No error and no content yet - wait a bit more
              if (navRetryCount < maxNavRetries - 1) {
                navRetryCount++;
                console.log(`   ⏳ Waiting for content to load (attempt ${navRetryCount}/${maxNavRetries})...`);
                await humanPause(3000, 5000);
                continue;
              } else {
                // Content didn't load but no error - assume success and continue
                navigationSuccess = true;
              }
            } else {
              // Has content despite error text - continue
              navigationSuccess = true;
            }
          } catch (e) {
            navRetryCount++;
            if (navRetryCount < maxNavRetries) {
              console.log(`   ⚠️  Navigation error (attempt ${navRetryCount}/${maxNavRetries}), retrying...`);
              await humanPause(3000, 5000);
            } else {
              console.log(`   ❌ Navigation failed after ${maxNavRetries} attempts:`, e);
              break;
            }
          }
        }
        
        if (!navigationSuccess) {
          console.log(`   ⚠️  Skipping page ${pageNum} due to navigation/Cloudflare issues`);
          break;
        }

        // Get organic listing cards - use broader selector to catch all variations
        // Some cards might have slightly different classes (e.g., RVG, Visioncrest)
        const cards = await page.locator('div.listing-card-v2').all();
        console.log(`📦 Found ${cards.length} listing cards (before filtering)`);

        if (cards.length === 0) {
          console.log(`⚠️  No listings found on page ${pageNum}. Moving to next district.`);
          break;
        }

        // Extract listing URLs - try multiple approaches to catch all cards
        const listingUrls: string[] = [];
        for (let cardIdx = 0; cardIdx < cards.length; cardIdx++) {
          const card = cards[cardIdx];
          
          // Check if this is a promoted/ad card and skip it
          const cardClass = await card.getAttribute('class').catch(() => null);
          if (cardClass && (cardClass.includes('promoted') || cardClass.includes('featured') || cardClass.includes('spotlight'))) {
            console.log(`   ⚠️  Card ${cardIdx + 1} is promoted/ad - skipping`);
            continue;
          }
          
          // Try to find link - some cards have different structures
          let link = await card.locator('a[href*="/listing/"]').first().getAttribute('href').catch(() => null);
          
          // If no link found, try getting any link within the card
          if (!link) {
            link = await card.locator('a[href*="/property/"]').first().getAttribute('href').catch(() => null);
          }
          
          // If still no link, try getting the first <a> tag
          if (!link) {
            const allLinks = await card.locator('a').all();
            for (const linkEl of allLinks) {
              const href = await linkEl.getAttribute('href').catch(() => null);
              if (href && (href.includes('/listing/') || href.includes('/property/'))) {
                link = href;
                break;
              }
            }
          }
          
          if (link && (link.includes('/listing/') || link.includes('/property/'))) {
            const fullUrl = link.startsWith('http') ? link : `https://www.propertyguru.com.sg${link}`;
            listingUrls.push(fullUrl);
          } else {
            console.log(`   ⚠️  Card ${cardIdx + 1} without valid listing link - skipping`);
          }
        }

        console.log(`📦 Extracted ${listingUrls.length} listing URLs\n`);

        // Process each listing
        for (let i = 0; i < listingUrls.length; i++) {
          const listingUrl = listingUrls[i];
          
          // Skip if already processed (duplicate across pages)
          if (processedUrls.has(listingUrl)) {
            console.log(`🏠 [D${district} - ${i + 1}/${listingUrls.length}] ⏭️  Skipping duplicate URL`);
            continue;
          }
          
          overallStats.totalListings++;
          processedUrls.add(listingUrl);

          console.log(`🏠 [D${district} - ${i + 1}/${listingUrls.length}] Processing...`);
          console.log(`   🔗 ${listingUrl}`);

          // CRITICAL: Use Flaresolverr on EACH listing URL to get URL-specific cookies
          // Cloudflare cookies are URL-path specific - cookies from one listing URL don't work for another
          // Using the same Flaresolverr session ensures cookies persist across requests
          // We MUST use Flaresolverr on each listing URL to get fresh cookies for that specific URL
          console.log(`   🔄 Solving Cloudflare for this listing URL...`);
          
          // Use Flaresolverr on the ACTUAL listing URL with the same session to maintain cookies
          const flaresolverrResult = await solveCloudflareWithFlaresolverr(listingUrl, true, flaresolverrSessionId || undefined);
          
          if (flaresolverrResult && flaresolverrResult.cookies.length > 0) {
            // Apply cookies to context BEFORE creating new page
            await applyFlaresolverrToContext(context, flaresolverrResult);
            
            // Save fresh cookies periodically (every 5 listings to avoid too many writes)
            if (listingsSinceLastCookieSave >= 5) {
              try {
                await context.storageState({ path: stateFilePath });
                console.log(`   💾 Saved Cloudflare cookies`);
                listingsSinceLastCookieSave = 0;
              } catch (saveError) {
                console.log(`   ⚠️  Failed to save cookies: ${saveError}`);
              }
            } else {
              listingsSinceLastCookieSave++;
            }
            
            // Wait for cookies to be fully applied to context
            await humanPause(2000, 3000);
          } else {
            console.log(`   ⚠️  Flaresolverr returned no cookies, continuing with existing cookies...`);
          }

          // NOW create the page - cookies are already applied to context and will be inherited
          let listingPage = await context.newPage();
          
          // Declare timeout variable outside try block so it's accessible in finally
          let listingTimeout: NodeJS.Timeout | null = null;
          let listingTimedOut = false;

          try {
            // Start timeout for listing processing
            listingTimeout = setTimeout(() => {
              console.log(`   ⏱️  Listing timeout (120s) - forcing close...`);
              listingTimedOut = true;
              listingPage.close().catch(() => {});
            }, 120000); // 120 seconds for page processing

            // Navigate directly to listing page - cookies are already in context and will be sent automatically
            // Playwright automatically sends cookies with the first request, no need to navigate to domain root first
            await listingPage.goto(listingUrl, { 
              waitUntil: 'domcontentloaded', // Use domcontentloaded - faster and more reliable than networkidle
              timeout: 60000,
              referer: 'https://www.propertyguru.com.sg/' // Add referer to make navigation look natural
            });
            
            // Check if timed out during navigation
            if (listingTimedOut) {
              throw new Error('Listing navigation timed out');
            }
            
            // Wait for page to fully load and any Cloudflare checks to complete
            // Give time for Cloudflare JavaScript to verify cookies (usually 2-5 seconds)
            await humanPause(3000, 5000);
            
            // Try to wait for key content elements to appear (more reliable than networkidle)
            // This ensures the page actually loaded content, not just Cloudflare challenge
            try {
              await Promise.race([
                listingPage.waitForSelector('div.property-snapshot-section, div.agent-section-desktop', { timeout: 15000 }).catch(() => null),
                listingPage.waitForSelector('body', { timeout: 5000 }).catch(() => null) // Fallback to body
              ]);
            } catch {
              // Continue anyway - page might have loaded or selectors might be different
            }
            
            // Scroll down to trigger lazy-loaded content and ensure all scripts execute
            await listingPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await humanPause(2000, 3000); // Give time for content to load after scroll
            
            if (listingTimedOut) {
              throw new Error('Listing processing timed out');
            }

            const title = await listingPage.title().catch(() => 'Untitled');

            // Extract price
            const priceSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.col-lg-8.col-md-12 > div.row > div > div.property-snapshot-section > div > div > div.price > h2';
            const priceText = await listingPage.locator(priceSelector).textContent().catch(() => '');
            const price = priceText ? parsePrice(priceText) : undefined;
            
            // Define selectors for reuse
            const ceaSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.agent-section-desktop.rich-contact--enabled.col-lg-4.col-md-12 > div > div > div > div > div.card-header > a > div.details-wrapper > span > div';
            const otherWaysButtonSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.agent-section-desktop.rich-contact--enabled.col-lg-4.col-md-12 > div > div > div > div > div.card-body > div > div.extended-view-root > div.actionable-link.contact-button-root.extend-view-trigger-point';
            
            // Check if we have actual property content FIRST (more reliable than checking for Cloudflare text)
            // Property content means the page loaded successfully, regardless of Cloudflare text in comments/cache
            const listingPageText = await listingPage.textContent('body').catch(() => null) || '';
            const hasPropertyContent = title && title !== 'Untitled' && title.length > 10 && 
                                      (priceText || listingPageText.includes('Bed') || listingPageText.includes('Bath') || listingPageText.length > 5000);
            
            // Only check for Cloudflare if we DON'T have property content
            // If content is available, ignore Cloudflare text (might be in comments, old cache, or transient)
            const hasCloudflareText = !hasPropertyContent && (
              listingPageText.includes('Pardon Our Interruption') || 
              listingPageText.includes('Verify you are human') ||
              listingPageText.includes('Enable JavaScript and cookies') ||
              (listingPageText.includes('Just a moment') && listingPageText.length < 1000) // Short page = challenge page
            );
            
            // If Cloudflare blocks AND we don't have content, skip this listing
            // Note: We already use Flaresolverr proactively on each listing URL, so this should rarely happen
            // If it does happen, it means Flaresolverr failed or Cloudflare detected something suspicious
            if (hasCloudflareText) {
              console.log(`   🛡️  Cloudflare detected on listing page (despite proactive refresh). Skipping...`);
              overallStats.totalErrors++;
              // Update stats in lock file immediately
              jobStatus.stats = overallStats;
              jobStatus.progress.listingsProcessed = overallStats.totalSuccess;
              fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
              await listingPage.close();
              if (listingTimeout) {
                clearTimeout(listingTimeout);
              }
              continue;
            }
            // If we reach here, content loaded successfully (hasPropertyContent is true)
            // Cloudflare text might appear in comments or old cached content, but if content loads, we're fine

            // Extract agent name
            const agentName = await listingPage.locator('.agent-section-desktop .card-header .details-wrapper .agent-name, div.agent-info div.details-wrapper div:first-child').first().textContent().catch(() => null);

            // Extract structured property details
            const propertyDetails = await extractPropertyDetails(listingPage, title);

            // Extract agency
            const agency = await listingPage.locator('.agent-section-desktop .card-header .details-wrapper .agency-name, [class*="agency"]').first().textContent().catch(() => null);

            // Extract CEA registration number
            const ceaText = await listingPage.locator(ceaSelector).textContent().catch(() => null);

            // Extract phone number
            let agentPhone = null;
            try {
              await humanPause(1000, 1500);

              const directPhoneLink = await listingPage.locator('a[href^="tel:"]').first().textContent({ timeout: 2000 }).catch(() => null);
              if (directPhoneLink) {
                agentPhone = directPhoneLink;
              } else {
                const otherWaysButton = listingPage.locator(otherWaysButtonSelector).first();
                const otherWaysVisible = await otherWaysButton.isVisible({ timeout: 5000 }).catch(() => false);

                if (otherWaysVisible) {
                  await otherWaysButton.click();
                  await humanPause(1500, 2000);

                  const viewPhoneButton = listingPage.locator('text=View Phone Number').first();
                  const viewPhoneVisible = await viewPhoneButton.isVisible({ timeout: 5000 }).catch(() => false);

                  if (viewPhoneVisible) {
                    await viewPhoneButton.click();
                    await humanPause(1500, 2500);
                    agentPhone = await listingPage.locator('a[href^="tel:"]').first().textContent({ timeout: 3000 }).catch(() => null);
                  }
                }
              }
            } catch (_error) {
              // Phone extraction failed
            }

            // Clean phone number
            let cleanPhone = '';
            if (agentPhone) {
              cleanPhone = agentPhone.replace(/[^\d]/g, '');
              if (cleanPhone && !cleanPhone.startsWith('65')) {
                if (cleanPhone.length === 8) {
                  cleanPhone = '65' + cleanPhone;
                }
              }
            }

            // Skip if no agent name
            if (!agentName) {
              console.log(`   ⚠️  Skipping - missing agent name`);
              overallStats.totalErrors++;
              // Update stats in lock file immediately
              jobStatus.stats = overallStats;
              jobStatus.progress.listingsProcessed = overallStats.totalSuccess;
              fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
              await listingPage.close();
              continue;
            }

            // Check for phone number - skip saving if not found to maintain data integrity
            if (!cleanPhone) {
              console.log(`   ⚠️  No phone number found - SKIPPING to maintain data integrity`);
              consecutiveNoPhone++;
              overallStats.totalSkippedNoPhone++;
              
              // Update stats in lock file immediately
              jobStatus.stats = overallStats;
              jobStatus.progress.listingsProcessed = overallStats.totalSuccess;
              fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
              
              // If we've had too many consecutive failures, trigger re-authentication
              if (consecutiveNoPhone >= MAX_CONSECUTIVE_NO_PHONE) {
                console.log(`\n🚨 ${consecutiveNoPhone} consecutive listings without phone numbers!`);
                console.log(`🔄 Authentication may have expired. Triggering re-login...\n`);
                
                // Update status message
                jobStatus.statusMessage = '🔄 Re-authenticating...';
                fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
                
                // CRITICAL: Close all pages and browser BEFORE re-authenticating
                console.log('🧹 Closing all pages and browser before re-authentication...');
                try {
                  await listingPage.close().catch(() => {});
                  await page.close().catch(() => {});
                  await cleanupBrowser(browser, 're-authentication');
                  browser = null; // Clear browser reference
                  
                  // Wait a moment to ensure browser processes are fully closed
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  console.log('✅ Browser closed, proceeding with re-authentication...');
                } catch (closeError) {
                  console.error('⚠️  Error closing browser before re-auth:', closeError);
                  // Continue anyway - cleanup will happen in finally block
                }
                
                // Re-authenticate
                const reAuthSuccess = await reAuthenticate();
                if (!reAuthSuccess) {
                  console.log('❌ Re-authentication failed. Stopping scraper.');
                  // Clean up lock file
                  if (fs.existsSync(lockFile)) {
                    fs.unlinkSync(lockFile);
                  }
                  process.exit(1);
                }
                
                // Update status message before removing lock
                jobStatus.statusMessage = '✅ Re-authenticated! Restarting in 2s...';
                fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
                
                console.log('✅ Re-authentication complete! Auto-restarting scraper...\n');
                console.log('🔄 Restarting with fresh authentication in 2 seconds...');
                
                // Wait a moment for UI to show the message
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Remove lock file to allow restart
                if (fs.existsSync(lockFile)) {
                  fs.unlinkSync(lockFile);
                }
                
                // CRITICAL: Ensure browser is fully closed before spawning new process
                // Wait additional time to ensure all Chromium processes are terminated
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Restart the entire scraping process with fresh authentication
                // Preserve the original environment variables from the admin page
                setTimeout(() => {
                  // Re-execute the same command that was originally started by the admin page
                  const cwd = process.cwd();
                  const districts = process.env.PG_DISTRICTS || 'ALL';
                  const maxPages = process.env.PG_MAX_PAGES || '3';
                  const jobId = process.env.PG_JOB_ID || '';
                  
                  const restartCmd = `cd ${cwd} && PG_DISTRICTS="${districts}" PG_MAX_PAGES=${maxPages} PG_JOB_ID="${jobId}" bun src/workers/pg.districts.ts > /tmp/pg-scraper-${jobId}.log 2>&1 &`;
                  
                  console.log(`🔄 Restarting with command: ${restartCmd}`);
                  exec(restartCmd, (error: unknown) => {
                    if (error) {
                      console.error('❌ Failed to restart scraper:', error);
                      process.exit(1);
                    }
                  });
                }, 1000); // Additional delay to ensure cleanup
                
                // Exit this process - new one will start
                process.exit(0);
              }
              
              await listingPage.close();
              continue;
            }
            
            // Reset consecutive counter if we got a phone
            consecutiveNoPhone = 0;

            // Use district from search URL (we know it from the districtCode parameter)
            const districtValue = district;

            // Clean the title and address before saving
            const cleanedTitle = title ? cleanPropertyTitle(title) : undefined;
            const cleanedAddress = propertyDetails.address ? cleanAddress(propertyDetails.address) : undefined;

            // Upsert data
            await upsertAgentAndListing({
              agent: {
                name: agentName.trim(),
                phone: cleanPhone,
                agency: agency?.trim(),
                cea_reg_no: ceaText?.trim(),
                source: 'propertyguru',
                source_url: listingUrl,
              },
              listing: {
                portal: 'propertyguru',
                url: listingUrl,
                title: cleanedTitle,
                price: price,
                district: districtValue,
                property_type: propertyDetails.property_type,
                beds: propertyDetails.beds,
                baths: propertyDetails.baths,
                size_sqft: propertyDetails.size_sqft,
                price_psf: propertyDetails.price_psf,
                year_built: propertyDetails.year_built,
                tenure: propertyDetails.tenure,
                address: cleanedAddress,
              },
            });

            console.log(`   ✅ Saved: ${agentName.trim()} - ${cleanPhone}`);
            console.log(`   🏠 Title: ${cleanedTitle}`);
            console.log(`   📍 District: ${districtValue}`);
            overallStats.totalSuccess++;
            
            // Check if we've reached max listings
            if (maxListings && overallStats.totalSuccess >= maxListings) {
              console.log(`\n🎯 Reached max listings limit (${maxListings}). Stopping scraper...`);
              shouldStop = true;
              break;
            }
            
            // Update stats and progress in lock file for real-time display
            jobStatus.stats = overallStats;
            jobStatus.progress.listingsProcessed = overallStats.totalSuccess;
            fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));

          } catch (_error) {
            const errorMsg = _error instanceof Error ? _error.message : String(_error);
            console.error(`   ❌ Error: ${errorMsg}`);
            overallStats.totalErrors++;
            
            // Update stats in lock file immediately after error
            jobStatus.stats = overallStats;
            jobStatus.progress.listingsProcessed = overallStats.totalSuccess;
            fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
            
            // If timeout, log it specifically
            if (listingTimedOut || errorMsg.includes('timeout')) {
              console.log(`   ⏭️  Skipping to next listing due to timeout`);
            }
          } finally {
            // Always clear timeout and close page
            if (listingTimeout) {
              clearTimeout(listingTimeout);
            }
            await listingPage.close().catch(() => {});
          }
        }
        
        // Check if we should stop after processing all listings on this page
        if (shouldStop) {
          break;
        }
      }
      
      // Check if we should stop after processing all pages in this district
      if (shouldStop) {
        break;
      }

    } catch (_error) {
      console.error(`❌ Error processing district ${district}:`, _error);
    } finally {
      // Always close page for this district
      await page.close().catch(() => {});
    }
    
    // Check if we should stop after processing this district
    if (shouldStop) {
      break;
    }
  }

  // Scraping completed successfully - mark as completed
  console.log('\n✅ All districts scraped successfully!');
  jobStatus.status = 'completed';
  jobStatus.statusMessage = 'Scraping completed successfully';
  if (typeof overallStats !== 'undefined') {
    jobStatus.progress.listingsProcessed = overallStats.totalSuccess;
    jobStatus.stats = overallStats;
  }
  // Update lock file with completion status before finally block
  if (fs.existsSync(lockFile)) {
    fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
  }

  } catch (error: unknown) {
    console.error('❌ Fatal error during scraping:', error);
    // Update lock file and database on error (lock file will be removed in finally block)
    jobStatus.status = 'failed';
    jobStatus.statusMessage = error instanceof Error ? error.message : 'Fatal error during scraping';
    jobStatus.completedAt = new Date().toISOString();
    if (typeof overallStats !== 'undefined') {
      jobStatus.progress.listingsProcessed = overallStats.totalSuccess;
      jobStatus.stats = overallStats;
    }
    
    const jobId = process.env.PG_JOB_ID;
    if (jobId) {
      try {
        // Use imported supabase client
        await supabase
          .from('scraper_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : 'Fatal error during scraping',
            listings_processed: typeof overallStats !== 'undefined' ? overallStats.totalSuccess : 0
          })
          .eq('id', jobId);
      } catch (dbError) {
        console.error('Failed to update database on error:', dbError);
      }
    }
  } finally {
    // CRITICAL: Always close browser to prevent resource leaks
    // Use cleanupBrowser to ensure proper cleanup even if browser.close() fails
    await cleanupBrowser(browser, 'finally block');
    browser = null; // Clear reference
    
    // Update database job status BEFORE removing lock file to prevent race condition
    const jobId = process.env.PG_JOB_ID;
    if (jobId && typeof overallStats !== 'undefined') {
      try {
        // Ensure status is set (should already be set above, but ensure it's set)
        if (!jobStatus.status || jobStatus.status === 'running') {
          jobStatus.status = 'completed';
        }
        jobStatus.statusMessage = jobStatus.statusMessage || 'Scraping completed';
        jobStatus.completedAt = jobStatus.completedAt || new Date().toISOString();
        jobStatus.progress.listingsProcessed = overallStats.totalSuccess;
        jobStatus.stats = overallStats;
        
        // Update database FIRST before removing lock file
        const finalStatus = jobStatus.status === 'failed' ? 'failed' : 'completed';
        await supabase
          .from('scraper_jobs')
          .update({
            status: finalStatus,
            completed_at: jobStatus.completedAt,
            listings_processed: overallStats.totalSuccess,
            stats: overallStats,
            current_page: jobStatus.progress.currentPage,
            current_district: jobStatus.progress.currentDistrict
          })
          .eq('id', jobId);
        console.log(`✅ Database job status updated to: ${finalStatus}`);
        console.log(`   Listings processed: ${overallStats.totalSuccess}`);
        console.log(`   Stats: saved=${overallStats.totalSuccess}, skipped=${overallStats.totalSkippedNoPhone}, errors=${overallStats.totalErrors}`);
      } catch (_error) {
        console.error('⚠️  Failed to update database job status:', _error);
        console.error('   Error details:', _error instanceof Error ? _error.message : String(_error));
      }
    }
    
    // Now remove lock file AFTER database update completes
    if (fs.existsSync(lockFile)) {
      try {
        // Update job status with final values (in case they weren't set above)
        jobStatus.status = jobStatus.status || 'completed';
        jobStatus.statusMessage = jobStatus.statusMessage || 'Scraping completed';
        jobStatus.completedAt = jobStatus.completedAt || new Date().toISOString();
        if (typeof overallStats !== 'undefined') {
          jobStatus.progress.listingsProcessed = overallStats.totalSuccess;
          jobStatus.stats = overallStats;
        }
        
        // Save completed/failed status to a separate file before removing lock
        fs.writeFileSync(lockFile.replace('.lock', '.completed.json'), JSON.stringify(jobStatus, null, 2));
        fs.unlinkSync(lockFile);
        console.log(`🔓 Lock file removed, job marked as ${jobStatus.status}\n`);
      } catch (e) {
        console.error('⚠️  Error removing lock file:', e);
        // Try one more time to remove it
        try {
          if (fs.existsSync(lockFile)) {
            fs.unlinkSync(lockFile);
            console.log('🔓 Lock file removed (retry)\n');
          }
        } catch (retryError) {
          console.error('❌ Could not remove lock file after retry:', retryError);
        }
      }
    }

    // Update district metadata for each scraped district
    // Note: districts is defined in outer scope, so it should be accessible here
    // Fallback: try to get districts from jobStatus if not accessible
    let districtsToUpdate = districts;
    if (!districtsToUpdate || districtsToUpdate.length === 0) {
      // Try to get from jobStatus (stored in completed file)
      try {
        const completedFile = lockFile.replace('.lock', '.completed.json');
        if (fs.existsSync(completedFile)) {
          const lockDataStr = fs.readFileSync(completedFile, 'utf-8');
          const lockData = JSON.parse(lockDataStr);
          if (lockData.districts) {
            districtsToUpdate = lockData.districts.split(',').map((d: string) => d.trim().padStart(2, '0'));
            console.log(`📋 Retrieved districts from completed file: ${districtsToUpdate.join(', ')}`);
          }
        }
      } catch (e) {
        console.log(`⚠️  Could not retrieve districts from completed file: ${e}`);
      }
    }
    
    if (typeof overallStats !== 'undefined' && districtsToUpdate && districtsToUpdate.length > 0) {
      console.log(`\n🔄 Updating district metadata for ${districtsToUpdate.length} district(s)...`);
      for (const district of districtsToUpdate) {
        const districtCode = `D${district}`;
        try {
          // Get count of listings for this district
          const { count, error: countError } = await supabase
            .from('listings')
            .select('*', { count: 'exact', head: true })
            .eq('district', district);

          if (countError) {
            console.error(`⚠️  Error counting listings for district ${districtCode}:`, countError);
          }

          const { error: upsertError } = await supabase
            .from('district_metadata')
            .upsert({
              district: districtCode,
              last_scraped_at: new Date().toISOString(),
              total_listings: count || 0,
              last_job_id: jobId
            }, {
              onConflict: 'district'
            });
          
          if (upsertError) {
            console.error(`⚠️  Failed to update district metadata for ${districtCode}:`, upsertError);
          } else {
            console.log(`✅ Updated metadata for district ${districtCode} (${count || 0} listings)`);
          }
        } catch (_error) {
          console.error(`⚠️  Failed to update district metadata for ${districtCode}:`, _error);
          console.error(`   Error details:`, _error instanceof Error ? _error.message : String(_error));
        }
      }

      // Final summary
      console.log(`\n${'='.repeat(60)}`);
      console.log('📊 Final Summary:');
      console.log(`${'='.repeat(60)}`);
      console.log(`Districts processed: ${overallStats.totalDistricts}`);
      console.log(`Total listings found: ${overallStats.totalListings}`);
      console.log(`Successfully saved: ${overallStats.totalSuccess}`);
      console.log(`Skipped (no phone): ${overallStats.totalSkippedNoPhone}`);
      console.log(`Errors: ${overallStats.totalErrors}`);
      console.log(`${'='.repeat(60)}\n`);
    } else {
      console.log(`⚠️  Skipping district metadata update: overallStats=${typeof overallStats}, districts=${districts ? districts.length : 'undefined'}`);
    }
  }
}

// The function now handles all errors internally with try-catch-finally
scrapePropertyGuruByDistrict();

