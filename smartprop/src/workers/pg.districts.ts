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

import { chromium, type Page, type BrowserContextOptions } from 'playwright-ghost';
import plugins from 'playwright-ghost/plugins';
import path from 'path';
import fs from 'fs';
import { CHROME_UA, humanPause } from './stealth.js';
import { upsertAgentAndListing } from './upsert.js';
import { execSync, exec } from 'child_process';
import { supabase } from './supa.js';

// Helper function to re-authenticate if needed
async function reAuthenticate() {
  console.log('\n🔄 Re-authenticating to PropertyGuru...');
  try {
    execSync('bun src/workers/auth.pg.ts', { 
      cwd: process.cwd(),
      stdio: 'inherit' 
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
    
    // If lock is older than 2 hours, assume stale and remove
    if (lockAge > 2 * 60 * 60 * 1000) {
      console.log('⚠️  Found stale lock file (>2h old), removing...');
      fs.unlinkSync(lockFile);
    } else {
      console.error('❌ Another PropertyGuru scraper is already running!');
      console.error(`   Started: ${lockData.startedAt}`);
      console.error(`   Districts: ${lockData.districts}`);
      console.error('   Wait for it to complete or delete storage/pg-scraper.lock manually.');
      process.exit(1);
    }
  }

  // Parse configuration from environment
  const districtsInput = process.env.PG_DISTRICTS || 'ALL';
  const minPrice = parseInt(process.env.PG_MIN_PRICE || '1000000', 10);
  const maxPrice = parseInt(process.env.PG_MAX_PRICE || '3000000', 10);
  const maxPagesPerDistrict = parseInt(process.env.PG_MAX_PAGES || '3', 10);

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
        process.exit(1);
      }
      districts.push(district);
    }
  }
  
  if (districts.length === 0) {
    console.error('❌ No valid districts specified!');
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
  
  console.log('🚀 Starting PropertyGuru District-based Scraper...');
  console.log(`📍 Districts to scrape: ${districts.join(', ')}`);
  console.log(`💰 Price range: $${minPrice.toLocaleString()} - $${maxPrice.toLocaleString()}`);
  console.log(`📄 Max pages per district: ${maxPagesPerDistrict}`);
  console.log(`🔧 Environment: PG_DISTRICTS=${process.env.PG_DISTRICTS}, PG_MAX_PAGES=${process.env.PG_MAX_PAGES}, PG_JOB_ID=${process.env.PG_JOB_ID}`);
  console.log('');

  const stateFilePath = path.join(process.cwd(), 'storage', 'pg.state.json');
  const hasStorageState = fs.existsSync(stateFilePath);
  
  if (!hasStorageState) {
    console.log('⚠️  No storage state found - running without authentication');
    console.log('💡 Run `bun run auth:pg` first to save login state\n');
  }

  // Pre-flight authentication check
  if (hasStorageState) {
    console.log('🔍 Pre-flight check: Testing authentication state...');
    try {
      const testBrowser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--no-sandbox',
        ]
      });

      const testContext = await testBrowser.newContext({
        userAgent: CHROME_UA,
        storageState: stateFilePath,
      });

      const testPage = await testContext.newPage();
      
      // Navigate to a test listing to check if we can see phone numbers
      await testPage.goto('https://www.propertyguru.com.sg/property-for-sale?listingType=sale&page=1&districtCode=D09', { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });
      
      await testPage.waitForTimeout(2000);
      
      // Try to get a listing URL to test
      const firstListingUrl = await testPage.locator('div.hui-card.primary.flat.listing-card-v2 a[href*="/listing/"]').first().getAttribute('href');
      
      if (firstListingUrl) {
        const listingPage = await testContext.newPage();
        await listingPage.goto(firstListingUrl.startsWith('http') ? firstListingUrl : `https://www.propertyguru.com.sg${firstListingUrl}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        await listingPage.waitForTimeout(2000);
        
        // Scroll down to ensure agent section loads
        await listingPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await listingPage.waitForTimeout(500);
        
        // Try to find phone number - use the same logic as the scraper
        let phoneFound = false;
        try {
          await humanPause(1000, 1500);
          
          // First check if phone is already visible
          const directPhoneLink = await listingPage.locator('a[href^="tel:"]').first().textContent({ timeout: 2000 }).catch(() => null);
          if (directPhoneLink) {
            phoneFound = true;
          } else {
            // Try clicking "Other ways to enquire" and "View Phone Number" buttons
            const otherWaysButtonSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.agent-section-desktop.rich-contact--enabled.col-lg-4.col-md-12 > div > div > div > div > div.card-body > div > div.extended-view-root > div.actionable-link.contact-button-root.extend-view-trigger-point';
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
                const phoneText = await listingPage.locator('a[href^="tel:"]').first().textContent({ timeout: 3000 }).catch(() => null);
                if (phoneText) {
                  phoneFound = true;
                }
              }
            }
          }
        } catch (_error) {
          // Phone extraction failed
        }
        
        await listingPage.close();
        
        if (phoneFound) {
          console.log('✅ Authentication state is valid - phone numbers accessible');
        } else {
          console.log('⚠️  Authentication may be stale - cannot see phone numbers');
          console.log('🔄 Triggering re-authentication before scraping...\n');
          await testBrowser.close();
          
          // Re-authenticate
          await reAuthenticate();
          
          // Restart the scraper with fresh auth by reimporting the function
          console.log('✅ Re-authentication complete! Restarting scraper with fresh auth...');
          
          if (fs.existsSync(lockFile)) {
            fs.unlinkSync(lockFile);
          }
          
          // Use execSync to wait for the restart to complete
          const cwd = process.cwd();
          const districts = process.env.PG_DISTRICTS || 'ALL';
          const maxPages = process.env.PG_MAX_PAGES || '3';
          const jobId = process.env.PG_JOB_ID || '';
          
          const restartCmd = `cd ${cwd} && PG_DISTRICTS="${districts}" PG_MAX_PAGES=${maxPages} PG_JOB_ID="${jobId}" bun src/workers/pg.districts.ts`;
          execSync(restartCmd, { stdio: 'inherit', cwd: process.cwd() });
          
          // If we get here, the restart completed, so exit this process
          process.exit(0);
        }
      }
      
      await testBrowser.close();
    } catch (error: unknown) {
      console.log('⚠️  Pre-flight check failed, but continuing anyway...');
    }
    console.log('');
  }

  // Launch browser once for all districts
  const browser = await chromium.launch({
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
    ]
  });

  const contextOptions: BrowserContextOptions = {
    userAgent: CHROME_UA,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 },
    colorScheme: 'light' as const,
    extraHTTPHeaders: {
      'Accept-Language': 'en-SG,en;q=0.9',
    }
  };

  if (hasStorageState) {
    contextOptions.storageState = stateFilePath;
  }

  const context = await browser.newContext(contextOptions);

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const overallStats = {
    totalDistricts: 0,
    totalListings: 0,
    totalSuccess: 0,
    totalErrors: 0,
    totalSkippedNoPhone: 0,
  };

  let consecutiveNoPhone = 0;
  const MAX_CONSECUTIVE_NO_PHONE = 2; // Re-auth if 2 consecutive listings have no phone
  
  // Track processed URLs to avoid duplicates across pages
  const processedUrls = new Set<string>();

  // Loop through each district
  for (const district of districts) {
    const districtCode = `D${district}`;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📍 Starting District ${district} (${districtCode})`);
    console.log(`${'='.repeat(60)}`);

    overallStats.totalDistricts++;

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

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await humanPause(2000, 3000);

        // Check for Cloudflare
        const pageText = await page.textContent('body').catch(() => null);
        if (pageText && (pageText.includes('Pardon Our Interruption') || 
            pageText.includes('Verify you are human') ||
            pageText.includes('Enable JavaScript and cookies to continue'))) {
          console.log(`   🛡️  Cloudflare detected! Please run with headless: false to resolve manually.`);
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

          const listingPage = await context.newPage();

          // Add timeout wrapper for entire listing processing (60 seconds max)
          let listingTimedOut = false;
          const listingTimeout = setTimeout(() => {
            console.log(`   ⏱️  Listing timeout (60s) - forcing close...`);
            listingTimedOut = true;
            listingPage.close().catch(() => {});
          }, 60000);

          try {
            await listingPage.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Check if timed out during navigation
            if (listingTimedOut) {
              throw new Error('Listing navigation timed out');
            }
            
            await humanPause(600, 1400);
            
            if (listingTimedOut) {
              throw new Error('Listing processing timed out');
            }

            // Scroll down
            await listingPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await humanPause(500, 1000);
            
            if (listingTimedOut) {
              throw new Error('Listing processing timed out');
            }

            const title = await listingPage.title().catch(() => 'Untitled');

            // Extract price
            const priceSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.col-lg-8.col-md-12 > div.row > div > div.property-snapshot-section > div > div > div.price > h2';
            const priceText = await listingPage.locator(priceSelector).textContent().catch(() => '');
            const price = priceText ? parsePrice(priceText) : undefined;

            // Check for Cloudflare on listing page
            const listingPageText = await listingPage.textContent('body').catch(() => null);
            if (listingPageText && listingPageText.includes('Pardon Our Interruption')) {
              console.log(`   🛡️  Cloudflare detected. Skipping...`);
              overallStats.totalErrors++;
              await listingPage.close();
              continue;
            }

            // Extract agent name
            const agentName = await listingPage.locator('.agent-section-desktop .card-header .details-wrapper .agent-name, div.agent-info div.details-wrapper div:first-child').first().textContent().catch(() => null);

            // Extract structured property details
            const propertyDetails = await extractPropertyDetails(listingPage, title);

            // Extract agency
            const agency = await listingPage.locator('.agent-section-desktop .card-header .details-wrapper .agency-name, [class*="agency"]').first().textContent().catch(() => null);

            // Extract CEA registration number
            const ceaSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.agent-section-desktop.rich-contact--enabled.col-lg-4.col-md-12 > div > div > div > div > div.card-header > a > div.details-wrapper > span > div';
            const ceaText = await listingPage.locator(ceaSelector).textContent().catch(() => null);

            // Extract phone number
            let agentPhone = null;
            try {
              await humanPause(1000, 1500);

              const directPhoneLink = await listingPage.locator('a[href^="tel:"]').first().textContent({ timeout: 2000 }).catch(() => null);
              if (directPhoneLink) {
                agentPhone = directPhoneLink;
              } else {
                const otherWaysButtonSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.agent-section-desktop.rich-contact--enabled.col-lg-4.col-md-12 > div > div > div > div > div.card-body > div > div.extended-view-root > div.actionable-link.contact-button-root.extend-view-trigger-point';
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
              await listingPage.close();
              continue;
            }

            // Check for phone number - skip saving if not found to maintain data integrity
            if (!cleanPhone) {
              console.log(`   ⚠️  No phone number found - SKIPPING to maintain data integrity`);
              consecutiveNoPhone++;
              overallStats.totalSkippedNoPhone++;
              
              // If we've had too many consecutive failures, trigger re-authentication
              if (consecutiveNoPhone >= MAX_CONSECUTIVE_NO_PHONE) {
                console.log(`\n🚨 ${consecutiveNoPhone} consecutive listings without phone numbers!`);
                console.log(`🔄 Authentication may have expired. Triggering re-login...\n`);
                
                // Update status message
                jobStatus.statusMessage = '🔄 Re-authenticating...';
                fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
                
                await listingPage.close();
                await page.close();
                await browser.close();
                
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
                }, 2000); // 2 second delay to ensure auth state is settled
                
                return;
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
            
            // Update stats and progress in lock file for real-time display
            jobStatus.stats = overallStats;
            jobStatus.progress.listingsProcessed = overallStats.totalSuccess;
            fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));

          } catch (_error) {
            const errorMsg = _error instanceof Error ? _error.message : String(_error);
            console.error(`   ❌ Error: ${errorMsg}`);
            overallStats.totalErrors++;
            
            // If timeout, log it specifically
            if (listingTimedOut || errorMsg.includes('timeout')) {
              console.log(`   ⏭️  Skipping to next listing due to timeout`);
            }
          } finally {
            // Always clear timeout and close page
            clearTimeout(listingTimeout);
            await listingPage.close().catch(() => {});
          }
        }
      }

    } catch (_error) {
      console.error(`❌ Error processing district ${district}:`, _error);
    } finally {
      // Always close page for this district
      await page.close().catch(() => {});
    }
  }

  // Always close browser at the end
  await browser.close().catch(() => {});

  // Mark job as completed and remove lock file
  if (fs.existsSync(lockFile)) {
    jobStatus.status = 'completed';
    jobStatus.completedAt = new Date().toISOString();
    jobStatus.stats = overallStats;
    fs.writeFileSync(lockFile.replace('.lock', '.completed.json'), JSON.stringify(jobStatus, null, 2));
    fs.unlinkSync(lockFile);
    console.log('🔓 Lock file removed, job marked as completed\n');
  }

  // Update database job status
  const jobId = process.env.PG_JOB_ID;
  if (jobId) {
    try {
      await supabase
        .from('scraper_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          listings_processed: overallStats.totalSuccess,
          stats: overallStats
        })
        .eq('id', jobId);
      console.log('✅ Database job status updated');
    } catch (_error) {
      console.error('⚠️  Failed to update database job status:', _error);
    }
  }

  // Update district metadata for each scraped district
  for (const district of districts) {
    const districtCode = `D${district}`;
    try {
      // Get count of listings for this district
      const { count } = await supabase
        .from('listings')
        .select('*', { count: 'exact', head: true })
        .eq('district', district);

      await supabase
        .from('district_metadata')
        .upsert({
          district: districtCode,
          last_scraped_at: new Date().toISOString(),
          total_listings: count || 0,
          last_job_id: jobId
        }, {
          onConflict: 'district'
        });
      
      console.log(`✅ Updated metadata for district ${districtCode}`);
    } catch (_error) {
      console.error(`⚠️  Failed to update district metadata for ${districtCode}:`, _error);
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
}

scrapePropertyGuruByDistrict().catch((error) => {
  console.error('❌ Fatal error:', error);
  
  // Remove lock file on fatal error
  const lockFile = path.join(process.cwd(), 'storage', 'pg-scraper.lock');
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
    console.log('🔓 Lock file removed due to error');
  }
  
  process.exit(1);
});

