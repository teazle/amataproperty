import { config } from 'dotenv';
import path from 'path';

// Load environment variables - try .env first, then .env.local
config({ path: path.resolve(process.cwd(), '.env') });
config({ path: path.resolve(process.cwd(), '.env.local') });

import { chromium, type BrowserContextOptions, type Page } from 'playwright';
import fs from 'fs';
import { execSync } from 'child_process';
import { CHROME_UA, humanPause } from './stealth';
import { upsertAgentAndListing } from './upsert';
import { getSupabaseClient } from './supa';
const supabase = getSupabaseClient();

// Helper function to re-authenticate with retry logic
async function reAuthenticate(maxRetries: number = 3): Promise<boolean> {
  const stateFilePath = path.join(process.cwd(), 'storage', 'ep.state.json');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`\n🔄 Re-authenticating to EdgeProp... (Attempt ${attempt}/${maxRetries})`);
    
    try {
      execSync('bun src/workers/auth.ep.ts', { 
        cwd: process.cwd(),
        stdio: 'inherit' 
      });
      
      // If execSync didn't throw, the auth script completed successfully
      // Wait a moment for state file to be written
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Verify state file exists (auth script should have created it)
      if (fs.existsSync(stateFilePath)) {
        try {
          const stateContent = fs.readFileSync(stateFilePath, 'utf-8');
          const stateData = JSON.parse(stateContent);
          
          // Basic validation: state file should have cookies and origins
          if (stateData && stateData.cookies && stateData.cookies.length > 0) {
            console.log('✅ Re-authentication successful! (State file created with cookies)\n');
            return true;
          } else {
            console.log('⚠️  State file exists but appears empty or invalid.');
            if (attempt < maxRetries) {
              console.log(`   Retrying authentication...\n`);
              continue;
            }
          }
        } catch (parseError) {
          console.log('⚠️  State file exists but could not be parsed.');
          if (attempt < maxRetries) {
            console.log(`   Retrying authentication...\n`);
            continue;
          }
        }
      } else {
        console.log('⚠️  Authentication script completed but state file not found.');
        if (attempt < maxRetries) {
          console.log(`   Retrying authentication...\n`);
          continue;
        }
      }
    } catch (error) {
      console.error(`❌ Re-authentication attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt < maxRetries) {
        console.log(`   Waiting before retry...\n`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds before retry
        continue;
      }
    }
  }
  
  console.error(`❌ Re-authentication failed after ${maxRetries} attempts!`);
  return false;
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
 * @returns Cleaned phone number (10 digits: 65XXXXXXXX)
 */
function cleanPhoneNumber(phoneText: string): string {
  if (!phoneText) return '';
  
  // Remove all non-numeric characters
  const cleaned = phoneText.replace(/[^\d]/g, '');
  
  if (!cleaned) return '';
  
  // Singapore mobile numbers must start with 659 or 658 (10 digits: 659XXXXXXXX or 658XXXXXXXX)
  // Handle different formats:
  // - 659XXXXXXXX or 658XXXXXXXX (10 digits) - return as is if valid
  // - 65XXXXXXXX (10 digits) - validate must start with 659 or 658
  // - 9XXXXXXXX or 8XXXXXXXX (9 digits) - prepend 65 and validate
  // - 9XXXXXXX or 8XXXXXXX (8 digits) - prepend 65 and validate
  
  let candidate = '';
  
  // If it's exactly 10 digits and starts with 659 or 658, return as is
  if (cleaned.length === 10 && (cleaned.startsWith('659') || cleaned.startsWith('658'))) {
    return cleaned;
  }
  
  // If it's 10 digits starting with 65 but not 659/658, invalid
  if (cleaned.length === 10 && cleaned.startsWith('65') && !cleaned.startsWith('659') && !cleaned.startsWith('658')) {
    return '';
  }
  
  // If it's 9 digits starting with 9 or 8, prepend 65 and validate
  if (cleaned.length === 9 && (cleaned.startsWith('9') || cleaned.startsWith('8'))) {
    candidate = `65${cleaned}`;
    if (candidate.startsWith('659') || candidate.startsWith('658')) {
      return candidate;
    }
    return '';
  }
  
  // If it's 8 digits starting with 9 or 8, prepend 65 and validate
  if (cleaned.length === 8 && (cleaned.startsWith('9') || cleaned.startsWith('8'))) {
    candidate = `65${cleaned}`;
    if (candidate.startsWith('659') || candidate.startsWith('658')) {
      return candidate;
    }
    return '';
  }
  
  // If it's longer than 10, try to extract 659 or 658 pattern
  if (cleaned.length > 10) {
    const match = cleaned.match(/65[89]\d{8}/);
    if (match) {
      return match[0].substring(0, 10); // Return first 10 digits
    }
  }
  
  // Invalid format - doesn't match Singapore mobile number pattern
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
  const jobId = process.env.EP_JOB_ID;
  const stateFilePath = path.join(process.cwd(), 'storage', 'ep.state.json');
  const lockFile = path.join(process.cwd(), 'storage', 'ep-scraper.lock');
  const hasStorageState = fs.existsSync(stateFilePath);
  
  // Verify state file exists and has valid content before proceeding
  if (hasStorageState) {
    try {
      const stateContent = fs.readFileSync(stateFilePath, 'utf-8');
      const stateData = JSON.parse(stateContent);
      if (!stateData || !stateData.cookies || stateData.cookies.length === 0) {
        console.error('⚠️  State file exists but has no cookies! Will re-authenticate.');
      } else {
        console.log(`✅ Found existing auth state with ${stateData.cookies.length} cookies`);
      }
    } catch (e) {
      console.error('⚠️  State file exists but is invalid! Will re-authenticate.');
    }
  }
  
  // Check for existing lock file
  if (fs.existsSync(lockFile)) {
    const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
    const lockAge = Date.now() - new Date(lockData.startedAt).getTime();
    
    // If lock is older than 2 hours, assume stale and remove
    if (lockAge > 2 * 60 * 60 * 1000) {
      console.log('⚠️  Found stale lock file (>2h old), removing...');
      fs.unlinkSync(lockFile);
    } else {
      console.error('❌ Another EdgeProp scraper is already running!');
      console.error(`   Started: ${lockData.startedAt}`);
      console.error('   Wait for it to complete or delete storage/ep-scraper.lock manually.');
      process.exit(1);
    }
  }
  
  console.log(`📍 Districts: ALL`);
  console.log(`💰 Price range: $1,000,000 - $3,000,000`);
  console.log(`📄 Max pages: ${maxPages}`);
  console.log(`📁 Storage state: ${hasStorageState ? 'Found' : 'Not found'}`);
  console.log(`🆔 Job ID: ${jobId || 'None'}`);
  
  // Create lock file with job status
  const jobStatus = {
    startedAt: new Date().toISOString(),
    pid: process.pid,
    status: 'running',
    statusMessage: 'Starting scraper...',
    progress: {
      currentPage: 0,
      totalPages: maxPages,
      listingsProcessed: 0,
      listingsAttempted: 0
    },
    completedAt: undefined as string | undefined,
    stats: undefined as { totalProcessed: number; totalSuccess: number; totalErrors: number; totalSkipped: number } | undefined
  };
  
  fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
  
  // Re-authenticate before scraping to ensure fresh auth (with retry logic)
  console.log('🔄 Re-authenticating before scraping to ensure fresh session...');
  const authSuccess = await reAuthenticate(3); // Retry up to 3 times
  
  if (!authSuccess) {
    console.error('❌ Authentication failed after retries! Cannot proceed without authentication.');
    console.error('   Please check your credentials in .env.local and try again.');
    
    // Clean up lock file
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
    
    // Update job status if jobId provided
    if (jobId) {
      try {
        await supabase
          .from('scraper_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: 'Authentication failed after retries'
          })
          .eq('id', jobId);
      } catch (error) {
        // Ignore database update errors
      }
    }
    
    process.exit(1);
  }
  
  // Verify auth state exists after re-auth (should always exist if authSuccess is true)
  const updatedStateExists = fs.existsSync(stateFilePath);
  if (!updatedStateExists) {
    console.error('❌ Authentication state file not found after successful authentication!');
    // Clean up lock file
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
    process.exit(1);
  }
  
  console.log('✅ Authentication verified! Proceeding with scraping...\n');
  
  // Update job status in database if jobId provided
  if (jobId) {
    try {
      await supabase
        .from('scraper_jobs')
        .update({ 
          status: 'running', 
          started_at: new Date().toISOString(),
          current_page: 0,
          total_pages: maxPages,
          pid: process.pid // Save PID to database for stopping
        })
        .eq('id', jobId);
    } catch (error) {
      console.error('⚠️  Failed to update job status:', error);
    }
  }
  
  // Set up signal handlers for graceful shutdown
  let shouldStop = false;
  const stopHandler = () => {
    console.log('\n🛑 Stop signal received, shutting down gracefully...');
    shouldStop = true;
    // Don't exit immediately - let the main loop check the flag and exit gracefully
    // This allows the browser to close properly in the finally block
  };
  
  process.on('SIGTERM', stopHandler);
  process.on('SIGINT', stopHandler);
  
  let browser = await chromium.launch({
    headless: false, // Run in visible mode for debugging
    slowMo: 100, // Slow down operations by 100ms for visibility
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ]
  });

  // Verify state file exists before trying to use it
  if (!fs.existsSync(stateFilePath)) {
    console.error('❌ Auth state file not found! Cannot proceed without authentication.');
    process.exit(1);
  }
  
  const contextOptions: BrowserContextOptions = {
    userAgent: CHROME_UA,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 }, // Singapore coordinates
    colorScheme: 'light' as const,
    extraHTTPHeaders: {
      'Accept-Language': 'en-SG,en;q=0.9',
    },
    storageState: stateFilePath, // Always use the fresh auth state
  };

  console.log(`📁 Loading authentication state from: ${stateFilePath}`);
  let context = await browser.newContext(contextOptions);
  
  // Verify we're actually logged in by checking cookies
  let cookies = await context.cookies();
  console.log(`🍪 Loaded ${cookies.length} cookies from auth state`);
  
  // Check if we have session/auth cookies
  let hasAuthCookies = cookies.some(c => 
    c.name.includes('session') || 
    c.name.includes('auth') || 
    c.name.includes('token') ||
    c.name.includes('user') ||
    c.name.includes('edgeprop') ||
    c.name.includes('ASPXAUTH') ||
    c.name.includes('JSESSIONID')
  );
  
  if (!hasAuthCookies && cookies.length > 0) {
    console.log('⚠️  Warning: Auth state loaded but no obvious auth cookies found');
    console.log('   Cookie names:', cookies.map(c => c.name).join(', '));
  } else if (hasAuthCookies) {
    console.log('✅ Auth cookies detected in loaded state');
  }
  
  // Verify authentication by navigating to homepage and checking for login indicators
  let page = await context.newPage();
  console.log('🔍 Verifying authentication status...');
  try {
    await page.goto('https://www.edgeprop.sg', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanPause(3000, 4000);
    
    // Check if we're logged in by looking for bookmark link or user menu
    const bookmarkLink = page.locator('[href*="/bookmarks"], a:has-text("Bookmarks")').first();
    const isLoggedIn = await bookmarkLink.isVisible({ timeout: 3000 }).catch(() => false);
    
    if (isLoggedIn) {
      console.log('✅ Authentication verified - logged in successfully!');
    } else {
      // Check if login button is still visible (means not logged in)
      const loginButton = page.locator('button:has-text("Login"), a:has-text("Login"), div:has-text("Login")').first();
      const loginVisible = await loginButton.isVisible({ timeout: 3000 }).catch(() => false);
      
      if (loginVisible) {
        console.error('❌ Authentication failed - still showing login button!');
        console.error('   State file does not contain valid session. Re-authenticating...');
        await page.close();
        await context.close();
        await browser.close();
        
        // Re-authenticate
        const authSuccess = await reAuthenticate(3);
        if (!authSuccess) {
          console.error('❌ Re-authentication failed!');
          process.exit(1);
        }
        
        // Wait for state file to be written
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Reload browser with new state
        browser = await chromium.launch({
          headless: false,
          slowMo: 100,
          args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox',
          ]
        });
        
        context = await browser.newContext({
          ...contextOptions,
          storageState: stateFilePath, // Use the newly saved state
        });
        
        page = await context.newPage();
        
        // Verify again
        await page.goto('https://www.edgeprop.sg', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await humanPause(3000, 4000);
        
        const bookmarkCheck = page.locator('[href*="/bookmarks"], a:has-text("Bookmarks")').first();
        const loggedInCheck = await bookmarkCheck.isVisible({ timeout: 3000 }).catch(() => false);
        
        if (!loggedInCheck) {
          console.error('❌ Still not logged in after re-authentication!');
          console.error('   Please check the browser window to see what happened during authentication.');
          process.exit(1);
        }
        
        console.log('✅ Authentication verified after re-auth!');
      } else {
        console.log('⚠️  Could not verify login status, but continuing...');
      }
    }
  } catch (verifyError) {
    console.log(`⚠️  Could not verify authentication: ${verifyError}`);
    console.log('   Continuing anyway...');
  }

  // Remove automation indicators (crucial for bypassing Cloudflare/bot detection)
  await context.addInitScript(() => {
    // Override the navigator.webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Mock chrome object
    (window as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome = {
      runtime: {},
    };
    
    // Mock permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: PermissionDescriptor) => (
      (parameters as PermissionDescriptor & { name: string }).name === 'notifications' ?
        Promise.resolve({ state: Notification.permission } as PermissionStatus) :
        originalQuery(parameters)
    );
  });
  
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalErrors = 0;
  let totalSkipped = 0; // Track duplicates/already processed
  const startTime = Date.now();
  let currentPage = 1;
  
  // Make sure shouldStop is accessible in all scopes
  // (declared earlier, but ensure it's in the right scope)

  // page is already declared above, just use it

  try {
    // Base URL (page will be appended in the loop)
    const baseUrl = 'https://www.edgeprop.sg/property-search?listing_type=sale&property_type=9%252C103%252C107%252C105%252C106%252C104&district=&bedroom_min=&asking_price_min=1000000&asking_price_max=3000000&floor_area_min=&floor_area_max=&land_area_min=&land_area_max=&tenure=&bathroom=&furnishing=&completed=&level=&completion_year_min=&completion_year_max=&rental_yield=&high_rental_volume=&high_sales_volume=&deals=&nearby_amenities=&amenities_distance=500&rental_type=&keyword_features=&keyword=&mrt_keywords=&school_keywords=&hdbtowns_keywords=&areas_keywords=&district_keywords=&asset_id=&resource_type=&x=&y=&radius=1000&search_by=&search_by_distance=&search_by_location=&search_by_showmap=true&below_valuation=&map_zoom=&asset_lat=&asset_lng=&pageSize=20&order_by=recommended&fittings=&with_new_launches=0&area=&region=&subzone=&subzone_keywords=';
    
    // Loop through pages
    while (currentPage <= maxPages && !shouldStop) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📄 PAGE ${currentPage}/${maxPages}`);
      console.log(`${'='.repeat(60)}`);
      
      // Check if we should stop
      if (shouldStop) {
        console.log('🛑 Stopping scraper...');
        break;
      }
      
      // Update lock file with current progress
      jobStatus.progress.currentPage = currentPage;
      jobStatus.progress.listingsProcessed = totalSuccess;
      jobStatus.progress.listingsAttempted = totalProcessed;
      jobStatus.statusMessage = `Scraping page ${currentPage}/${maxPages}`;
      fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
      
      // Update database job status if jobId provided
      if (jobId) {
        try {
          await supabase
            .from('scraper_jobs')
            .update({ 
              current_page: currentPage,
              listings_processed: totalSuccess,
              stats: {
                saved: totalSuccess,
                skipped: totalSkipped,
                errors: totalErrors
              }
            })
            .eq('id', jobId);
        } catch (error) {
          // Ignore database update errors
        }
      }
      
      const searchUrl = `${baseUrl}&page=${currentPage}`;
      
      console.log(`📖 Navigating to page ${currentPage}...`);
      
      // Try navigation with retry and fallback strategies
      let navigationSuccess = false;
      const navigationStrategies = [
        { waitUntil: 'domcontentloaded' as const, timeout: 90000 },
        { waitUntil: 'load' as const, timeout: 90000 },
        { waitUntil: 'commit' as const, timeout: 90000 }
      ];
      
      for (let attempt = 0; attempt < navigationStrategies.length && !navigationSuccess; attempt++) {                     
        try {
          const strategy = navigationStrategies[attempt];
          console.log(`   Attempt ${attempt + 1}/${navigationStrategies.length}: ${strategy.waitUntil}...`);
          
          const response = await page.goto(searchUrl, { waitUntil: strategy.waitUntil, timeout: strategy.timeout });
          
          // Check for 502 Bad Gateway or other Cloudflare errors
          if (response && (response.status() === 502 || response.status() === 503 || response.status() === 504)) {
            console.log(`   ⚠️  Received ${response.status()} error (Bad Gateway), refreshing page...`);
            await humanPause(3000, 5000); // Wait before retry
            await page.reload({ waitUntil: strategy.waitUntil, timeout: strategy.timeout });
            // Check status again after reload
            const reloadResponse = await page.waitForResponse(
              (resp) => resp.url().includes(searchUrl) || resp.url().includes('edgeprop.sg'),
              { timeout: 10000 }
            ).catch(() => null);
            
            if (reloadResponse && (reloadResponse.status() === 502 || reloadResponse.status() === 503 || reloadResponse.status() === 504)) {
              throw new Error(`Still getting ${reloadResponse.status()} after reload`);
            }
            console.log(`   ✅ Page refreshed successfully after ${response.status()} error`);
          }
          
          navigationSuccess = true;
          console.log(`   ✅ Navigation successful with ${strategy.waitUntil}`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const is502Error = errorMsg.includes('502') || errorMsg.includes('Bad Gateway') || errorMsg.includes('Bad gateway');
          
          if (is502Error) {
            console.log(`   ⚠️  502 Bad Gateway detected, refreshing page...`);
            try {
              await humanPause(3000, 5000);
              await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
              navigationSuccess = true;
              console.log(`   ✅ Page refreshed successfully after 502 error`);
              break;
            } catch (refreshError) {
              console.log(`   ⚠️  Refresh failed: ${refreshError}`);
              if (attempt < navigationStrategies.length - 1) {
                console.log(`   🔄 Trying next strategy...`);
                await humanPause(2000, 3000);
              }
            }
          } else {
            console.log(`   ⚠️  Navigation attempt ${attempt + 1} failed: ${errorMsg.substring(0, 100)}`);
            if (attempt < navigationStrategies.length - 1) {
              console.log(`   🔄 Trying next strategy...`);
              await humanPause(2000, 3000); // Wait before retry
            }
          }
        }
      }
      
      if (!navigationSuccess) {
        throw new Error(`Failed to navigate to page ${currentPage} after ${navigationStrategies.length} attempts`);
      }
      
      // Wait for content to load (reduced for speed)
      console.log(`⏳ Waiting for content to load...`);
      await humanPause(3000, 4000);
    
            // Find property listings using listing links directly (most reliable method)                                       
      const resultContainer = page.locator('#result-container');
      
      // Find all listing links
      const listingLinks = await resultContainer.locator('a[href*="/listing/"]').all();                                  
      console.log(`📦 Found ${listingLinks.length} listing links in result container`);                                    
      
      // Filter for unique listings and extract property names and URLs
      // Store URLs separately to avoid stale element references after navigation
      const propertyData = [];
      const seenUrls = new Set<string>();
      
      for (const link of listingLinks) {
        const href = await link.getAttribute('href').catch(() => '') || '';
        if (!href) continue;
        
        const fullUrl = href.startsWith('http') ? href : `https://www.edgeprop.sg${href}`;
        
        // Skip duplicates
        if (seenUrls.has(fullUrl)) continue;
        seenUrls.add(fullUrl);
        
        // Try to find property name from nearby heading
        // The heading h2.jsx-911604640 is in the same container as the link
        let propertyName = '';
        
        // First, try to find the main-container-listing that contains both link and heading
        try {
          const container = link.locator('xpath=ancestor::*[contains(@class, "main-container-listing")][1]');
          const containerExists = await container.count().catch(() => 0);
          
          if (containerExists > 0) {
            // Look for h2.jsx-911604640 in this container
            const heading = container.locator('h2.jsx-911604640').first();
            const headingText = await heading.textContent({ timeout: 2000 }).catch(() => '') || '';
            propertyName = headingText.trim();
          }
        } catch (e) {
          // Fallback: try to find any h2 in ancestor containers
          try {
            const container = link.locator('xpath=ancestor::*[contains(@class, "listing") or contains(@class, "property") or contains(@class, "main-container")][1]');
            const heading = container.locator('h2').first();
            const headingText = await heading.textContent({ timeout: 2000 }).catch(() => '') || '';
            propertyName = headingText.trim();
          } catch (e2) {
            // Last resort: extract from URL
            const urlMatch = fullUrl.match(/\/([^\/]+)\/m_\d+$/);
            if (urlMatch) {
              propertyName = urlMatch[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            }
          }
        }
        
        // Skip if no valid name found or if it's a page title
        if (!propertyName || propertyName.length < 3 || propertyName.length > 100) continue;
        if (propertyName.includes('Property for Sale') || propertyName.includes('listings')) continue;
        
        // Store URL and name - don't store the locator element (it will become stale)
        propertyData.push({ url: fullUrl, text: propertyName });
          
          // Stop at 20 listings (EdgeProp shows exactly 20 per page)
          if (propertyData.length >= 20) {
            break;
        }
      }
      
      // Convert to format expected by processing loop
      const propertyNames = propertyData.map(({ url, text }) => ({ url, text }));
      
      console.log(`🏠 Found ${propertyNames.length} property listings`);
      
      if (propertyNames.length === 0) {
        console.log('❌ No property names found on this page');
        console.log('   This might indicate the page structure changed or the page did not load correctly.');
        console.log('   Checking if we should continue...');
        
        // If we're on page 1 and no listings found, this is a problem
        if (currentPage === 1) {
          console.error('❌ No listings found on first page! This indicates a serious problem:');
          console.error('   - Page structure may have changed');
          console.error('   - Search URL may be incorrect');
          console.error('   - Cloudflare/Authentication may have blocked the page');
          throw new Error('No listings found on first page - cannot continue scraping');
        }
        
        // If on later pages, just break (reached end of results)
        console.log(`   No listings on page ${currentPage}, assuming end of results`);
        break;
      }
      
      // Process exactly 20 properties per page (EdgeProp shows exactly 20 per page)
      // If we found more than 20, take only the first 20
      const processCount = Math.min(20, propertyNames.length);
      console.log(`\n🧪 Processing ${processCount} properties on page ${currentPage}/${maxPages}:`);
      
      if (propertyNames.length > 20) {
        console.log(`⚠️  Found ${propertyNames.length} listings but EdgeProp shows only 20 per page. Taking first 20.`);
      }
      
      for (let i = 0; i < processCount && !shouldStop; i++) {
        // Check if we should stop before processing each property
        if (shouldStop) {
          console.log('🛑 Stopping scraper...');
          break;
        }
        
        const { url: listingUrl, text: propertyName } = propertyNames[i];
        const propertyStartTime = Date.now();
        console.log(`\n--- Property ${i + 1}/${processCount}: ${propertyName} ---`);
        
        try {
          let stepStart = Date.now();
          
          // Navigate directly to listing page (EdgeProp listings open in same window, not popups)
          console.log(`🖱️  Navigating to listing page to extract all details... (${Date.now() - propertyStartTime}ms)`);
          let listingPage: Page = page; // Use same page - no popups
          const originalSearchUrl = page.url();
          
          try {
            console.log(`   🔄 Navigating directly to: ${listingUrl}`);
            
            // Navigate directly in the same window with 502 error handling and retries
            let listingNavSuccess = false;
            for (let retry = 0; retry < 3 && !listingNavSuccess; retry++) {
              try {
                const response = await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
                
                // Check for 502 Bad Gateway
                if (response && (response.status() === 502 || response.status() === 503 || response.status() === 504)) {
                  console.log(`   ⚠️  Received ${response.status()} error on listing page, refreshing...`);
                  await humanPause(2000, 3000);
                  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                  console.log(`   ✅ Listing page refreshed after ${response.status()} error`);
                }
                
                listingNavSuccess = true;
                listingPage = page;
                console.log(`✅ Navigated to listing page (${Date.now() - stepStart}ms, total: ${Date.now() - propertyStartTime}ms)`);
              } catch (navErr) {
                const errorMsg = navErr instanceof Error ? navErr.message : String(navErr);
                const is502Error = errorMsg.includes('502') || errorMsg.includes('Bad Gateway');
                
                if (is502Error && retry < 2) {
                  console.log(`   ⚠️  502 error on listing navigation, retrying... (${retry + 1}/3)`);
                  await humanPause(3000, 5000);
                  try {
                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                    listingNavSuccess = true;
                    listingPage = page;
                    console.log(`   ✅ Listing page refreshed successfully`);
                    break;
                  } catch (reloadErr) {
                    // Continue to next retry
                  }
                } else if (retry < 2) {
                  throw navErr; // Re-throw if not 502
                } else {
                  throw navErr; // Re-throw on final attempt
                }
              }
            }
            
            if (!listingNavSuccess) {
              throw new Error(`Failed to navigate to listing after 3 attempts`);
            }
          } catch (navError) {
            // Fallback: try direct navigation one more time with longer timeout
            console.log(`   ⚠️  First navigation attempt failed, retrying with longer timeout...`);
            
            try {
              await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
              listingPage = page;
              console.log(`✅ Navigated directly to listing page (retry)`);
            } catch (retryError) {
              throw new Error(`Failed to open listing after retries: ${navError}. Retry also failed: ${retryError}`);
            }
          }
          
          await humanPause(2000, 3000);
          
          // Wait for listing page to fully load
          try {
            await listingPage.waitForLoadState('domcontentloaded', { timeout: 10000 });
          } catch (e) {
            console.log('   ⚠️  Listing page load state timeout, continuing anyway...');
          }
          await humanPause(1500, 2500);
          
          // Scroll down to find agent section with phone button
          try {
            await listingPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
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
              // Click the exact phone button to reveal the phone number
              // Priority: button.jsx-3667944064.mobile-btn (exact match)
              let phoneButtonClicked = false;
              
              try {
                // First try the exact selector
                const phoneButton = listingPage.locator('button.jsx-3667944064.mobile-btn').first();
                const phoneButtonExists = await phoneButton.count().catch(() => 0);
                
                if (phoneButtonExists > 0) {
                  // Scroll button into view and ensure it's visible before clicking
                  try {
                    // First, scroll the button into view using page.evaluate
                    await listingPage.evaluate(() => {
                      const btn = document.querySelector('button.jsx-3667944064.mobile-btn');
                      if (btn) {
                        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    });
                    // Wait for smooth scroll to complete
                    await humanPause(2000, 2500);
                    
                    // Verify the button is now in viewport using evaluate
                    const isInViewport = await listingPage.evaluate(() => {
                      const btn = document.querySelector('button.jsx-3667944064.mobile-btn');
                      if (!btn) return false;
                      const rect = btn.getBoundingClientRect();
                      return rect.top >= 0 && rect.left >= 0 && 
                             rect.bottom <= window.innerHeight && 
                             rect.right <= window.innerWidth;
                    });
                    
                    if (!isInViewport) {
                      // If still not in viewport, try instant scroll
                      await listingPage.evaluate(() => {
                        const btn = document.querySelector('button.jsx-3667944064.mobile-btn');
                        if (btn) {
                          btn.scrollIntoView({ behavior: 'instant', block: 'center' });
                        }
                      });
                      await humanPause(500, 800);
                    }
                    
                    // Wait for button to be visible and attached
                    await phoneButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
                    
                    // Use JavaScript click via evaluate - this works even if element is not in viewport
                    const clickResult = await listingPage.evaluate(() => {
                      const btn = document.querySelector('button.jsx-3667944064.mobile-btn') as HTMLElement;
                      if (btn) {
                        btn.click();
                        return true;
                      }
                      return false;
                    }).catch(() => false);
                    
                    if (clickResult) {
                      phoneButtonClicked = true;
                      console.log(`   ✅ Clicked phone button (button.jsx-3667944064.mobile-btn via JS)`);
                    } else {
                      // Fallback: try Playwright click with force
                      try {
                        await phoneButton.click({ timeout: 5000, force: true });
                        phoneButtonClicked = true;
                        console.log(`   ✅ Clicked phone button (force click fallback)`);
                      } catch (clickError) {
                        console.log(`   ⚠️  All click methods failed: ${clickError}`);
                      }
                    }
                    
                    // Wait for modal/API response to reveal phone number - wait longer for authenticated users
                    await humanPause(5000, 6000);
                  } catch (e) {
                    console.log(`   ⚠️  Scroll/click failed: ${e}`);
                  }
                } else {
                  // Fallback: try button.mobile-btn if exact selector doesn't work
                  const fallbackButton = listingPage.locator('button.mobile-btn').first();
                  const fallbackExists = await fallbackButton.count().catch(() => 0);
                  
                  if (fallbackExists > 0) {
                    await listingPage.evaluate(() => {
                      const btn = document.querySelector('button.mobile-btn');
                      if (btn) {
                        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    });
                    await humanPause(1500, 2000);
                    
                    try {
                      await fallbackButton.click({ timeout: 5000, force: false });
                      phoneButtonClicked = true;
                      console.log(`   ✅ Clicked phone button (button.mobile-btn fallback)`);
                    } catch (clickError) {
                      await fallbackButton.click({ timeout: 5000, force: true });
                      phoneButtonClicked = true;
                      console.log(`   ✅ Clicked phone button (button.mobile-btn force click)`);
                    }
                    
                    await humanPause(5000, 6000);
                  }
                }
              } catch (e) {
                console.log(`   ⚠️  Could not click phone button: ${e}`);
              }
              
              if (!phoneButtonClicked) {
                console.log(`   ⚠️  Could not find or click phone button`);
              }
              
              // Extract phone number after clicking the button - only use tel: link
              // Wait for tel: link to appear (it might take time after clicking)
              if (!cleanPhone) {
                try {
                  // Wait for tel: link to appear with retries (API might take time)
                  let telLink = null;
                  for (let telRetry = 0; telRetry < 3 && !telLink; telRetry++) {
                    telLink = listingPage.locator('a[href^="tel:"]').first();
                    const telLinkExists = await telLink.count().catch(() => 0);
                    
                    if (telLinkExists > 0) {
                      break;
                    }
                    
                    // Wait before retry
                    if (telRetry < 2) {
                      await humanPause(2000, 3000);
                    }
                  }
                  
                  const telLinkExists = telLink ? await telLink.count().catch(() => 0) : 0;
                  
                  if (telLink && telLinkExists > 0) {
                    // Try getting text content first
                    const telLinkText = await telLink.textContent({ timeout: 2000 }).catch(() => null);
                    if (telLinkText) {
                      cleanPhone = cleanPhoneNumber(telLinkText);
                      if (cleanPhone) {
                        console.log(`   📱 Phone (from tel: link text): ${cleanPhone}`);
                      }
                    }
                    
                    // If text didn't work, try extracting from href attribute
                    if (!cleanPhone) {
                      const telLinkHref = await telLink.getAttribute('href').catch(() => null);
                      if (telLinkHref) {
                        // Extract phone number from tel: href (e.g., tel:+6597012345 or tel:6597012345)
                        const phoneMatch = telLinkHref.match(/tel:\+?65(\d{8})|tel:65(\d{8})|tel:(\d{10})/);
                        if (phoneMatch) {
                          const fullPhone = phoneMatch[1] || phoneMatch[2] || phoneMatch[3];
                          if (fullPhone) {
                            // Build candidate number
                            let candidate = '';
                            if (fullPhone.length === 8) {
                              candidate = `65${fullPhone}`;
                            } else if (fullPhone.length === 10 && fullPhone.startsWith('65')) {
                              candidate = fullPhone;
                            } else {
                              candidate = cleanPhoneNumber(fullPhone);
                            }
                            
                            // Validate: must start with 659 or 658
                            if (candidate && (candidate.startsWith('659') || candidate.startsWith('658'))) {
                              cleanPhone = candidate;
                              console.log(`   📱 Phone (from tel: href): ${cleanPhone}`);
                            } else {
                              console.log(`   ⚠️  Phone number found but invalid (must start with 659 or 658): ${candidate}`);
                            }
                          }
                        }
                      }
                    }
                  } else {
                    console.log(`   ⚠️  No tel: link found after clicking phone button (waited up to 10 seconds)`);
                  }
                } catch (e) {
                  console.log(`   ⚠️  Could not extract from tel: link: ${e}`);
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
            const listingInfoContainer = listingPage.locator('.jsx-2586815543.listing-info-container.listing-info');
            const listingInfoText = await listingInfoContainer.textContent({ timeout: 2000 }).catch(() => '') || '';
            
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
          
          // Extract agent name using your specific selector
          try {
            agentName = await listingPage.locator('.jsx-3667944064.agent-name-wrapper').textContent({ timeout: 2000 }).catch(() => '') || '';
            agentName = agentName.trim();
            console.log(`   👤 Agent name: ${agentName}`);
          } catch (error: unknown) {
            console.log(`   ⚠️  Could not extract agent name: ${error}`);
          }
          
          // Extract address and more details from _keydetails
          try {
            // Extract listing info
            const listingInfo = await listingPage.locator('[id="_keydetails"]').first();
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
            let detailsText = await listingPage.locator('[id="_keydetails"] div').filter({ 
              hasText: /Avenue|Road|Street|Drive|Lane|Walk|Close|Crescent|Place|Park|Way|Hill|View|Estate|Jalan|Lorong|Bukit|Taman/ 
            }).first().textContent({ timeout: 2000 }).catch(() => '') || '';
            
            // If no match, try getting the first div in _keydetails (fallback)
            if (!detailsText) {
              detailsText = await listingPage.locator('[id="_keydetails"] div').first().textContent({ timeout: 2000 }).catch(() => '') || '';
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
          
          // Extract price from listing page
          let priceElement = null;
          let price = undefined;
          try {
            const priceTexts = await listingPage.getByText(/\$\s*[\d,]+/).all();
            if (priceTexts.length > 1) {
              priceElement = await priceTexts[1].textContent({ timeout: 1000 }).catch(() => null);
            } else if (priceTexts.length > 0) {
              priceElement = await priceTexts[0].textContent({ timeout: 1000 }).catch(() => null);
            }
            price = priceElement ? parsePrice(priceElement) : undefined;
          } catch (error: unknown) {
            console.log(`   ⚠️  Could not extract price from listing page`);
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
            console.log(`   💾 Attempting to save listing to database...`);
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
                  source_url: listingPage.url(),
                },
                listing: {
                  portal: 'edgeprop',
                  url: listingPage.url(),
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
              
              console.log(`   ✅ Successfully saved to database: ${agentName} (${cleanPhone})`);
              console.log(`   📊 Listing URL: ${listingPage.url()}`);
              totalSuccess++;
              totalProcessed++; // Increment here for successful saves
              
              // Update lock file with latest progress
              jobStatus.progress.listingsProcessed = totalSuccess;                                                        
              jobStatus.progress.listingsAttempted = totalProcessed;                                                      
              jobStatus.stats = {
                totalProcessed,
                totalSuccess,
                totalErrors,
                totalSkipped
              };
              fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
              
              // Update database job status if jobId provided
              if (jobId) {
                try {
                  await supabase
                    .from('scraper_jobs')
                    .update({ 
                      listings_processed: totalSuccess,
                      stats: {
                        saved: totalSuccess,
                        skipped: totalSkipped,
                        errors: totalErrors
                      }
                    })
                    .eq('id', jobId);
                } catch (error) {
                  // Ignore database update errors
                }
              }
            } catch (dbError: unknown) {
              // Check if it's a duplicate error (unique constraint violation)
              const errorObj = dbError as { message?: string; code?: string };
              if (errorObj?.message?.includes('duplicate') || errorObj?.code === '23505') {
                console.log(`   ⏭️  Skipped duplicate listing: ${propertyName}`);
                totalSkipped++;
              } else {
                console.error(`   ❌ Database error saving listing: ${dbError}`);
                console.error(`   Error details: ${JSON.stringify(errorObj, null, 2)}`);
                totalErrors++;
              }
              
              totalProcessed++;
            }
          } else {
            console.log(`⚠️  Missing agent info - Name: ${agentName || 'Not found'}, Phone: ${cleanPhone || 'Not found'}`);
            console.log(`   ⚠️  Listing NOT saved to database - skipping this listing`);
            totalErrors++;
            totalProcessed++; // Increment here for missing agent info
            
            // Update lock file to reflect this error
            jobStatus.progress.listingsAttempted = totalProcessed;
            jobStatus.progress.listingsProcessed = totalSuccess;
            jobStatus.stats = {
              totalProcessed,
              totalSuccess,
              totalErrors,
              totalSkipped
            };
            fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
            
            // Update database job status
            if (jobId) {
              try {
                await supabase
                  .from('scraper_jobs')
                  .update({ 
                    listings_processed: totalSuccess,
                    stats: {
                      saved: totalSuccess,
                      skipped: totalSkipped,
                      errors: totalErrors
                    }
                  })
                  .eq('id', jobId);
              } catch (error) {
                // Ignore database update errors
              }
            }
          }
          
          // Navigate back to search results page after processing listing
          if (listingPage.url().includes('/listing/')) {
            try {
              console.log(`   ↩️  Navigating back to search results...`);
              await listingPage.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
              // Wait for page to be fully ready and result container to be visible
              await listingPage.waitForSelector('#result-container', { timeout: 10000 }).catch(() => null);
              await humanPause(3000, 4000); // Wait longer for content to reload
              console.log(`   ✅ Back to search results`);
            } catch (backError) {
              // If goBack fails, navigate directly to search URL
              console.log(`   ⚠️  goBack failed, navigating directly to search page...`);
              try {
                // Reconstruct search URL from current page context
                const currentPageNum = currentPage;
                const fallbackSearchUrl = `${baseUrl}&page=${currentPageNum}`;
                await listingPage.goto(fallbackSearchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // Wait for result container after navigation
                await listingPage.waitForSelector('#result-container', { timeout: 10000 }).catch(() => null);
                await humanPause(3000, 4000);
                console.log(`   ✅ Navigated back to search page`);
              } catch (navBackError) {
                console.log(`   ⚠️  Failed to navigate back: ${navBackError}`);
                // Continue anyway - we'll try to find listings on current page
              }
            }
          }
          
          // Note: totalProcessed is now incremented in each path above (success, error, missing info)
          
          // Update lock file after each property attempt
          jobStatus.progress.listingsAttempted = totalProcessed;
          jobStatus.progress.listingsProcessed = totalSuccess;
          fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
          
        } catch (error: unknown) {
          console.error(`❌ Error processing property ${i + 1}:`, error);
          totalErrors++;
          totalProcessed++;
          
          // Update lock file after error
          jobStatus.progress.listingsAttempted = totalProcessed;
          jobStatus.progress.listingsProcessed = totalSuccess;
          fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
          
          // Try to close popup if it's still open
          try {
            const pages = context.pages();
            if (pages.length > 1) {
              await pages[pages.length - 1].close();
            }
          } catch (_closeError) {
            // Ignore close errors
          }
        }
      } // End of property loop
      
      console.log(`\n✅ Page ${currentPage} completed: ${propertyNames.length} properties found`);
      console.log(`   📊 Stats so far: ${totalSuccess} saved, ${totalSkipped} skipped, ${totalErrors} errors, ${totalProcessed} total processed`);
      
      // Wait before going to next page (reduced for speed)
      if (currentPage < maxPages) {
        console.log(`⏳ Waiting before next page...`);
        await humanPause(1000, 1500);
      }
      
      currentPage++;
    } // End of while loop
    
    // Check if we stopped early
    if (shouldStop) {
      console.log('\n🛑 Scraper stopped by user');
      jobStatus.status = 'failed';
      jobStatus.statusMessage = 'Stopped by user';
      jobStatus.completedAt = new Date().toISOString();
      jobStatus.stats = {
        totalProcessed,
        totalSuccess,
        totalErrors,
        totalSkipped
      };
      
      // Update lock file
      if (fs.existsSync(lockFile)) {
        fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
      }
      
      // Update database
      if (jobId) {
        try {
          await supabase
            .from('scraper_jobs')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: 'Stopped by user',
              listings_processed: totalSuccess,
              stats: {
                saved: totalSuccess,
                skipped: totalSkipped,
                errors: totalErrors
              }
            })
            .eq('id', jobId);
        } catch (dbError) {
          console.error('⚠️  Failed to update job status:', dbError);
        }
      }
    }
    
  } catch (error: unknown) {
    console.error('❌ Fatal error during scraping:', error);
    
    // Update job status to failed
    if (jobId) {
      try {
        await supabase
          .from('scraper_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : String(error)
          })
          .eq('id', jobId);
      } catch (dbError) {
        console.error('⚠️  Failed to update job status:', dbError);
      }
    }
  } finally {
    await browser.close();
    
    const endTime = Date.now();
    const totalTime = Math.round((endTime - startTime) / 1000);
    const avgTimePerListing = totalProcessed > 0 ? Math.round(totalTime / totalProcessed) : 0;
    
    const finalStats = {
      totalProcessed,
      totalSuccess,
      totalErrors,
      totalSkipped
    };
    
    // Update lock file with final stats
    // Only mark as completed if we actually processed something
    if (totalProcessed === 0) {
      jobStatus.status = 'failed';
      jobStatus.statusMessage = 'No listings were processed. This may indicate a page structure change or authentication issue.';
    } else {
      jobStatus.status = 'completed';
    }
    jobStatus.completedAt = new Date().toISOString();
    jobStatus.stats = finalStats;
    jobStatus.progress.listingsProcessed = totalSuccess;
    
    // Save completed lock file and remove active lock
    if (fs.existsSync(lockFile)) {
      const completedFile = lockFile.replace('.lock', '.completed.json');
      fs.writeFileSync(completedFile, JSON.stringify(jobStatus, null, 2));
      fs.unlinkSync(lockFile);
      console.log('🔓 Lock file removed, job marked as completed\n');
    }
    
    // Update database job status to completed
    if (jobId) {
      try {
        // Only mark as completed if we actually processed something
        // If totalProcessed is 0, mark as failed instead
        const finalStatus = totalProcessed === 0 ? 'failed' : 'completed';
        const errorMessage = totalProcessed === 0 
          ? 'Job completed but no listings were processed. This may indicate a page structure change or authentication issue.'
          : null;
        
        await supabase
          .from('scraper_jobs')
          .update({
            status: finalStatus,
            completed_at: new Date().toISOString(),
            listings_processed: totalSuccess,
            error_message: errorMessage,
            stats: {
              saved: totalSuccess,
              skipped: totalSkipped,
              errors: totalErrors
            }
          })
          .eq('id', jobId);
        
        if (finalStatus === 'completed') {
          console.log('✅ Database job status updated to completed');
        } else {
          console.log('⚠️  Database job status updated to failed (no listings processed)');
        }
      } catch (dbError) {
        console.error('⚠️  Failed to update database job status:', dbError);
      }
    }
    
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
  }
}

// Run the scraper
scrapeEdgePropFinal().catch((error) => {
  console.error('❌ Fatal error:', error);
  
  // Clean up lock file on fatal error
  const lockFile = path.join(process.cwd(), 'storage', 'ep-scraper.lock');
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
    console.log('🔓 Lock file removed due to error');
  }
  
  // Update job status to failed if jobId exists
  const jobId = process.env.EP_JOB_ID;
  if (jobId) {
    (async () => {
      try {
        await supabase
          .from('scraper_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : String(error)
          })
          .eq('id', jobId);
      } catch {
        // Ignore errors
      }
  process.exit(1);
    })();
  } else {
    process.exit(1);
  }
});

export { scrapeEdgePropFinal };
