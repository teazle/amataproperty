import { config } from 'dotenv';
config();

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { CHROME_UA, humanPause } from '../src/workers/stealth';

async function testCardExtraction() {
  console.log('🔍 Testing card information extraction...');
  
  const stateFilePath = path.join(process.cwd(), 'storage', 'ep.state.json');
  const hasStorageState = fs.existsSync(stateFilePath);
  
  const browser = await chromium.launch({
    headless: true,
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
    
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await humanPause(3000, 4000);
    
    // Get property headings (same logic as main scraper)
    const resultContainer = page.locator('#result-container');
    const propertyHeadings = await resultContainer.locator('h1, h2, h3, h4, h5, h6').all();
    
    const propertyNames = [];
    for (const heading of propertyHeadings) {
      const text = await heading.textContent().catch(() => '') || '';
      const cleanText = text.trim();
      
      if (cleanText.length > 3 && cleanText.length < 100 && 
          !cleanText.includes('Property for Sale') && 
          !cleanText.includes('listings') &&
          !cleanText.includes('$') && !cleanText.includes('bed') && 
          !cleanText.includes('bath') && !cleanText.includes('sqft')) {
        
        propertyNames.push({ heading, text: cleanText });
        
        if (propertyNames.length >= 3) { // Test first 3 only
          break;
        }
      }
    }
    
    console.log(`🏠 Testing extraction for ${propertyNames.length} properties:`);
    
    for (let i = 0; i < propertyNames.length; i++) {
      const { heading, text: propertyName } = propertyNames[i];
      console.log(`\n--- Property ${i + 1}: ${propertyName} ---`);
      
      // Debug: Try different approaches to find the card container
      console.log('🔍 Debugging card container...');
      
      // Method 1: Try to find parent div with price
      const cardContainer1 = heading.locator('xpath=ancestor::div[contains(text(), "S$")]').first();
      const cardText1 = await cardContainer1.textContent().catch(() => '') || '';
      console.log('Method 1 - Parent with S$:', cardText1.length > 0 ? 'Found' : 'Empty');
      
      // Method 2: Try to find any parent div
      const cardContainer2 = heading.locator('xpath=ancestor::div').first();
      const cardText2 = await cardContainer2.textContent().catch(() => '') || '';
      console.log('Method 2 - Any parent div:', cardText2.length > 0 ? `Found (${cardText2.length} chars)` : 'Empty');
      
      // Method 3: Try to find sibling elements
      const siblings = await heading.locator('xpath=following-sibling::*').all();
      console.log(`Method 3 - Siblings found: ${siblings.length}`);
      
      // Method 4: Try to find the actual listing card structure
      const allDivs = await resultContainer.locator('div').all();
      console.log(`Total divs in result container: ${allDivs.length}`);
      
      // Find divs that contain both property name and price
      let foundCard = null;
      for (let j = 0; j < Math.min(10, allDivs.length); j++) {
        const divText = await allDivs[j].textContent().catch(() => '') || '';
        if (divText.includes(propertyName) && divText.includes('S$')) {
          foundCard = allDivs[j];
          console.log(`Found matching card at index ${j}`);
          break;
        }
      }
      
      const cardText = foundCard ? await foundCard.textContent().catch(() => '') || '' : '';
      
      console.log('📄 Raw card text:');
      console.log(cardText.substring(0, 500) + (cardText.length > 500 ? '...' : ''));
      
      const lines = cardText.split('\n').filter(line => line.trim().length > 0);
      
      // Extract information
      let extractedPrice = '';
      let extractedBeds = '';
      let extractedBaths = '';
      let extractedPropertyType = '';
      let extractedDistrict = '';
      let extractedYear = '';
      let extractedTenure = '';
      let extractedPsf = '';
      let extractedSize = '';
      let extractedAddress = '';
      let extractedAgentName = '';
      
      for (const line of lines) {
        const cleanLine = line.trim();
        
        // Price
        if (cleanLine.includes('S$') && cleanLine.match(/\d/)) {
          extractedPrice = cleanLine;
        }
        
        // Beds and baths
        if (cleanLine.includes('bed') && cleanLine.includes('bath')) {
          const bedMatch = cleanLine.match(/(\d+)\s*bed/);
          const bathMatch = cleanLine.match(/(\d+)\s*bath/);
          extractedBeds = bedMatch ? bedMatch[1] : '';
          extractedBaths = bathMatch ? bathMatch[1] : '';
        }
        
        // Property type
        if (cleanLine.includes('Condominium') || cleanLine.includes('Apartment') || cleanLine.includes('Executive Condominium')) {
          extractedPropertyType = cleanLine;
        }
        
        // District
        if (cleanLine.match(/^D\d+$/)) {
          extractedDistrict = cleanLine;
        }
        
        // Year
        if (cleanLine.match(/^(19|20)\d{2}$/)) {
          extractedYear = cleanLine;
        }
        
        // Tenure
        if (cleanLine.includes('years') || cleanLine.includes('Freehold')) {
          extractedTenure = cleanLine;
        }
        
        // PSF
        if (cleanLine.includes('psf')) {
          extractedPsf = cleanLine;
        }
        
        // Size
        if (cleanLine.includes('sqft')) {
          extractedSize = cleanLine;
        }
        
        // Address
        if (cleanLine.length > 20 && (cleanLine.includes('Road') || cleanLine.includes('Avenue') || cleanLine.includes('Street') || cleanLine.includes('Drive') || cleanLine.includes('Lane'))) {
          extractedAddress = cleanLine;
        }
        
        // Agent name
        if (cleanLine.length > 2 && cleanLine.length < 50 && 
            !cleanLine.includes('S$') && !cleanLine.includes('bed') && !cleanLine.includes('bath') &&
            !cleanLine.includes('sqft') && !cleanLine.includes('psf') && !cleanLine.includes('Road') &&
            !cleanLine.includes('Avenue') && !cleanLine.includes('Street') && !cleanLine.includes('Drive') &&
            !cleanLine.includes('Lane') && !cleanLine.includes('Condominium') && !cleanLine.includes('Apartment') &&
            !cleanLine.includes('D') && !cleanLine.match(/^(19|20)\d{2}$/) && 
            cleanLine !== propertyName && cleanLine !== 'badges logo' && 
            !cleanLine.includes('AI reDESIGN') && !cleanLine.includes('EXCLUSIVE')) {
          extractedAgentName = cleanLine;
        }
      }
      
      console.log(`\n📊 Extracted Info:`);
      console.log(`   Property: ${propertyName}`);
      console.log(`   Price: ${extractedPrice}`);
      console.log(`   Beds/Baths: ${extractedBeds} beds, ${extractedBaths} baths`);
      console.log(`   Type: ${extractedPropertyType}`);
      console.log(`   District: ${extractedDistrict}`);
      console.log(`   Year: ${extractedYear}`);
      console.log(`   Tenure: ${extractedTenure}`);
      console.log(`   PSF: ${extractedPsf}`);
      console.log(`   Size: ${extractedSize}`);
      console.log(`   Address: ${extractedAddress}`);
      console.log(`   Agent: ${extractedAgentName}`);
    }
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  } finally {
    await browser.close();
  }
}

testCardExtraction().catch(console.error);
