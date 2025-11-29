import { config } from 'dotenv';
import path from 'path';

// Load environment variables from .env.local only
// CRITICAL: override: false ensures job-specific env vars (from queue worker) take precedence
// .env.local only provides defaults when env vars aren't already set
config({ 
  path: path.resolve(process.cwd(), '.env.local'),
  override: false  // Don't override existing env vars (set by queue worker from frontend config)
});

import { chromium, type BrowserContextOptions, type Browser, type BrowserContext } from 'playwright-ghost';
import plugins from 'playwright-ghost/plugins';
import fs from 'fs';
import { execSync } from 'child_process';
import { CHROME_UA, humanPause } from './stealth';
import { upsertAgentAndListing } from './upsert';
import { getSupabaseClient } from './supa';
import { solveCloudflareWithFlaresolverr, applyFlaresolverrToContext, FLARESOLVERR_UA, createFlaresolverrSession } from './flaresolverr';

// Helper function to re-authenticate if needed
async function reAuthenticate(): Promise<boolean> {
  console.log('\n🔄 Re-authenticating to EdgeProp...');
  try {
    // Use xvfb-run on Linux, direct bun on macOS (xvfb-run doesn't exist on macOS)
    const isLinux = process.platform === 'linux';
    const command = isLinux ? 'xvfb-run -a bun src/workers/auth.ep.ts' : 'bun src/workers/auth.ep.ts';
    
    execSync(command, { 
      cwd: process.cwd(),
      stdio: 'inherit',
      timeout: 300000 // 5 minute timeout (login can take time with Cloudflare)
    });
    console.log('✅ Re-authentication complete!\n');
    return true;
  } catch (error) {
    console.error('❌ Re-authentication failed:', error);
    return false;
  }
}

/**
 * Clean property title by removing portal suffixes and extra text
 * @param title - Raw title from page
 * @returns Cleaned title
 */
function cleanPropertyTitle(title: string): string {
  let cleaned = title;
  
  // Remove EdgeProp suffix
  cleaned = cleaned.replace(/\s*\|\s*EdgeProp.*$/i, '');
  
  // Remove "For Sale at S$..." suffix
  cleaned = cleaned.replace(/\s+(For Sale|For Rent)\s+at\s+S\$.*$/i, '');
  
  // Remove property type at the end if redundant
  cleaned = cleaned.replace(/\s+(Condominium|Apartment|HDB|Landed|Terrace)$/i, '');
  
  return cleaned.trim();
}

/**
 * Clean phone number by removing non-numeric characters and standardizing format
 * @param phoneText - Raw phone number text
 * @returns Cleaned phone number
 */
function cleanPhoneNumber(phoneText: string): string {
  if (!phoneText) return '';
  
  // Remove all non-numeric characters
  const cleaned = phoneText.replace(/[^\d]/g, '');
  
  // If it starts with 65, remove it (Singapore country code)
  const withoutCountryCode = cleaned.startsWith('65') ? cleaned.slice(2) : cleaned;
  
  // Return only if it's a valid Singapore phone number (8 digits)
  // Also handle cases where phone might be in format like "+65 97400311" or "tel:+6597400311"
  if (withoutCountryCode.length === 8) {
    return withoutCountryCode;
  }
  
  // Try to extract 8-digit number from longer strings
  const eightDigitMatch = withoutCountryCode.match(/(\d{8})/);
  if (eightDigitMatch) {
    return eightDigitMatch[1];
  }
  
  return '';
}

/**
 * Parse price string to number (in SGD)
 */
function parsePrice(priceStr: string): number | undefined {
  if (!priceStr) return undefined;
  
  const cleaned = priceStr.replace(/[$,\s]/g, '');
  
  if (cleaned.toLowerCase().includes('m')) {
    const num = parseFloat(cleaned.replace(/m/i, ''));
    return Math.round(num * 1000000);
  }
  
  if (cleaned.toLowerCase().includes('k')) {
    const num = parseFloat(cleaned.replace(/k/i, ''));
    return Math.round(num * 1000);
  }
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

// Removed unused extractDistrict function to clean up ESLint warnings

async function scrapeEdgePropFinal() {
  console.log('🚀 Starting Final EdgeProp Scraper...');
  
  const maxPages = parseInt(process.env.EP_MAX_PAGES || '10'); // Default to 10 pages
  const maxListings = process.env.EP_MAX_LISTINGS ? parseInt(process.env.EP_MAX_LISTINGS, 10) : undefined;
  const jobId = process.env.EP_JOB_ID;
  const stateFilePath = path.join(process.cwd(), 'storage', 'ep.state.json');
  const lockFile = path.join(process.cwd(), 'storage', 'ep-scraper.lock');
  const hasStorageState = fs.existsSync(stateFilePath);
  
  // Flag to track if we should stop gracefully
  let shouldStop = false;
  
  // Declare context variable outside so it's accessible in cleanup
  let context: BrowserContext | null = null;
  
  // CRITICAL: Browser cleanup function that ensures browsers are ALWAYS closed
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
        execSync('pkill -f "chromium|chrome" || true', { stdio: 'ignore' });
        console.log('✅ Force-killed Chromium processes');
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
    if (jobId) {
      try {
        const supabase = getSupabaseClient();
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
  
  // Check for existing lock file
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
      fs.unlinkSync(lockFile);
    } else if (lockAge > 2 * 60 * 60 * 1000) {
      // If lock is older than 2 hours, assume stale and remove (even if process seems running)
      console.log('⚠️  Found stale lock file (>2h old), removing...');
      console.log(`   PID: ${lockData.pid || 'unknown'}`);
      console.log(`   Started: ${lockData.startedAt}`);
      fs.unlinkSync(lockFile);
    } else {
      console.error('❌ Another EdgeProp scraper is already running!');
      console.error(`   Started: ${lockData.startedAt}`);
      console.error(`   PID: ${lockData.pid || 'unknown'}`);
      console.error('   Wait for it to complete or delete storage/ep-scraper.lock manually.');
      process.exit(1);
    }
  }
  
  console.log(`📍 Districts: ALL`);
  console.log(`💰 Price range: $1,000,000 - $3,000,000`);
  console.log(`📄 Max pages: ${maxPages}`);
  if (maxListings) {
    console.log(`📊 Max listings to scrape: ${maxListings}`);
  }
  console.log(`📁 Storage state: ${hasStorageState ? 'Found' : 'Not found'}`);
  console.log(`🔧 Job ID: ${jobId || 'Not provided'}, EP_MAX_LISTINGS=${process.env.EP_MAX_LISTINGS || 'unlimited'}`);
  
  // Create initial lock file for progress tracking
  const jobStatus = {
    startedAt: new Date().toISOString(),
    pid: process.pid,
    jobId: jobId || null,
    status: 'running',
    statusMessage: 'Starting scraper...',
    progress: {
      currentPage: 0,
      totalPages: maxPages,
      listingsProcessed: 0
    },
    stats: {
      totalSuccess: 0,
      totalSkippedNoPhone: 0,
      totalErrors: 0
    },
    completedAt: undefined as string | undefined
  };
  
  fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
  console.log('📝 Lock file created for progress tracking');
  
  // Check if auth state file exists and is recent (less than 24 hours old)
  const stateFileExists = fs.existsSync(stateFilePath);
  let shouldReAuth = !stateFileExists;
  
  // If state file exists, validate it's not corrupted
  if (stateFileExists) {
    try {
      const stateContent = fs.readFileSync(stateFilePath, 'utf-8');
      const stateData = JSON.parse(stateContent);
      // Check if state file has valid structure (should have cookies and origins)
      if (!stateData.cookies || !Array.isArray(stateData.cookies)) {
        console.log('⚠️  Auth state file appears corrupted (missing cookies), will re-authenticate');
        shouldReAuth = true;
      } else if (stateData.cookies.length === 0) {
        console.log('⚠️  Auth state file has no cookies, will re-authenticate');
        shouldReAuth = true;
      } else {
        // Check if cookies include session/auth cookies
        const hasSessionCookie = stateData.cookies.some((cookie: any) => 
          cookie.name.toLowerCase().includes('session') || 
          cookie.name.toLowerCase().includes('auth') ||
          cookie.name.toLowerCase().includes('token')
        );
        if (!hasSessionCookie) {
          console.log('⚠️  Auth state file missing session cookies, will re-authenticate');
          shouldReAuth = true;
        }
      }
    } catch (e) {
      console.log('⚠️  Auth state file is corrupted or invalid, will re-authenticate');
      shouldReAuth = true;
    }
  }
  
  if (stateFileExists) {
    const stats = fs.statSync(stateFilePath);
    const ageInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    if (ageInHours > 24) {
      console.log(`⚠️  Auth state file is ${ageInHours.toFixed(1)} hours old, re-authenticating...`);
      shouldReAuth = true;
    } else {
      console.log(`📁 Found auth state file (${ageInHours.toFixed(1)} hours old) - will verify login status before using`);
      // Don't set shouldReAuth = false here - we'll verify login status later
      // If login indicators aren't visible, we'll re-auth regardless of file age
    }
  }
  
  // Track if we just re-authenticated to prevent double re-auth
  let justReAuthenticated = false;
  
  // Re-authenticate only if needed
  if (shouldReAuth) {
    console.log('🔄 Re-authenticating before scraping to ensure fresh session...');
    const authSuccess = await reAuthenticate();
    
    if (!authSuccess) {
      console.error('❌ Re-authentication failed! Cannot proceed without authentication.');
      // Update lock file and database, then remove lock file
      jobStatus.status = 'failed';
      jobStatus.statusMessage = 'Re-authentication failed';
      jobStatus.completedAt = new Date().toISOString();
      
      if (fs.existsSync(lockFile)) {
        try {
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
      
      if (jobId) {
        try {
          const supabase = getSupabaseClient();
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
    
    // Mark that we just re-authenticated successfully
    justReAuthenticated = true;
    
    // Verify auth state exists after re-auth (only if we re-authenticated)
    const updatedStateExists = fs.existsSync(stateFilePath);
    if (!updatedStateExists) {
      console.error('❌ Authentication state file not found after re-authentication!');
      // Update lock file and database, then remove lock file
      jobStatus.status = 'failed';
      jobStatus.statusMessage = 'Authentication state file not found';
      jobStatus.completedAt = new Date().toISOString();
      
      if (fs.existsSync(lockFile)) {
        try {
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
      
      if (jobId) {
        try {
          const supabase = getSupabaseClient();
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
    jobStatus.status = 'failed';
    jobStatus.statusMessage = 'Authentication state file not found';
    jobStatus.completedAt = new Date().toISOString();
    
    if (fs.existsSync(lockFile)) {
      try {
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
  
  // CRITICAL: Declare browser at function scope so cleanup handlers can access it
  let browser: Browser | null = null;
  
  // Use playwright-ghost with recommended plugins for best stealth (same as PG scraper)
  browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false' && process.env.HEADLESS !== '0', // Allow headed mode for debugging
    plugins: [
      ...plugins.recommended({
        humanize: {
          click: { delay: { min: 200, max: 600 } },
          cursor: false,
          dialog: { delay: { min: 800, max: 2000 } }
        }
      }),
      // Additional plugins for better Cloudflare bypass
      plugins.utils.fingerprint(), // Randomize browser fingerprint
      plugins.polyfill.webGL(), // Mask WebGL fingerprinting
    ],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Additional stealth flags
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
    ]
  });

  // Only set storageState if the file exists and is valid
  const contextOptions: BrowserContextOptions = {
    userAgent: FLARESOLVERR_UA, // Match Flaresolverr's user-agent
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    // Enhanced HTTP headers matching Flaresolverr's browser
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
    },
  };
  
  // Only add storageState if file exists and browser is ready
  if (fs.existsSync(stateFilePath) && browser && !browser.isConnected() === false) {
    try {
      // Validate the state file before using it
      const stateContent = fs.readFileSync(stateFilePath, 'utf-8');
      const stateData = JSON.parse(stateContent);
      if (stateData.cookies && Array.isArray(stateData.cookies) && stateData.cookies.length > 0) {
        contextOptions.storageState = stateFilePath;
        console.log(`📁 Using auth state file with ${stateData.cookies.length} cookies`);
      } else {
        console.log('⚠️  Auth state file invalid, will authenticate fresh');
      }
    } catch (e) {
      console.log('⚠️  Could not validate auth state file, will authenticate fresh');
    }
  }

  context = await browser.newContext(contextOptions);
  
  // playwright-ghost handles most stealth automatically via plugins
  // Just add a minimal script to ensure webdriver is undefined (plugins handle the rest)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Fix __name error that EdgeProp's JavaScript expects
    if (typeof (window as any).__name === 'undefined') {
      (window as any).__name = function() { return ''; };
    }
  });
  
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalErrors = 0;
  let totalSkipped = 0; // Track duplicates/already processed
  const startTime = Date.now();
  let currentPage = 1;
  
  // Helper function to update lock file and database
  async function updateProgress(statusMessage?: string) {
    try {
      jobStatus.progress.currentPage = currentPage;
      jobStatus.progress.listingsProcessed = totalProcessed;
      jobStatus.stats.totalSuccess = totalSuccess;
      jobStatus.stats.totalSkippedNoPhone = totalSkipped;
      jobStatus.stats.totalErrors = totalErrors;
      if (statusMessage) {
        jobStatus.statusMessage = statusMessage;
      }
      fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
      
      // Update database job status periodically (every 5 listings or on page change)
      if (jobId && (totalProcessed % 5 === 0 || statusMessage?.includes('PAGE'))) {
        try {
          const supabase = getSupabaseClient();
          await supabase
            .from('scraper_jobs')
            .update({
              status: 'running',
              listings_processed: totalProcessed,
              progress: {
                currentPage,
                totalPages: maxPages,
                listingsProcessed: totalProcessed
              }
            })
            .eq('id', jobId);
        } catch (error) {
          console.error('Failed to update database job status:', error);
        }
      }
    } catch (error) {
      console.error('Failed to update progress:', error);
    }
  }

  let page = await context.newPage();

  try {
    // VERIFY LOGIN STATUS BEFORE SCRAPING
    console.log('\n🔐 Verifying login status...');
    let isLoggedIn = false;
    try {
      // Navigate to EdgeProp homepage to check login status
      await page.goto('https://www.edgeprop.sg', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanPause(2000, 3000);
      
      // Check for logged-in indicators
      const loginIndicators = [
        'a[href*="/user/logout"]',           // Logout link
        'a[href*="/user/"]:not([href*="/user/login"]):not([href*="/user/register"])', // User profile link
        '[class*="user-menu"]',               // User menu
        '[class*="logged-in"]',               // Logged-in class
        'button:has-text("Logout")',          // Logout button
        'button:has-text("Sign Out")'         // Sign out button
      ];
      
      for (const selector of loginIndicators) {
        try {
          const element = page.locator(selector).first();
          const count = await element.count();
          if (count > 0) {
            const isVisible = await element.isVisible({ timeout: 2000 }).catch(() => false);
            if (isVisible) {
              isLoggedIn = true;
              console.log(`   ✅ Login verified - found indicator: ${selector}`);
              break;
            }
          }
        } catch (e) {
          // Continue checking other indicators
        }
      }
      
      // Also check for NOT logged-in indicators
      if (!isLoggedIn) {
        const notLoggedInIndicators = [
          'a[href*="/user/login"]',           // Login link
          'button:has-text("Login")',         // Login button
          'button:has-text("Sign In")'        // Sign in button
        ];
        
        for (const selector of notLoggedInIndicators) {
          try {
            const element = page.locator(selector).first();
            const count = await element.count();
            if (count > 0) {
              const isVisible = await element.isVisible({ timeout: 2000 }).catch(() => false);
              if (isVisible) {
                console.log(`   ❌ Not logged in - found login link: ${selector}`);
                break;
              }
            }
          } catch (e) {
            // Continue
          }
        }
      }
      
      // Alternative: Check cookies for session/auth tokens
      const cookies = await context.cookies();
      const hasAuthCookie = cookies.some(cookie => 
        cookie.name.toLowerCase().includes('session') || 
        cookie.name.toLowerCase().includes('auth') ||
        cookie.name.toLowerCase().includes('login') ||
        cookie.name.toLowerCase().includes('user')
      );
      
      // If login indicators are not visible, skip cookie check and just re-authenticate
      if (!isLoggedIn) {
        console.log('   ⚠️  Login indicators not visible - will re-authenticate');
      }
      
    } catch (verifyError) {
      console.log(`   ⚠️  Login verification failed: ${verifyError}`);
    }
    
    // If login indicators are not visible, re-authenticate immediately
    // BUT: Skip if we just re-authenticated (auth state was just saved)
    if (!isLoggedIn && !justReAuthenticated) {
      console.log('\n⚠️  Login indicators not visible - re-authenticating now...');
      
      // Trigger re-authentication
      try {
        // Use xvfb-run on Linux, direct bun on macOS (xvfb-run doesn't exist on macOS)
        const isLinux = process.platform === 'linux';
        const authCommand = isLinux ? 'xvfb-run -a bun src/workers/auth.ep.ts' : 'bun src/workers/auth.ep.ts';
        
        execSync(authCommand, { 
          cwd: process.cwd(),
          stdio: 'inherit',
          timeout: 600000 // 10 minute timeout (login with Cloudflare can take 5-8 minutes)
        });
        
        // CRITICAL: Reload storage state after re-auth by recreating the context
        // Just adding cookies doesn't fully replace the session - we need a fresh context
        const freshStatePath = path.join(process.cwd(), 'storage', 'ep.state.json');
        if (fs.existsSync(freshStatePath)) {
          console.log('   🔄 Recreating browser context with fresh authentication state...');
          
          // Close existing page and context safely
          try {
            if (page && !page.isClosed()) {
              await page.close().catch(() => {});
            }
          } catch (e) {
            // Ignore errors closing page
          }
          
          try {
            // Check if browser is still connected before closing context
            const browserStillConnected = browser && !browser.isConnected() === false;
            
            if (context) {
              await context.close().catch(() => {});
            }
            
            // If browser is not connected, recreate it
            if (!browserStillConnected || !browser) {
              try {
                if (browser) {
                  await browser.close().catch(() => {});
                }
              } catch (e) {
                // Browser already closed
              }
              
              browser = await chromium.launch({
                headless: true,
                plugins: plugins.recommended({
                  humanize: {
                    click: { delay: { min: 200, max: 600 } },
                    cursor: false,
                    dialog: { delay: { min: 800, max: 2000 } }
                  }
                }),
                args: [
                  '--disable-blink-features=AutomationControlled',
                  '--disable-dev-shm-usage',
                  '--no-sandbox',
                  '--disable-setuid-sandbox',
                  '--disable-web-security',
                  '--disable-features=IsolateOrigins,site-per-process',
                  '--disable-site-isolation-trials',
                  '--disable-gpu',
                ]
              });
            }
          } catch (e) {
            // If context close fails, browser might be closed - recreate browser
            console.log(`   ⚠️  Error closing context, recreating browser: ${e}`);
            try {
              if (browser) {
                await browser.close().catch(() => {});
              }
            } catch (e2) {
              // Browser already closed
            }
            browser = await chromium.launch({
              headless: true,
              plugins: plugins.recommended({
                humanize: {
                  click: { delay: { min: 200, max: 600 } },
                  cursor: false,
                  dialog: { delay: { min: 800, max: 2000 } }
                }
              }),
              args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials',
                '--disable-gpu',
              ]
            });
          }
          
          // Recreate context with fresh storage state
          const freshContextOptions: BrowserContextOptions = {
            userAgent: FLARESOLVERR_UA,
            viewport: { width: 1920, height: 1080 },
            locale: 'en-SG',
            timezoneId: 'Asia/Singapore',
            storageState: freshStatePath, // Use the fresh auth state
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
            },
          };
          
          context = await browser.newContext(freshContextOptions);
          
          // Re-add init scripts to the new context
          await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
              get: () => undefined,
            });
            
            // Fix __name error that EdgeProp's JavaScript expects
            if (typeof (window as any).__name === 'undefined') {
              (window as any).__name = function() { return ''; };
            }
          });
          
          // Create new page from fresh context
          page = await context.newPage();
          
          console.log('   ✅ Browser context recreated with fresh authentication state');
          
          // CRITICAL: Verify login again after re-auth with the new page
          // We MUST verify login is actually working, not just trust the saved state
          // Use the same method that worked in auth.ep.ts - check for bookmarks link
          console.log('   🔐 Verifying login on recreated context...');
          await page.goto('https://www.edgeprop.sg', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await humanPause(5000, 8000); // Give page more time to load and cookies to activate
          
          // Check for bookmarks link first (this is what auth.ep.ts uses and it works)
          const bookmarksLink = page.locator('[href="/bookmarks"]');
          const bookmarksVisible = await bookmarksLink.isVisible({ timeout: 15000 }).catch(() => false);
          
          if (bookmarksVisible) {
            isLoggedIn = true;
            console.log('   ✅ Login verified after re-auth - bookmarks link found');
          } else {
            // Fallback: Check other login indicators with longer timeout
            console.log('   ⚠️  Bookmarks link not found, checking other login indicators...');
            const loginIndicators = [
              'a[href*="/user/logout"]',
              'a[href*="/user/"]:not([href*="/user/login"]):not([href*="/user/register"])',
              '[class*="user-menu"]',
              '[class*="logged-in"]',
              'button:has-text("Logout")',
              'button:has-text("Sign Out")'
            ];
            
            for (const selector of loginIndicators) {
              try {
                const element = page.locator(selector).first();
                const count = await element.count();
                if (count > 0) {
                  const isVisible = await element.isVisible({ timeout: 10000 }).catch(() => false);
                  if (isVisible) {
                    isLoggedIn = true;
                    console.log(`   ✅ Login verified after re-auth - found indicator: ${selector}`);
                    break;
                  }
                }
              } catch (e) {
                // Continue checking other indicators
              }
            }
          }
          
          // CRITICAL: If login is still not verified, the auth state might not be working
          // Check cookies to see if we have session cookies
          if (!isLoggedIn) {
            const cookies = await context.cookies();
            const hasSessionCookie = cookies.some(cookie => 
              cookie.name.toLowerCase().includes('session') || 
              cookie.name.toLowerCase().includes('auth') ||
              cookie.name.toLowerCase().includes('ssess') ||
              cookie.name.toLowerCase().includes('psessid')
            );
            
            if (hasSessionCookie) {
              console.log('   ⚠️  Login indicators not visible, but session cookies found');
              console.log('   ⚠️  Cookies might not be activated yet - will try to navigate to a property page to activate them');
              // Try navigating to a property page to activate cookies
              await page.goto('https://www.edgeprop.sg/property-search', { waitUntil: 'domcontentloaded', timeout: 30000 });
              await humanPause(3000, 5000);
              
              // Check again
              const bookmarksLink2 = page.locator('[href="/bookmarks"]');
              const bookmarksVisible2 = await bookmarksLink2.isVisible({ timeout: 10000 }).catch(() => false);
              if (bookmarksVisible2) {
                isLoggedIn = true;
                console.log('   ✅ Login verified after navigating to property search page');
              }
            }
            
            if (!isLoggedIn) {
              console.error('   ❌ Login verification failed after re-authentication!');
              console.error('   ❌ Auth state file exists but login is not working in browser context');
              throw new Error('Login verification failed after re-authentication - browser context not logged in');
            }
          }
          
          if (isLoggedIn) {
            console.log('   ✅ Login successful - phone numbers should be available\n');
          }
        } else {
          console.error('   ❌ Re-authentication failed - no state file created');
          console.error('   ❌ Cannot proceed without login - phone numbers are required');
          throw new Error('Re-authentication failed - no state file created');
        }
      } catch (reauthError) {
        console.error(`   ❌ Re-authentication failed: ${reauthError}`);
        console.error('   ❌ Cannot proceed without login - phone numbers are required');
        throw reauthError;
      }
    } else {
      // If we just re-authenticated, trust the auth state and set isLoggedIn to true
      // The auth.ep.ts script already verified login before saving the state
      if (justReAuthenticated) {
        console.log('   ✅ Just re-authenticated - trusting saved auth state');
        isLoggedIn = true;
      } else {
        // If we didn't re-authenticate, isLoggedIn should already be set from the verification above
        if (isLoggedIn) {
          console.log('   ✅ Login verified - phone numbers should be available\n');
        } else {
          console.log('   ⚠️  Login not verified, but no re-authentication was needed');
          // Trust the existing auth state file if it exists
          if (fs.existsSync(stateFilePath)) {
            console.log('   ✅ Trusting existing auth state file');
            isLoggedIn = true;
          }
        }
      }
    }
    
    // CRITICAL: Final check - if we're not logged in at this point, fail the job
    // Phone numbers are required and only available when logged in
    if (!isLoggedIn) {
      console.error('❌ CRITICAL: Not logged in after all authentication attempts!');
      console.error('❌ Cannot proceed - phone numbers are required and only available when logged in');
      throw new Error('Login verification failed - cannot proceed without authentication');
    }
    
    // CRITICAL: If we're not logged in at this point, fail the job
    // Phone numbers are required and only available when logged in
    if (!isLoggedIn) {
      console.error('❌ CRITICAL: Not logged in after all authentication attempts!');
      console.error('❌ Cannot proceed - phone numbers are required and only available when logged in');
      throw new Error('Login verification failed - cannot proceed without authentication');
    }
    
    // Base URL (page will be appended in the loop)
    const baseUrl = 'https://www.edgeprop.sg/property-search?listing_type=sale&property_type=9%252C103%252C107%252C105%252C106%252C104&district=&bedroom_min=&asking_price_min=1000000&asking_price_max=3000000&floor_area_min=&floor_area_max=&land_area_min=&land_area_max=&tenure=&bathroom=&furnishing=&completed=&level=&completion_year_min=&completion_year_max=&rental_yield=&high_rental_volume=&high_sales_volume=&deals=&nearby_amenities=&amenities_distance=500&rental_type=&keyword_features=&keyword=&mrt_keywords=&school_keywords=&hdbtowns_keywords=&areas_keywords=&district_keywords=&asset_id=&resource_type=&x=&y=&radius=1000&search_by=&search_by_distance=&search_by_location=&search_by_showmap=true&below_valuation=&map_zoom=&asset_lat=&asset_lng=&pageSize=20&order_by=recommended&fittings=&with_new_launches=0&area=&region=&subzone=&subzone_keywords=';
    
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
    
    // Track cookie saves to avoid excessive disk writes
    let listingsSinceLastCookieSave = 0;
    const COOKIE_SAVE_INTERVAL = 5; // Save cookies every 5 listings
    
    // Loop through pages
    while (currentPage <= maxPages && !shouldStop) {
      // Check if we should stop before processing each page
      if (shouldStop) {
        console.log('\n🛑 Stop signal received, exiting gracefully...');
        break;
      }
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📄 PAGE ${currentPage}/${maxPages}`);
      console.log(`${'='.repeat(60)}`);
      
      // Update progress for new page
      await updateProgress(`Processing page ${currentPage}/${maxPages}`);
      
      const searchUrl = `${baseUrl}&page=${currentPage}`;
      
      console.log(`📖 Navigating to page ${currentPage}...`);
      
      // Navigate with retry logic for Cloudflare
      let navigationSuccess = false;
      let navRetryCount = 0;
      const maxNavRetries = 3;
      
        while (!navigationSuccess && navRetryCount < maxNavRetries) {
        try {
          // Use Flaresolverr to solve Cloudflare before navigating (first attempt only)
          if (navRetryCount === 0) {
            // IMPORTANT: Navigate to EdgeProp domain first to ensure cookies from storageState are active
            // This ensures login cookies are properly loaded before applying Flaresolverr cookies
            try {
              await page.goto('https://www.edgeprop.sg', { waitUntil: 'domcontentloaded', timeout: 30000 });
              await humanPause(1000, 1500); // Give cookies time to be set
              console.log(`   🔐 Navigated to EdgeProp domain to activate login cookies from storageState`);
            } catch (navError) {
              console.log(`   ⚠️  Pre-navigation failed, continuing anyway: ${navError}`);
            }
            
            // Use the persistent session for search page
            const flaresolverrResult = await solveCloudflareWithFlaresolverr(searchUrl, true, flaresolverrSessionId || undefined);
            
            if (flaresolverrResult && flaresolverrResult.cookies.length > 0) {
              await applyFlaresolverrToContext(context, flaresolverrResult, '.edgeprop.sg');
              
              // Save fresh Cloudflare cookies to storage state for reuse
              const stateFilePath = path.join(process.cwd(), 'storage', 'ep.state.json');
              try {
                await context.storageState({ path: stateFilePath });
                console.log(`   💾 Saved fresh Cloudflare cookies to storage state (search page)`);
                listingsSinceLastCookieSave = 0; // Reset counter after saving
              } catch (saveError) {
                console.log(`   ⚠️  Failed to save cookies: ${saveError}`);
              }
              
              await humanPause(500, 1000);
            }
          }

          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          
          // Check for Cloudflare on the search page
          await humanPause(2000, 3000);
          const pageText = await page.textContent('body').catch(() => '') || '';
          
          if (pageText.includes('Pardon Our Interruption') || 
              pageText.includes('Verify you are human') ||
              pageText.includes('Enable JavaScript and cookies') ||
              pageText.includes('Just a moment') ||
              pageText.includes('Bad gateway') ||
              pageText.includes('Error code 502')) {
            navRetryCount++;
            if (navRetryCount < maxNavRetries) {
              console.log(`   ⚠️  Cloudflare detected on search page (attempt ${navRetryCount}/${maxNavRetries}), waiting and retrying...`);
              await humanPause(5000 * navRetryCount, 8000 * navRetryCount); // Exponential backoff
              continue;
            } else {
              console.log('   ❌ Cloudflare error persists on search page, skipping this page');
              break;
            }
          }
          
          navigationSuccess = true;
        } catch (e) {
          navRetryCount++;
          if (navRetryCount < maxNavRetries) {
            console.log(`   ⚠️  Navigation error (attempt ${navRetryCount}/${maxNavRetries}), retrying...`);
            await humanPause(3000, 5000);
          } else {
            throw e;
          }
        }
      }
      
      if (!navigationSuccess) {
        console.log('   ⚠️  Skipping this page due to Cloudflare errors');
        currentPage++;
        continue;
      }
      
      // Wait for content to load
      console.log(`⏳ Waiting for content to load...`);
      await humanPause(3000, 4000);
    
      // Find property listings using the search-listing-collection container
      const listingCollection = page.locator('.search-listing-collection');
      const listingCollectionExists = await listingCollection.count();
      
      if (listingCollectionExists === 0) {
        console.log('❌ Listing collection not found. Page structure may have changed.');
        break;
      }
      
      // Find all property listing cards
      const propertyCards = await listingCollection.locator('.search-listing-card').all();
      console.log(`📦 Found ${propertyCards.length} property listing cards`);
      
      if (propertyCards.length === 0) {
        console.log('❌ No property cards found');
        break;
      }
      
      // Extract property names and clickable elements from cards
      const propertyListings = [];
      
      for (const card of propertyCards) {
        try {
          // Find the property name link within the card
          // Property names are in links with href containing "listing/" but not the price or detail links
          // Look for the main property link (not asking-price, not property-detail-wrapper)
          const allPropertyLinks = card.locator('a[href*="listing/"]');
          const linkCount = await allPropertyLinks.count();
          
          if (linkCount > 0) {
            // Find the link that contains the property name (usually the one with class jsx-* but not asking-price or detail)
            let propertyLink = null;
            let propertyName = '';
            
            for (let j = 0; j < linkCount; j++) {
              const link = allPropertyLinks.nth(j);
              const className = await link.getAttribute('class').catch(() => '') || '';
              const text = await link.textContent().catch(() => '') || '';
              
              // Skip image wrappers, price links, detail links, and AI Redesign button
              if (className.includes('image-wrapper') || 
                  className.includes('asking-price') || 
                  className.includes('property-detail') ||
                  className.includes('redesign-btn') ||
                  text.includes('AI Redesign')) {
                continue;
              }
              
              // The property name link usually has substantial text and contains the property name
              // It should be visible and have a reasonable bounding box
              const isVisible = await link.isVisible({ timeout: 1000 }).catch(() => false);
              if (!isVisible) {
                continue;
              }
              
              if (text.length > 10 && !text.startsWith('$') && !text.includes('PSF')) {
                // Try to extract property name from text (before "Less than", "Only", etc.)
                // Property names are typically uppercase or title case
                const match = text.match(/^([A-Z][A-Z\s@&-]+?)(?:Less than|Only|Profitable|Above|Key|Built|sqft|\d+\s*Bed|\d+\s*Bath|Apartment|Condominium|$)/);
                if (match && match[1]) {
                  const candidate = match[1].trim();
                  // Validate it's a reasonable property name (3-60 chars, not just numbers)
                  if (candidate.length >= 3 && candidate.length <= 60 && 
                      !candidate.match(/^\d+$/) &&
                      !candidate.includes('Bed') && !candidate.includes('Bath')) {
                    propertyLink = link;
                    propertyName = candidate;
                    break;
                  }
                }
                
                // Fallback: try to get first meaningful words (uppercase/title case)
                if (!propertyLink) {
                  const words = text.trim().split(/\s+/);
                  const firstWords = [];
                  for (const word of words) {
                    // Stop at common property listing keywords
                    if (word.match(/^(Less|Only|Profitable|Above|Key|Built|sqft|Bed|Bath|Apartment|Condominium)$/i)) {
                      break;
                    }
                    // Add if it looks like part of a property name
                    if (word.length > 0 && (word[0] === word[0].toUpperCase() || word.match(/^[A-Z]/))) {
                      firstWords.push(word);
                      if (firstWords.join(' ').length >= 3 && firstWords.join(' ').length <= 60) {
                        propertyLink = link;
                        propertyName = firstWords.join(' ').trim();
                        // Don't break yet, keep checking for longer names
                      }
                    } else if (firstWords.length > 0) {
                      // We've started collecting, stop here
                      break;
                    }
                  }
                  if (propertyLink) {
            break;
                  }
                }
              }
            }
            
            // If we found a property name, add it to the list
            if (propertyLink && propertyName.length > 0) {
              propertyListings.push({ 
                element: propertyLink, 
                text: propertyName 
              });
            }
          }
        } catch (error) {
          // Skip this card if there's an error
          continue;
        }
        
        // Stop at 20 listings (EdgeProp shows exactly 20 per page)
        if (propertyListings.length >= 20) {
          break;
        }
      }
      
      console.log(`🏠 Found ${propertyListings.length} property listings`);
      
      if (propertyListings.length === 0) {
        console.log('❌ No property names found');
        break;
      }
      
      // Process exactly 20 properties per page (EdgeProp shows exactly 20 per page)
      // If we found more than 20, take only the first 20
      const processCount = Math.min(20, propertyListings.length);
      console.log(`\n🧪 Processing ${processCount} properties on page ${currentPage}/${maxPages}:`);
      
      if (propertyListings.length > 20) {
        console.log(`⚠️  Found ${propertyListings.length} listings but EdgeProp shows only 20 per page. Taking first 20.`);
      }
      
      
      for (let i = 0; i < processCount; i++) {
        const { element, text: propertyName } = propertyListings[i];
        const propertyStartTime = Date.now();
        console.log(`\n--- Property ${i + 1}/${processCount}: ${propertyName} ---`);
        
        try {
          let stepStart = Date.now();
          
          // Skip card extraction - go straight to popup for all details
          console.log(`🖱️  Opening property listing... (${Date.now() - propertyStartTime}ms)`);
          
          // Get the href from the element first
          const href = await element.getAttribute('href').catch(() => null);
          if (!href) {
            throw new Error('Could not get href from property link');
          }
          
          // Construct full URL
          const propertyUrl = href.startsWith('http') 
            ? href 
            : `https://www.edgeprop.sg/${href.startsWith('/') ? href.slice(1) : href}`;
          
          console.log(`   🔗 Property URL: ${propertyUrl}`);
          
          // CRITICAL: Use Flaresolverr on EACH property URL to get URL-specific cookies
          // Cloudflare cookies are URL-path specific - cookies from one property URL don't work for another
          // Using the same Flaresolverr session ensures cookies persist across requests
          console.log(`   🔄 Solving Cloudflare for this property URL...`);
          
          // Use Flaresolverr on the ACTUAL property URL with the same session to maintain cookies
          const flaresolverrResult = await solveCloudflareWithFlaresolverr(propertyUrl, true, flaresolverrSessionId || undefined);
          
          if (flaresolverrResult && flaresolverrResult.cookies.length > 0) {
            // Apply cookies to context BEFORE creating new page
            await applyFlaresolverrToContext(context, flaresolverrResult, '.edgeprop.sg');
            
            // Save fresh cookies periodically (every 5 listings to avoid too many writes)
            if (listingsSinceLastCookieSave >= COOKIE_SAVE_INTERVAL) {
              const stateFilePath = path.join(process.cwd(), 'storage', 'ep.state.json');
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
          
          // Use a more reliable method: wait for new page event on context level
          // This works better than page.waitForEvent('popup') for target="_blank" links
          let popup = null;
          const currentUrl = page.url();
          const currentPageCount = context.pages().length;
          
          // Set up page listener BEFORE clicking
          const newPagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
          
          // Scroll element into view and ensure it's clickable
          try {
            await element.scrollIntoViewIfNeeded();
            await humanPause(500, 800);
            await element.waitFor({ state: 'visible', timeout: 5000 });
          } catch (e) {
            console.log(`   ⚠️  Could not scroll element into view: ${e}`);
          }
          
          // Click the link
          try {
            await element.click({ timeout: 10000, force: false });
            await humanPause(1000, 1500);
          } catch (e) {
            // If click fails, try navigating directly
            console.log(`   ⚠️  Click failed, navigating directly to URL...`);
            popup = await context.newPage(); // Cookies are already in context from Flaresolverr above
            
            await popup.goto(propertyUrl, { 
              waitUntil: 'domcontentloaded', 
              timeout: 30000,
              referer: 'https://www.edgeprop.sg/' // Add referer to make navigation look natural
            });
            console.log(`   ✅ Navigated directly to property page`);
          }
          
          // Wait for new page if click succeeded
          if (!popup) {
            try {
              popup = await newPagePromise;
              if (popup) {
                console.log(`   ✅ New page/tab opened via click`);
              }
            } catch (e) {
              // No new page event, check manually
            }
            
            // Fallback: Check for new pages manually
            if (!popup) {
              await humanPause(1500, 2000);
              const pages = context.pages();
              if (pages.length > currentPageCount) {
                // New tab was created
                popup = pages[pages.length - 1];
                console.log(`   ✅ Found new tab (total pages: ${pages.length})`);
              } else if (page.url() !== currentUrl && page.url().includes('listing/')) {
                // Navigated in place
                popup = page;
                console.log(`   ✅ Navigated in place to property page`);
              } else {
                // Still on search page - navigate directly
                console.log(`   ⚠️  Still on search page, navigating directly...`);
                popup = await context.newPage(); // Cookies are already in context from Flaresolverr above
                
                await popup.goto(propertyUrl, { 
                  waitUntil: 'domcontentloaded', 
                  timeout: 30000,
                  referer: 'https://www.edgeprop.sg/' // Add referer to make navigation look natural
                });
                console.log(`   ✅ Opened new page and navigated directly`);
              }
            }
          }
        
          console.log(`✅ Popup/tab opened! (popup: ${Date.now() - stepStart}ms, total: ${Date.now() - propertyStartTime}ms)`);
          await humanPause(2000, 3000);
          
          // Wait for popup to fully load and check for errors with retry logic
          // Use smarter detection: wait for actual property content, not just check for errors
          let cloudflareDetected = false;
          let retryCount = 0;
          const maxRetries = 5;
          
          while (retryCount < maxRetries && !cloudflareDetected) {
            try {
              // Wait for page to load
              await popup.waitForLoadState('domcontentloaded', { timeout: 20000 });
              
              // Give page time to render (Cloudflare might need a moment)
              await humanPause(3000, 5000);
              
              // Check for actual Cloudflare ERRORS (not just Cloudflare presence)
              const pageText = await popup.textContent('body').catch(() => '') || '';
              const pageTitle = await popup.title().catch(() => '') || '';
              
              // Only check for actual error messages, not just "cloudflare.com" (which is normal)
              const hasActualError = pageText.includes('Bad gateway') || 
                                    pageText.includes('Error code 502') || 
                                    pageText.includes('Error code 503') ||
                                    pageText.includes('Pardon Our Interruption') ||
                                    pageText.includes('Verify you are human') ||
                                    pageText.includes('Enable JavaScript and cookies to continue') ||
                                    (pageText.includes('Just a moment') && pageText.length < 500) || // Short page = challenge page
                                    (pageTitle.includes('Just a moment') && pageText.length < 500);
              
              // Check for actual property content (positive check)
              const hasPropertyContent = pageText.includes('Bed') || 
                                       pageText.includes('Bath') ||
                                       pageText.includes('sqft') ||
                                       pageText.includes('Property Type') ||
                                       pageText.includes('District') ||
                                       pageText.includes('Bedrooms') ||
                                       pageText.includes('Bathrooms') ||
                                       pageText.length > 10000; // Large page = likely loaded
              
              // If we have actual errors AND no property content, it's a real Cloudflare error
              if (hasActualError && !hasPropertyContent) {
                retryCount++;
                if (retryCount < maxRetries) {
                  const waitTime = 5000 * retryCount; // Exponential backoff: 5s, 10s, 15s, 20s, 25s
                  console.log(`   ⚠️  Cloudflare error detected (attempt ${retryCount}/${maxRetries}), waiting ${waitTime/1000}s and retrying...`);
                  
                  // Wait with exponential backoff
                  await humanPause(waitTime, waitTime + 2000);
                  
                  // Try reloading the page
                  try {
                    console.log(`   🔄 Reloading page...`);
                    await popup.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
                    await humanPause(3000, 5000);
                  } catch (reloadError) {
                    // If reload fails, try navigating again with the URL
                    console.log(`   🔄 Reload failed, navigating to URL directly...`);
                    const popupUrl = popup.url() || propertyUrl;
                    try {
                    // Cookies are already in context from Flaresolverr above
                    await popup.goto(popupUrl, { 
                      waitUntil: 'domcontentloaded', 
                      timeout: 20000,
                      referer: 'https://www.edgeprop.sg/' // Add referer to make navigation look natural
                    });
                      await humanPause(3000, 5000);
                    } catch (navError) {
                      console.log(`   ⚠️  Navigation also failed, will retry...`);
                    }
                  }
                  continue; // Retry the check
                } else {
                  console.log('   ❌ Cloudflare error persists after all retries, skipping this listing');
                  cloudflareDetected = true;
                  throw new Error('Cloudflare error - max retries exceeded');
                }
              }
              
              // If we have property content, page loaded successfully (even if it mentions cloudflare)
              if (hasPropertyContent) {
                console.log(`   ✅ Page loaded successfully (found property content)`);
                break;
              }
              
              // If no error but also no content, wait a bit more and check again
              if (!hasActualError && !hasPropertyContent && retryCount < maxRetries - 1) {
                retryCount++;
                console.log(`   ⏳ Waiting for content to load (attempt ${retryCount}/${maxRetries})...`);
                await humanPause(3000, 5000);
                continue;
              }
              
              // Check if we're on an agent profile page instead of property listing
              const popupUrl = popup.url();
              if (popupUrl.includes('/property-agents/') || popupUrl.includes('/agent/')) {
                console.log('   ⚠️  Navigated to agent profile instead of property listing, skipping');
                throw new Error('Wrong page type: agent profile');
              }
              
              // Verify we're on a property listing page
              if (!popupUrl.includes('listing/') && !popupUrl.includes('/property/')) {
                console.log(`   ⚠️  Unexpected URL: ${popupUrl}, might be wrong page`);
              }
              
              // If we get here and still no content, it might be a slow-loading page
              if (!hasPropertyContent) {
                console.log(`   ⚠️  No property content detected, but no errors either. Continuing...`);
                break;
              }
              
            } catch (e) {
              if (e instanceof Error && (e.message.includes('Cloudflare') || e.message.includes('Wrong page'))) {
                throw e; // Re-throw to skip this listing
              }
              if (retryCount < maxRetries - 1) {
                retryCount++;
                console.log(`   ⚠️  Load error (attempt ${retryCount}/${maxRetries}), retrying...`);
                await humanPause(3000, 5000);
                continue;
              } else {
                console.log('   ⚠️  Page load failed after all retries, continuing anyway...');
                break;
              }
            }
          }
          
          if (cloudflareDetected) {
            throw new Error('Cloudflare error - skipping listing');
          }
          
          await humanPause(2000, 3000);
          
          // Scroll down to find agent section with phone button
          try {
            await popup.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
            await humanPause(1000, 1500);
          } catch (e) {
            // Scroll failed, continue anyway
          }
          
          // Click WhatsApp button then Phone Number link to reveal agent phone (with retry)
          stepStart = Date.now();
          console.log(`📞 Revealing phone number... (${Date.now() - propertyStartTime}ms)`);
          let cleanPhone = '';
          let phoneAttempts = 0;
          const maxPhoneAttempts = 2;
          
          while (phoneAttempts < maxPhoneAttempts && !cleanPhone) {
            phoneAttempts++;
            try {
              // First, try to click the phone button to reveal the phone number
              // Use multiple selectors in case the JSX hash changes
              const phoneButtonSelectors = [
                'button.mobile-btn',
                '[class*="mobile-btn"]',
                'button[class*="phone"]',
                'a[href^="tel:"]',
                '[class*="phone-button"]',
                'button:has-text("Phone")',
                'button:has-text("Call")'
              ];
              
              // Try to click phone button
              let phoneButtonClicked = false;
              for (const selector of phoneButtonSelectors) {
                try {
                  const phoneButton = popup.locator(selector).first();
                  const phoneButtonVisible = await phoneButton.isVisible({ timeout: 3000 }).catch(() => false);
                  if (phoneButtonVisible) {
                    // Scroll button into view before clicking
                    try {
                      await phoneButton.scrollIntoViewIfNeeded();
                      await humanPause(500, 800);
                    } catch (e) {
                      // Scroll failed, continue anyway
                    }
                    await phoneButton.click({ timeout: 3000 });
                    // Wait longer after clicking for phone number to appear
                    await humanPause(2000, 3000);
                    phoneButtonClicked = true;
                    console.log(`   ✅ Clicked phone button with selector: ${selector}`);
                    break;
                  }
                } catch (e) {
                  // Try next selector
                }
              }
              
              if (!phoneButtonClicked) {
                console.log(`   ⚠️  Could not find phone button to click`);
              }
              
              // Extract phone number - try tel: link first (get href, not text, as it's more reliable)
              // Wait a bit longer after clicking for phone to appear
              await humanPause(1000, 1500);
              
              // Try getting href from tel: link first (more reliable than text)
              const phoneLinkHref = await popup.locator('a[href^="tel:"]').first().getAttribute('href', { timeout: 5000 }).catch(() => null);
              if (phoneLinkHref) {
                // Extract phone from href (e.g., "tel:+6597400311" -> "97400311")
                cleanPhone = cleanPhoneNumber(phoneLinkHref.replace('tel:', '').replace('+', ''));
                if (cleanPhone) {
                  console.log(`   📱 Phone from href: ${cleanPhone}`);
                }
              }
              
              // If href didn't work, try text content
              if (!cleanPhone) {
                const phoneLink = await popup.locator('a[href^="tel:"]').first().textContent({ timeout: 3000 }).catch(() => null);
                if (phoneLink) {
                  cleanPhone = cleanPhoneNumber(phoneLink);
                  if (cleanPhone) {
                    console.log(`   📱 Phone from text: ${cleanPhone}`);
                  }
                }
              }
              
              // If still no phone, try other selectors
              if (!cleanPhone) {
                // Fallback: try other selectors for phone number
                const phoneSelectors = [
                  '[class*="agent-contact"]',
                  '[class*="phone"]',
                  '[class*="mobile"]',
                  '.contact-info',
                  '[class*="contact"]'
                ];
                
                for (const selector of phoneSelectors) {
                  try {
                    const phoneElement = await popup.locator(selector).first();
                    const exists = await phoneElement.count();
                    if (exists > 0) {
                      const phoneText = await phoneElement.textContent({ timeout: 2000 }).catch(() => '');
                      if (phoneText && phoneText.match(/\d{8}/)) {
                  cleanPhone = cleanPhoneNumber(phoneText);
                        if (cleanPhone) {
                  console.log(`   📱 Phone: ${cleanPhone}`);
                          break;
                        }
                      }
                    }
                  } catch (e) {
                    continue;
                  }
                }
              }
            } catch (error: unknown) {
              console.log(`   ⚠️  Phone extraction attempt ${phoneAttempts}/${maxPhoneAttempts} failed: ${error}`);
            }
          }
          
          // Extract all info from the listing-info-container
          let extractedBeds = '';
          let extractedBaths = '';
          let extractedSize = '';
          let extractedPropertyType = '';
          let extractedPsf = '';
          let extractedDistrict = '';
          let extractedYear = '';
          let agentName = '';
          let extractedAddress = '';
          let extractedTenure = '';
          
          try {
            // Try multiple selectors for listing info container (JSX hashes change)
            let listingInfoText = '';
            const listingInfoSelectors = [
              '.listing-info-container.listing-info',
              '[class*="listing-info-container"]',
              '[class*="listing-info"]',
              '.property-details',
              '[id*="details"]'
            ];
            
            for (const selector of listingInfoSelectors) {
              try {
                const container = popup.locator(selector).first();
                const exists = await container.count();
                if (exists > 0) {
                  listingInfoText = await container.textContent({ timeout: 2000 }).catch(() => '') || '';
                  if (listingInfoText && listingInfoText.length > 10) {
                    break;
                  }
                }
              } catch (e) {
                continue;
              }
            }
            
            console.log(`   📊 Listing info text length: ${listingInfoText.length}`);
            
            if (listingInfoText && listingInfoText.length > 0) {
              console.log(`   📊 Listing info text: ${listingInfoText.substring(0, 200)}...`);
              
              // Parse: "$ 2,280,0002 Beds2 Bath829 sqftCondominium$ 3531 psfD92025"
              // Price format is always ",XXX" (comma + 3 digits), so after ",000" the next digit(s) are beds
              // Match digits after the last occurrence of ",XXX" followed by "Beds"
              const bedsMatch = listingInfoText.match(/,\d{3}(\d{1,2})\s*Beds?/);
              const bathsMatch = listingInfoText.match(/Beds?(\d{1,2})\s*Baths?/);
              
              extractedBeds = bedsMatch ? bedsMatch[1] : '';
              extractedBaths = bathsMatch ? bathsMatch[1] : '';
              
              const sizeMatch = listingInfoText.match(/([\d,]+)\s*sqft/);
              const psfMatch = listingInfoText.match(/\$\s*([\d,]+)\s*psf/);
              
              // Parse district, year from "D92025" or "D232013"
              const districtYearMatch = listingInfoText.match(/D(\d{1,2})(\d{4})/);
              
              // No need to reassign, already extracted above
              extractedSize = sizeMatch ? `${sizeMatch[1]} sqft` : '';
              extractedPsf = psfMatch ? `$${psfMatch[1]} psf` : '';
              extractedDistrict = districtYearMatch ? `D${districtYearMatch[1]}` : '';
              extractedYear = districtYearMatch ? districtYearMatch[2] : '';
              
              // Extract property type
              if (listingInfoText.includes('Condominium')) {
                extractedPropertyType = 'Condominium';
              } else if (listingInfoText.includes('Apartment')) {
                extractedPropertyType = 'Apartment';
              } else if (listingInfoText.includes('Executive Condominium')) {
                extractedPropertyType = 'Executive Condominium';
              }
            }
          } catch (error: unknown) {
            console.log(`   ⚠️  Could not extract listing info: ${error}`);
          }
          
          // Extract agent name using flexible selectors
          try {
            const agentNameSelectors = [
              '.agent-name-wrapper',
              '[class*="agent-name"]',
              '[class*="agent-name-wrapper"]',
              '.agent-info h2',
              '.agent-info h3',
              '[class*="agent"] h2',
              '[class*="agent"] h3'
            ];
            
            for (const selector of agentNameSelectors) {
              try {
                const agentElement = popup.locator(selector).first();
                const exists = await agentElement.count();
                if (exists > 0) {
                  const name = await agentElement.textContent({ timeout: 2000 }).catch(() => '') || '';
                  if (name && name.trim().length > 0 && name.trim().length < 100) {
                    agentName = name.trim();
                    break;
                  }
                }
              } catch (e) {
                continue;
              }
            }
            console.log(`   👤 Agent name: ${agentName || 'Not found'}`);
          } catch (error: unknown) {
            console.log(`   ⚠️  Could not extract agent name: ${error}`);
          }
          
          // Extract address and more details from _keydetails
          try {
            // Extract listing info
            const listingInfo = await popup.locator('[id="_keydetails"]').first();
            const listingText = await listingInfo.textContent({ timeout: 2000 }).catch(() => '');
            
            if (listingText) {
              // Extract property type
              const propertyTypeMatch = listingText.match(/Property Type:\s*([^,\n]+)/);
              extractedPropertyType = propertyTypeMatch ? propertyTypeMatch[1].trim() : extractedPropertyType;
              
              // Extract district
              const districtMatch = listingText.match(/District:\s*D(\d+)/);
              extractedDistrict = districtMatch ? `D${districtMatch[1]}` : extractedDistrict;
              
              // Extract beds
              const bedsMatch = listingText.match(/Bedrooms:\s*(\d+)/);
              extractedBeds = bedsMatch ? bedsMatch[1] : extractedBeds;
              
              // Extract baths
              const bathsMatch = listingText.match(/Bathrooms:\s*(\d+)/);
              extractedBaths = bathsMatch ? bathsMatch[1] : extractedBaths;
              
              // Extract size
              const sizeMatch = listingText.match(/Size \(sqft\):\s*([\d,]+)/);
              extractedSize = sizeMatch ? `${sizeMatch[1]} sqft` : extractedSize;
              
              // Extract PSF
              const psfMatch = listingText.match(/PSF:\s*\$([\d,.]+)/);
              extractedPsf = psfMatch ? `$${psfMatch[1]} psf` : extractedPsf;
              
              // Extract year built
              const yearMatch = listingText.match(/Year Built:\s*(\d{4})/);
              extractedYear = yearMatch ? yearMatch[1] : extractedYear;
              
              // Extract tenure
              const tenureMatch = listingText.match(/Tenure:\s*([^,\n]+)/);
              extractedTenure = tenureMatch ? tenureMatch[1].trim() : extractedTenure;
              
              console.log(`   📝 Extracted details:
                Property Type: ${extractedPropertyType || 'N/A'}
                District: ${extractedDistrict || 'N/A'}
                Beds: ${extractedBeds || 'N/A'}
                Baths: ${extractedBaths || 'N/A'}
                Size: ${extractedSize || 'N/A'}
                PSF: ${extractedPsf || 'N/A'}
                Year: ${extractedYear || 'N/A'}
                Tenure: ${extractedTenure || 'N/A'}`);
            }
          } catch (error: unknown) {
            console.log(`   ⚠️  Could not extract listing info: ${error}`);
          }
          
          // Extract address from _keydetails
          try {
            // First try with the specific filter for common street types (including Malay/Chinese street names)
            let detailsText = await popup.locator('[id="_keydetails"] div').filter({ 
              hasText: /Avenue|Road|Street|Drive|Lane|Walk|Close|Crescent|Place|Park|Way|Hill|View|Estate|Jalan|Lorong|Bukit|Taman/ 
            }).first().textContent({ timeout: 2000 }).catch(() => '') || '';
            
            // If no match, try getting the first div in _keydetails (fallback)
            if (!detailsText) {
              detailsText = await popup.locator('[id="_keydetails"] div').first().textContent({ timeout: 2000 }).catch(() => '') || '';
            }
            
            if (detailsText) {
              console.log(`   📄 Details text: ${detailsText.substring(0, 150)}...`);
              
              // Extract address (first part before comma)
              const addressMatch = detailsText.match(/^([^,\n]+),/);
              if (addressMatch) {
                extractedAddress = addressMatch[1].trim();
              }
              
              // Extract tenure - look for patterns like "99 years", "999 years", "Freehold"
              // More flexible to catch "99 years", "99 Years", "999 years of lease", "Freehold"
              const tenureMatch = detailsText.match(/(\d+\s*[Yy]ears|Freehold)/i);
              if (tenureMatch) {
                // Clean it up - extract just the number + "years" or "Freehold"
                const cleanTenure = tenureMatch[1].trim();
                // Normalize to format like "99 years" or "Freehold"
                if (/\d/.test(cleanTenure)) {
                  const numMatch = cleanTenure.match(/\d+/);
                  extractedTenure = numMatch ? `${numMatch[0]} years` : cleanTenure;
                } else {
                  extractedTenure = 'Freehold';
                }
              }
            }
          } catch (error: unknown) {
            console.log(`   ⚠️  Could not extract address details: ${error}`);
          }
          
          // Extract price from popup
          let priceElement = null;
          let price = undefined;
          try {
            const priceTexts = await popup.getByText(/\$\s*[\d,]+/).all();
            if (priceTexts.length > 1) {
              priceElement = await priceTexts[1].textContent({ timeout: 1000 }).catch(() => null);
            } else if (priceTexts.length > 0) {
              priceElement = await priceTexts[0].textContent({ timeout: 1000 }).catch(() => null);
            }
            price = priceElement ? parsePrice(priceElement) : undefined;
          } catch (error: unknown) {
            console.log(`   ⚠️  Could not extract price from popup`);
          }
          
          console.log(`   ✅ All details extracted (${Date.now() - stepStart}ms, total: ${Date.now() - propertyStartTime}ms)`);
          
          // Format beds/baths professionally
          const bedsFormatted = extractedBeds ? `${extractedBeds} Bed${extractedBeds !== '1' ? 's' : ''}` : '';
          const bathsFormatted = extractedBaths ? `${extractedBaths} Bath${extractedBaths !== '1' ? 's' : ''}` : '';
          const bedsBathsDisplay = bedsFormatted && bathsFormatted ? `${bedsFormatted}, ${bathsFormatted}` : '';
          
          console.log(`✅ Agent: ${agentName} - ${cleanPhone}`);
          console.log(`   💰 Price: ${priceElement || 'Not found'}`);
          console.log(`   🏠 ${bedsBathsDisplay}`);
          console.log(`   🏢 Type: ${extractedPropertyType}`);
          console.log(`   📏 Size: ${extractedSize}`);
          console.log(`   💵 PSF: ${extractedPsf}`);
          console.log(`   📍 District: ${extractedDistrict}`);
          console.log(`   📅 Year: ${extractedYear}`);
          console.log(`   🏠 Tenure: ${extractedTenure}`);
          console.log(`   📍 Address: ${extractedAddress}`);
          
          if (agentName && cleanPhone) {
            // Save to database (with deduplication handled by Supabase unique constraints)
            try {
              // Parse numeric values for database
              const bedsNum = extractedBeds ? parseInt(extractedBeds) : undefined;
              const bathsNum = extractedBaths ? parseInt(extractedBaths) : undefined;
              const sizeSqftNum = extractedSize ? parseFloat(extractedSize.replace(/[^\d.]/g, '')) : undefined;
              const pricePsfNum = extractedPsf ? parseFloat(extractedPsf.replace(/[^\d.]/g, '')) : undefined;
              const yearBuiltNum = extractedYear ? parseInt(extractedYear) : undefined;
              
              const _result = await upsertAgentAndListing({
                agent: {
                  name: agentName.trim(),
                  phone: cleanPhone,
                  agency: undefined, // Not available
                  source: 'edgeprop',
                  source_url: popup.url(),
                },
                listing: {
                  portal: 'edgeprop',
                  url: popup.url(),
                  title: cleanPropertyTitle(propertyName),
                  price: price,
                  district: extractedDistrict || undefined,
                  address: extractedAddress || undefined,
                  property_type: extractedPropertyType || undefined,
                  beds: bedsNum,
                  baths: bathsNum,
                  size_sqft: sizeSqftNum,
                  price_psf: pricePsfNum,
                  year_built: yearBuiltNum,
                  tenure: extractedTenure || undefined,
                }
              });
              
              console.log(`💾 Saved to database: ${agentName} (${cleanPhone})`);
              totalSuccess++;
              
              // Check if we've reached max listings
              if (maxListings && totalSuccess >= maxListings) {
                console.log(`\n🎯 Reached max listings limit (${maxListings}). Stopping scraper...`);
                shouldStop = true;
                break;
              }
              
              await updateProgress();
            } catch (dbError: unknown) {
              // Check if it's a duplicate error (unique constraint violation)
              const errorObj = dbError as { message?: string; code?: string };
              if (errorObj?.message?.includes('duplicate') || errorObj?.code === '23505') {
                console.log(`⏭️  Skipped duplicate: ${propertyName}`);
                totalSkipped++;
              } else {
                console.error(`❌ Database error: ${dbError}`);
                totalErrors++;
                await updateProgress();
              }
            }
          } else {
            console.log(`⚠️  Missing agent info - Name: ${agentName || 'Not found'}, Phone: ${cleanPhone || 'Not found'}`);
            totalErrors++;
            await updateProgress();
          }
          
          // Close popup (only if it's not the main page)
          if (popup !== page) {
            try {
          await popup.close();
              await humanPause(300, 500);
            } catch (e) {
              console.log('   ⚠️  Could not close popup, continuing...');
            }
          } else {
            // If we used the main page, navigate back
            try {
              await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
              await humanPause(1000, 1500);
            } catch (e) {
              console.log('   ⚠️  Could not navigate back, continuing...');
            }
          }
          
          totalProcessed++;
          await updateProgress();
          
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`❌ Error processing property ${i + 1}: ${errorMessage}`);
          totalErrors++;
          totalProcessed++;
          await updateProgress();
          
          // Try to close popup if it's still open and navigate back
          try {
            const pages = context.pages();
            if (pages.length > 1) {
              const lastPage = pages[pages.length - 1];
              if (lastPage !== page) {
                try {
                  await lastPage.close();
                } catch (_) {
                  // Ignore close errors
                }
              }
            }
            
            // Always try to get back to search page
            const currentPageUrl = page.url();
            if (!currentPageUrl.includes('property-search') || currentPageUrl !== searchUrl) {
              try {
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await humanPause(2000, 3000);
                console.log(`   🔄 Navigated back to search page`);
              } catch (navError) {
                console.log(`   ⚠️  Could not navigate back to search page`);
                // Try reloading the page
                try {
                  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
                  await humanPause(2000, 3000);
                } catch (_) {
                  // Ignore reload errors
                }
              }
            }
          } catch (_closeError) {
            // Final fallback: try to reload the search page
            try {
              await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
              await humanPause(2000, 3000);
            } catch (_navError) {
              // Ignore navigation errors
            }
          }
        }
      } // End of property loop
      
      console.log(`\n✅ Page ${currentPage} completed: ${propertyListings.length} properties processed`);
      
      // Check if we've reached max listings after processing this page
      if (maxListings && totalSuccess >= maxListings) {
        console.log(`\n🎯 Reached max listings limit (${maxListings}). Stopping scraper...`);
        break;
      }
      
      // Wait before going to next page (reduced for speed)
      if (currentPage < maxPages) {
        console.log(`⏳ Waiting before next page...`);
        await humanPause(1000, 1500);
      }
      
      currentPage++;
      await updateProgress();
    } // End of while loop
    
  } catch (error: unknown) {
    console.error('❌ Fatal error during scraping:', error);
    // Update lock file and database on error (lock file will be removed in finally block)
    jobStatus.status = 'failed';
    jobStatus.statusMessage = error instanceof Error ? error.message : 'Fatal error during scraping';
    jobStatus.completedAt = new Date().toISOString();
    jobStatus.progress.currentPage = currentPage;
    jobStatus.progress.listingsProcessed = totalProcessed;
    jobStatus.stats.totalSuccess = totalSuccess;
    jobStatus.stats.totalSkippedNoPhone = totalSkipped;
    jobStatus.stats.totalErrors = totalErrors;
    
    if (jobId) {
      try {
        const supabase = getSupabaseClient();
        await supabase
          .from('scraper_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : 'Fatal error during scraping',
            listings_processed: totalProcessed
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
    
    const endTime = Date.now();
    const totalTime = Math.round((endTime - startTime) / 1000);
    const avgTimePerListing = totalProcessed > 0 ? Math.round(totalTime / totalProcessed) : 0;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Scraping Summary:');
    console.log(`   Total processed: ${totalProcessed}`);
    console.log(`   New listings saved: ${totalSuccess}`);
    console.log(`   Duplicates skipped: ${totalSkipped}`);
    console.log(`   Errors: ${totalErrors}`);
    console.log(`   Total time: ${totalTime}s`);
    console.log(`   Avg time per listing: ${avgTimePerListing}s`);
    console.log(`   Success rate: ${totalProcessed > 0 ? Math.round((totalSuccess / totalProcessed) * 100) : 0}%`);
    console.log('='.repeat(60));
    
    // Always remove lock file, regardless of success or failure
    if (fs.existsSync(lockFile)) {
      try {
        // Update job status with final values
        jobStatus.status = jobStatus.status || 'completed';
        jobStatus.statusMessage = jobStatus.statusMessage || 'Scraping completed';
        jobStatus.completedAt = jobStatus.completedAt || new Date().toISOString();
        jobStatus.progress.currentPage = currentPage;
        jobStatus.progress.listingsProcessed = totalProcessed;
        jobStatus.stats.totalSuccess = totalSuccess;
        jobStatus.stats.totalSkippedNoPhone = totalSkipped;
        jobStatus.stats.totalErrors = totalErrors;
        
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
    
    // Update database job status
    if (jobId) {
      try {
        const supabase = getSupabaseClient();
        await supabase
          .from('scraper_jobs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            listings_processed: totalProcessed,
            stats: {
              totalSuccess,
              totalSkipped,
              totalErrors,
              totalTime,
              avgTimePerListing
            }
          })
          .eq('id', jobId);
        console.log('✅ Database job status updated');
      } catch (error) {
        console.error('⚠️  Failed to update database job status:', error);
      }
    }
  }
}

// Run the scraper
scrapeEdgePropFinal().catch((error) => {
  console.error('❌ Fatal error:', error);
  // Browser will be closed in finally block, so we can exit safely
  process.exit(1);
});

