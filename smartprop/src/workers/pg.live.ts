/**
 * Extract district number from address or property title
 * Returns null if district cannot be inferred
 */

async function scrapePropertyGuru() {
  console.log('⚠️  WARNING: This scraper is DEPRECATED!');
  console.log('   Please use the district-based scraper instead:');
  console.log('   PG_DISTRICTS="09" bun run scrape:pg:districts');
  console.log('');
  console.log('   The old scraper has unreliable district detection.');
  console.log('   Use pg.districts.ts for accurate results.');
  console.log('');
  console.log('   Exiting in 5 seconds...\n');
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.error('❌ Please use: bun run scrape:pg:districts');
  process.exit(1);
}

/* DEPRECATED CODE BELOW - DO NOT USE
  const maxPages = parseInt(process.env.PG_MAX_PAGES || '3', 10);
  const stateFilePath = path.join(process.cwd(), 'storage', 'pg.state.json');
  
  // Get search URL from environment or use default
  const searchUrl = process.env.PG_SEARCH_URL || 'https://www.propertyguru.com.sg/property-for-sale?listingType=sale&isCommercial=false&page=1';
  
  // Extract district from search URL if available (e.g., districtCode=D09 -> "09")
  let searchDistrict: string | null = null;
  const districtMatch = searchUrl.match(/districtCode=D(\d+)/i);
  if (districtMatch) {
    searchDistrict = districtMatch[1];
    console.log(`📍 Searching in District ${searchDistrict}`);
  }
  
  console.log('🚀 Starting PropertyGuru scraper...');
  console.log(`📄 Max pages to scrape: ${maxPages}`);
  console.log(`🔗 Search URL: ${searchUrl}`);
  
  // Check if state file exists
  const hasStorageState = fs.existsSync(stateFilePath);
  if (!hasStorageState) {
    console.log('⚠️  No storage state found - running without authentication');
    console.log('💡 Run `bun run auth:pg` first to save login state');
  }
  
  // Use playwright-ghost with recommended plugins for best stealth
  const browser = await chromium.launch({
    headless: true, // Run in headless mode - no browser window
    plugins: plugins.recommended({
      // Customize specific plugins if needed
      humanize: {
        // Add human-like delays to clicks (ensure positive values)
        click: { delay: { min: 200, max: 600 } },
        // Disable cursor humanization to avoid negative timeout warnings
        cursor: false,
        // Add delays to dialog handling
        dialog: { delay: { min: 800, max: 2000 } }
      }
    }),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ]
  });

  const contextOptions: unknown = {
    userAgent: CHROME_UA,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 },
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': 'en-SG,en;q=0.9',
    }
  };

  // Add storage state if available
  if (hasStorageState) {
    contextOptions.storageState = stateFilePath;
  }

  const context = await browser.newContext(contextOptions);

  // playwright-ghost handles most stealth automatically via plugins
  // Just add a minimal script to ensure webdriver is undefined
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalErrors = 0;

  try {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`\n📖 Processing page ${pageNum}/${maxPages}...`);
      
      // Use the searchUrl and replace page number
      const url = searchUrl.includes('page=') 
        ? searchUrl.replace(/page=\d+/, `page=${pageNum}`)
        : `${searchUrl}&page=${pageNum}`;
      
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Check for Cloudflare protection
      const pageText = await page.textContent('body').catch(() => '');
      if (pageText.includes('Pardon Our Interruption') || 
          pageText.includes('Verify you are human') ||
          pageText.includes('Enable JavaScript and cookies to continue') ||
          pageText.includes('challenge-error-text')) {
        console.log('🛡️  Cloudflare protection detected! Waiting for manual resolution...');
        console.log('⏳ Please solve the Cloudflare challenge manually in the browser window');
        console.log('⏳ Waiting 30 seconds for you to complete the challenge...');
        
        await page.waitForTimeout(30000); // Wait 30 seconds for manual resolution
        
        // Check again after waiting
        const newPageText = await page.textContent('body').catch(() => '');
        if (newPageText.includes('Pardon Our Interruption') || 
            newPageText.includes('Verify you are human') ||
            newPageText.includes('Enable JavaScript and cookies to continue')) {
          console.log('❌ Cloudflare challenge not resolved. Skipping this page.');
          continue;
        }
        console.log('✅ Cloudflare challenge resolved! Continuing...');
      }
      
      // Wait for listings to load - PropertyGuru uses different structure
      await page.waitForTimeout(3000); // Give page time to load
      
      // Target only the main organic listing cards - PropertyGuru uses specific class structure
      const mainListingCards = await page.locator('div.hui-card.primary.flat.listing-card-v2.listing-card-v2--xl.card').all();
      
      console.log(`📦 Found ${mainListingCards.length} organic listing cards on page ${pageNum}`);
      
      // Extract the main listing links from these cards - try multiple link patterns
      const cards = [];
      for (const card of mainListingCards) {
        // Try /listing/ first
        let mainLink = await card.locator('a[href*="/listing/"]').first();
        let isVisible = await mainLink.isVisible().catch(() => false);
        
        // If not found, try /property/
        if (!isVisible) {
          mainLink = await card.locator('a[href*="/property/"]').first();
          isVisible = await mainLink.isVisible().catch(() => false);
        }
        
        // If still not found, get any link
        if (!isVisible) {
          mainLink = await card.locator('a').first();
          isVisible = await mainLink.isVisible().catch(() => false);
        }
        
        if (isVisible) {
          cards.push(mainLink);
        }
      }
      
      console.log(`📦 Extracted ${cards.length} organic listing links from ${mainListingCards.length} cards`);
      
      for (let i = 0; i < cards.length; i++) {
        try {
          const card = cards[i];
          
          // Get the listing URL directly from the card
          const href = await card.getAttribute('href').catch(() => null);
          
          if (!href || !href.includes('/listing/')) {
            console.log(`⚠️  Skipping card ${i + 1} - no valid listing URL found`);
            continue;
          }
          
          const listingUrl = href.startsWith('http') ? href : `https://www.propertyguru.com.sg${href}`;
          
          console.log(`\n🏠 [${i + 1}/${cards.length}] Processing listing...`);
          console.log(`   🔗 URL: ${listingUrl}`);
          
          // Open listing in a NEW TAB to avoid navigation issues
          const listingPage = await context.newPage();
          
          try {
            // Navigate to listing in the new tab
            await listingPage.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await humanPause(600, 1400);
            
            // Scroll down to ensure agent section loads
            await listingPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await humanPause(500, 1000);
            
            // Get title from page and clean it
            const rawTitle = await listingPage.title().catch(() => 'Untitled');
            const title = cleanPropertyTitle(rawTitle);
            console.log(`   📄 Title: ${title}`);
            
            // Extract price from the specific price selector
            const priceSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.col-lg-8.col-md-12 > div.row > div > div.property-snapshot-section > div > div > div.price > h2';
            const priceText = await listingPage.locator(priceSelector).textContent().catch(() => '');
            const price = priceText ? parsePrice(priceText) : undefined;
            console.log(`   💰 Price: ${priceText || 'N/A'}`);
            
            // Check for Cloudflare on listing page
            const listingPageText = await listingPage.textContent('body').catch(() => '');
            if (listingPageText.includes('Pardon Our Interruption') || 
                listingPageText.includes('Verify you are human') ||
                listingPageText.includes('Enable JavaScript and cookies to continue')) {
              console.log(`   🛡️  Cloudflare detected on listing page. Skipping...`);
              totalErrors++;
              await listingPage.close();
              continue;
            }
            
            // Extract agent name - it's in the sticky contact bar on the right side
            // The agent name is in a generic element within the link
            const agentName = await listingPage.locator('.agent-section-desktop .card-header .details-wrapper .agent-name, div.agent-info div.details-wrapper div:first-child').first().textContent().catch(() => null);
            console.log(`   👤 Agent name: ${agentName || 'NOT FOUND'}`);
            
            // Extract structured property details
            const propertyDetails = await extractPropertyDetails(listingPage, title);
            
            // Extract agency
            const agency = await listingPage.locator('.agent-section-desktop .card-header .details-wrapper .agency-name, [class*="agency"]').first().textContent().catch(() => null);
            
            // Extract CEA registration number
            const ceaSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.agent-section-desktop.rich-contact--enabled.col-lg-4.col-md-12 > div > div > div > div > div.card-header > a > div.details-wrapper > span > div';
            const ceaText = await listingPage.locator(ceaSelector).textContent().catch(() => null);
            console.log(`   🆔 CEA: ${ceaText || 'NOT FOUND'}`);
            
            // Try to get phone number - PropertyGuru requires login to see phone
            // We need to check if we're logged in first
            let agentPhone = null;
            try {
              // Wait a bit longer for the agent section to fully load
              await humanPause(1000, 1500);
              
              // First check if phone is already visible (for logged in users)
              const directPhoneLink = await listingPage.locator('a[href^="tel:"]').first().textContent({ timeout: 2000 }).catch(() => null);
              if (directPhoneLink) {
                agentPhone = directPhoneLink;
                console.log(`   📱 Found phone directly: ${agentPhone}`);
              } else {
                // Use the specific selector for "Other ways to enquire" button
                const otherWaysButtonSelector = '#__next > div > div.base-page-layout-root > div.main-content > div.ldp-container.container-sm > div > div.agent-section-desktop.rich-contact--enabled.col-lg-4.col-md-12 > div > div > div > div > div.card-body > div > div.extended-view-root > div.actionable-link.contact-button-root.extend-view-trigger-point';
                const otherWaysButton = listingPage.locator(otherWaysButtonSelector).first();
                const otherWaysVisible = await otherWaysButton.isVisible({ timeout: 5000 }).catch(() => false);
                console.log(`   🔍 "Other ways to enquire" visible: ${otherWaysVisible}`);
                
                if (otherWaysVisible) {
                  console.log(`   🔍 Clicking "Other ways to enquire"...`);
                  await otherWaysButton.click();
                  await humanPause(1500, 2000);
                  
                  // Click "View Phone Number" button
                  const viewPhoneButton = listingPage.locator('text=View Phone Number').first();
                  const viewPhoneVisible = await viewPhoneButton.isVisible({ timeout: 5000 }).catch(() => false);
                  console.log(`   📱 "View Phone Number" visible: ${viewPhoneVisible}`);
                  
                  if (viewPhoneVisible) {
                    console.log(`   📱 Clicking to reveal phone number...`);
                    await viewPhoneButton.click();
                    await humanPause(1500, 2500);
                    
                    // Extract phone from the tel: link that appears
                    agentPhone = await listingPage.locator('a[href^="tel:"]').first().textContent({ timeout: 3000 }).catch(() => null);
                    
                    console.log(`   📱 Found phone: ${agentPhone || 'NOT FOUND'}`);
                  }
                } else {
                  console.log(`   ⚠️  "Other ways to enquire" not found - may need login`);
                }
              }
            } catch (_error) {
              console.log(`   ⚠️  Could not extract phone: ${error}`);
            }
            
            // Clean phone number - handle format like "+65 9797 5696"
            let cleanPhone = '';
            if (agentPhone) {
              cleanPhone = agentPhone.replace(/[^\d]/g, ''); // Remove all non-digits
              // Remove leading +65 if present and add it back consistently
              if (cleanPhone.startsWith('65')) {
                cleanPhone = '65' + cleanPhone.substring(2);
              } else {
                cleanPhone = '65' + cleanPhone;
              }
            }
            
            // Skip if no agent name (phone is optional since it requires login/non-headless)
            if (!agentName) {
              console.log(`⚠️  Skipping - missing agent name`);
              totalErrors++;
              totalProcessed++;
              await listingPage.close();
              continue;
            }
            
            // Warn if no phone but continue anyway
            if (!cleanPhone) {
              console.log(`   ⚠️  No phone number found (may require login or non-headless mode)`);
            }
            
            // Use district from search URL if available, otherwise try to infer
            let district: string | null = searchDistrict;
            if (!district) {
              const pageText = await listingPage.textContent('body').catch(() => '');
              district = inferDistrict(`${title} ${pageText}`);
            }
            
            // Upsert data with structured details
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
                title: title?.trim(),
                price: price,
                district: district || undefined,
                property_type: propertyDetails.property_type,
                beds: propertyDetails.beds,
                baths: propertyDetails.baths,
                size_sqft: propertyDetails.size_sqft,
                price_psf: propertyDetails.price_psf,
                year_built: propertyDetails.year_built,
                tenure: propertyDetails.tenure,
                address: propertyDetails.address,
              }
            });
            
            console.log(`✅ Saved: ${agentName} - ${cleanPhone}`);
            if (district) {
              console.log(`   📍 District: ${district}`);
            }
            
            totalSuccess++;
            totalProcessed++;
            
          } finally {
            // Always close the listing tab
            await listingPage.close();
            console.log(`   🔄 Closed tab, back to main listing page`);
          }
          
        } catch (_error) {
          console.error(`❌ Error processing card ${i + 1}:`, error);
          totalErrors++;
          totalProcessed++;
        }
      }
      
      // Check if there's a next page
      if (pageNum < maxPages) {
        console.log('\n⏭️  Moving to next page...');
        await humanPause(1000, 2000);
      }
    }
    
  } catch (_error) {
    console.error('❌ Fatal error during scraping:', error);
  } finally {
    await browser.close();
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 Scraping Summary:');
    console.log(`   Total processed: ${totalProcessed}`);
    console.log(`   Successful: ${totalSuccess}`);
    console.log(`   Errors: ${totalErrors}`);
    console.log('='.repeat(50));
  }
}
*/

// Run the scraper
scrapePropertyGuru().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

export { scrapePropertyGuru };


