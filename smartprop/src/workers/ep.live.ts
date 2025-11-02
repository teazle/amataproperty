import { config } from 'dotenv';
config(); // Load environment variables

import { chromium, type BrowserContextOptions } from 'playwright';
import path from 'path';
import fs from 'fs';
import { CHROME_UA, humanPause } from './stealth';
import { upsertAgentAndListing } from './upsert';

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
  // Remove all non-numeric characters
  const cleaned = phoneText.replace(/[^\d]/g, '');
  
  // If it starts with 65, remove it
  const withoutCountryCode = cleaned.startsWith('65') ? cleaned.slice(2) : cleaned;
  
  // Return only if it's a valid Singapore phone number (8 digits)
  return withoutCountryCode.length === 8 ? withoutCountryCode : '';
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
  const stateFilePath = path.join(process.cwd(), 'storage', 'ep.state.json');
  const hasStorageState = fs.existsSync(stateFilePath);
  
  console.log(`📍 Districts: ALL`);
  console.log(`💰 Price range: $1,000,000 - $3,000,000`);
  console.log(`📄 Max pages: ${maxPages}`);
  console.log(`📁 Storage state: ${hasStorageState ? 'Found' : 'Not found'}`);
  
  const browser = await chromium.launch({
    headless: true, // Run in headless mode for production
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
  };

  if (hasStorageState) {
    contextOptions.storageState = stateFilePath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalErrors = 0;
  let totalSkipped = 0; // Track duplicates/already processed
  const startTime = Date.now();
  let currentPage = 1;

  try {
    // Base URL (page will be appended in the loop)
    const baseUrl = 'https://www.edgeprop.sg/property-search?listing_type=sale&property_type=9%252C103%252C107%252C105%252C106%252C104&district=&bedroom_min=&asking_price_min=1000000&asking_price_max=3000000&floor_area_min=&floor_area_max=&land_area_min=&land_area_max=&tenure=&bathroom=&furnishing=&completed=&level=&completion_year_min=&completion_year_max=&rental_yield=&high_rental_volume=&high_sales_volume=&deals=&nearby_amenities=&amenities_distance=500&rental_type=&keyword_features=&keyword=&mrt_keywords=&school_keywords=&hdbtowns_keywords=&areas_keywords=&district_keywords=&asset_id=&resource_type=&x=&y=&radius=1000&search_by=&search_by_distance=&search_by_location=&search_by_showmap=true&below_valuation=&map_zoom=&asset_lat=&asset_lng=&pageSize=20&order_by=recommended&fittings=&with_new_launches=0&area=&region=&subzone=&subzone_keywords=';
    
    // Loop through pages
    while (currentPage <= maxPages) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📄 PAGE ${currentPage}/${maxPages}`);
      console.log(`${'='.repeat(60)}`);
      
      const searchUrl = `${baseUrl}&page=${currentPage}`;
      
      console.log(`📖 Navigating to page ${currentPage}...`);
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
      
      // Wait for content to load (reduced for speed)
      console.log(`⏳ Waiting for content to load...`);
      await humanPause(3000, 4000);
    
      // Find property listings using headings within result container (precise method)
      const resultContainer = page.locator('#result-container');
      const propertyHeadings = await resultContainer.locator('h1, h2, h3, h4, h5, h6').all();
      console.log(`📦 Found ${propertyHeadings.length} headings in result container`);
      
      // Filter for actual property listings (skip page title and count)
      // Take first 20 property headings (including duplicates - same property can have multiple listings)
      const propertyNames = [];
      
      for (const heading of propertyHeadings) {
        const text = await heading.textContent().catch(() => '') || '';
        const cleanText = text.trim();
        
        // Skip page title and listing count
        if (cleanText.length > 3 && cleanText.length < 100 && 
            !cleanText.includes('Property for Sale') && 
            !cleanText.includes('listings') &&
            !cleanText.includes('$') && !cleanText.includes('bed') && 
            !cleanText.includes('bath') && !cleanText.includes('sqft')) {
          
          propertyNames.push({ heading, text: cleanText });
          
          // Stop at 20 listings (EdgeProp shows exactly 20 per page)
          if (propertyNames.length >= 20) {
            break;
          }
        }
      }
      
      console.log(`🏠 Found ${propertyNames.length} property listings`);
      
      if (propertyNames.length === 0) {
        console.log('❌ No property names found');
        break;
      }
      
      // Process exactly 20 properties per page (EdgeProp shows exactly 20 per page)
      // If we found more than 20, take only the first 20
      const processCount = Math.min(20, propertyNames.length);
      console.log(`\n🧪 Processing ${processCount} properties on page ${currentPage}/${maxPages}:`);
      
      if (propertyNames.length > 20) {
        console.log(`⚠️  Found ${propertyNames.length} listings but EdgeProp shows only 20 per page. Taking first 20.`);
      }
      
      for (let i = 0; i < processCount; i++) {
        const { heading, text: propertyName } = propertyNames[i];
        const propertyStartTime = Date.now();
        console.log(`\n--- Property ${i + 1}/${processCount}: ${propertyName} ---`);
        
        try {
          let stepStart = Date.now();
          
          // Skip card extraction - go straight to popup for all details
          console.log(`🖱️  Opening popup to extract all details... (${Date.now() - propertyStartTime}ms)`);
          const popupPromise = page.waitForEvent('popup');
          await heading.click();
          const popup = await popupPromise;
        
          console.log(`✅ Popup opened! (popup: ${Date.now() - stepStart}ms, total: ${Date.now() - propertyStartTime}ms)`);
          await humanPause(800, 1200); // Further reduced for speed
          
          // Click WhatsApp button then Phone Number link to reveal agent phone (with retry)
          stepStart = Date.now();
          console.log(`📞 Revealing phone number... (${Date.now() - propertyStartTime}ms)`);
          let cleanPhone = '';
          let phoneAttempts = 0;
          const maxPhoneAttempts = 2;
          
          while (phoneAttempts < maxPhoneAttempts && !cleanPhone) {
            phoneAttempts++;
            try {
              // Extract phone number
              const phoneElement = await popup.locator('.jsx-3667944064.agent-contact-wrapper').first();
              const phoneText = await phoneElement.textContent({ timeout: 2000 }).catch(() => '');
              if (phoneText) {
                cleanPhone = cleanPhoneNumber(phoneText);
                console.log(`   📱 Phone: ${cleanPhone}`);
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
            const listingInfoContainer = popup.locator('.jsx-2586815543.listing-info-container.listing-info');
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
            agentName = await popup.locator('.jsx-3667944064.agent-name-wrapper').textContent({ timeout: 2000 }).catch(() => '') || '';
            agentName = agentName.trim();
            console.log(`   👤 Agent name: ${agentName}`);
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
            } catch (dbError: unknown) {
              // Check if it's a duplicate error (unique constraint violation)
              const errorObj = dbError as { message?: string; code?: string };
              if (errorObj?.message?.includes('duplicate') || errorObj?.code === '23505') {
                console.log(`⏭️  Skipped duplicate: ${propertyName}`);
                totalSkipped++;
              } else {
                console.error(`❌ Database error: ${dbError}`);
                totalErrors++;
              }
            }
          } else {
            console.log(`⚠️  Missing agent info - Name: ${agentName || 'Not found'}, Phone: ${cleanPhone || 'Not found'}`);
            totalErrors++;
          }
          
          // Close popup
          await popup.close();
          await humanPause(300, 500); // Further reduced for speed
          
          totalProcessed++;
          
        } catch (error: unknown) {
          console.error(`❌ Error processing property ${i + 1}:`, error);
          totalErrors++;
          totalProcessed++;
          
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
      
      console.log(`\n✅ Page ${currentPage} completed: ${propertyNames.length} properties processed`);
      
      // Wait before going to next page (reduced for speed)
      if (currentPage < maxPages) {
        console.log(`⏳ Waiting before next page...`);
        await humanPause(1000, 1500);
      }
      
      currentPage++;
    } // End of while loop
    
  } catch (error: unknown) {
    console.error('❌ Fatal error during scraping:', error);
  } finally {
    await browser.close();
    
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
  }
}

// Run the scraper
scrapeEdgePropFinal().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

export { scrapeEdgePropFinal };
