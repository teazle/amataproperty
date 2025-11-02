import { config } from 'dotenv';
config();

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { CHROME_UA, humanPause } from '../src/workers/stealth';

async function testListingCards() {
  console.log('🔍 Testing EdgeProp listing card extraction...');
  
  const stateFilePath = path.join(process.cwd(), 'storage', 'ep.state.json');
  const hasStorageState = fs.existsSync(stateFilePath);
  
  const browser = await chromium.launch({
    headless: false, // Show browser for debugging
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
  };

  if (hasStorageState) {
    contextOptions.storageState = stateFilePath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  
  try {
    const searchUrl = 'https://www.edgeprop.sg/property-search?listing_type=sale&property_type=9%252C103%252C107%252C105%252C106%252C104&district=&bedroom_min=&asking_price_min=&asking_price_max=3000000&floor_area_min=&floor_area_max=&land_area_min=&land_area_max=&tenure=&bathroom=&furnishing=&completed=&level=&completion_year_min=&completion_year_max=&rental_yield=&high_rental_volume=&high_sales_volume=&deals=&nearby_amenities=&amenities_distance=500&rental_type=&keyword_features=&keyword=&mrt_keywords=&school_keywords=&hdbtowns_keywords=&areas_keywords=&district_keywords=&asset_id=&resource_type=&x=&y=&radius=1000&search_by=&search_by_distance=&search_by_location=&search_by_showmap=true&below_valuation=&map_zoom=&asset_lat=&asset_lng=&page=1&pageSize=20&order_by=recommended&fittings=&with_new_launches=0&area=&region=&subzone=&subzone_keywords=';
    
    console.log('📖 Navigating to EdgeProp search page...');
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
    
    console.log('⏳ Waiting for content to load...');
    await humanPause(3000, 4000);
    
    // Look for individual listing cards/containers
    console.log('\n🔍 Looking for listing cards...');
    
    // Method 1: Look for divs that contain property information
    const listingCards = await page.locator('#result-container > div').all();
    console.log(`Found ${listingCards.length} potential listing cards`);
    
    const validListings = [];
    for (let i = 0; i < listingCards.length; i++) {
      const card = listingCards[i];
      const text = await card.textContent().catch(() => '') || '';
      
      // Check if this card contains property information (price, beds, etc.)
      if (text.includes('S$') && (text.includes('bed') || text.includes('bath') || text.includes('sqft'))) {
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        
        // Extract key information
        let propertyName = '';
        let price = '';
        let beds = '';
        let baths = '';
        let propertyType = '';
        let district = '';
        let year = '';
        let tenure = '';
        let psf = '';
        let size = '';
        let address = '';
        let agentName = '';
        
        for (const line of lines) {
          const cleanLine = line.trim();
          
          // Property name (usually first line that's not a price or badge)
          if (!propertyName && !cleanLine.includes('S$') && !cleanLine.includes('AI reDESIGN') && 
              !cleanLine.includes('EXCLUSIVE') && cleanLine.length > 3 && cleanLine.length < 100) {
            propertyName = cleanLine;
          }
          
          // Price
          if (cleanLine.includes('S$') && cleanLine.match(/\d/)) {
            price = cleanLine;
          }
          
          // Beds and baths
          if (cleanLine.includes('bed') && cleanLine.includes('bath')) {
            const bedMatch = cleanLine.match(/(\d+)\s*bed/);
            const bathMatch = cleanLine.match(/(\d+)\s*bath/);
            beds = bedMatch ? bedMatch[1] : '';
            baths = bathMatch ? bathMatch[1] : '';
          }
          
          // Property type
          if (cleanLine.includes('Condominium') || cleanLine.includes('Apartment') || cleanLine.includes('Executive Condominium')) {
            propertyType = cleanLine;
          }
          
          // District
          if (cleanLine.match(/^D\d+$/)) {
            district = cleanLine;
          }
          
          // Year
          if (cleanLine.match(/^(19|20)\d{2}$/)) {
            year = cleanLine;
          }
          
          // Tenure
          if (cleanLine.includes('years') || cleanLine.includes('Freehold')) {
            tenure = cleanLine;
          }
          
          // PSF
          if (cleanLine.includes('psf')) {
            psf = cleanLine;
          }
          
          // Size
          if (cleanLine.includes('sqft')) {
            size = cleanLine;
          }
          
          // Address (usually longer lines with road names)
          if (cleanLine.length > 20 && (cleanLine.includes('Road') || cleanLine.includes('Avenue') || cleanLine.includes('Street') || cleanLine.includes('Drive') || cleanLine.includes('Lane'))) {
            address = cleanLine;
          }
          
          // Agent name (usually a short name at the end)
          if (cleanLine.length > 2 && cleanLine.length < 50 && 
              !cleanLine.includes('S$') && !cleanLine.includes('bed') && !cleanLine.includes('bath') &&
              !cleanLine.includes('sqft') && !cleanLine.includes('psf') && !cleanLine.includes('Road') &&
              !cleanLine.includes('Avenue') && !cleanLine.includes('Street') && !cleanLine.includes('Drive') &&
              !cleanLine.includes('Lane') && !cleanLine.includes('Condominium') && !cleanLine.includes('Apartment') &&
              !cleanLine.includes('D') && !cleanLine.match(/^(19|20)\d{2}$/) && 
              cleanLine !== propertyName && cleanLine !== 'badges logo') {
            agentName = cleanLine;
          }
        }
        
        if (propertyName && price) {
          validListings.push({
            propertyName,
            price,
            beds,
            baths,
            propertyType,
            district,
            year,
            tenure,
            psf,
            size,
            address,
            agentName,
            card
          });
        }
      }
    }
    
    console.log(`\n🏠 Found ${validListings.length} valid property listings:`);
    for (let i = 0; i < Math.min(5, validListings.length); i++) {
      const listing = validListings[i];
      console.log(`\n--- Listing ${i + 1} ---`);
      console.log(`Property: ${listing.propertyName}`);
      console.log(`Price: ${listing.price}`);
      console.log(`Beds/Baths: ${listing.beds} beds, ${listing.baths} baths`);
      console.log(`Type: ${listing.propertyType}`);
      console.log(`District: ${listing.district}`);
      console.log(`Year: ${listing.year}`);
      console.log(`Tenure: ${listing.tenure}`);
      console.log(`PSF: ${listing.psf}`);
      console.log(`Size: ${listing.size}`);
      console.log(`Address: ${listing.address}`);
      console.log(`Agent: ${listing.agentName}`);
    }
    
    console.log(`\n✅ Successfully extracted ${validListings.length} listing details from cards`);
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  } finally {
    await browser.close();
  }
}

testListingCards().catch(console.error);
