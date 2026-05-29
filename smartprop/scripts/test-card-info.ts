import { config } from 'dotenv';
config();

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { CHROME_UA,humanPause } from '../src/workers/stealth';

async function testCardInfo() {
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
      const { heading: _heading, text: propertyName } = propertyNames[i];
      console.log(`\n--- Property ${i + 1}: ${propertyName} ---`);
      
      // Find the card container using the property name
      const cardContainer = resultContainer.locator('div').filter({ hasText: propertyName }).first();
      const cardText = await cardContainer.textContent().catch(() => '') || '';
      
      console.log('📄 Raw card text (first 300 chars):');
      console.log(cardText.substring(0, 300) + (cardText.length > 300 ? '...' : ''));
      
      // Extract information using specific patterns from the card text
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
      
      // Parse the card text line by line
      const lines = cardText.split('\n').filter(line => line.trim().length > 0);
      
      for (const line of lines) {
        const cleanLine = line.trim();
        
        // Extract price (pattern: "1 S$ 1,558,000" or "S$ 1,558,000")
        if (cleanLine.includes('S$') && cleanLine.match(/\d/)) {
          const priceMatch = cleanLine.match(/S\$\s*[\d,]+/);
          if (priceMatch) {
            extractedPrice = priceMatch[0];
          }
        }
        
        // Extract beds/baths, property type, district, year, PSF, size, address, agent
        // Pattern: "2 beds|2 baths Condominium D12 2019 S$ 2,010 psf 775 sqft Lorong 5 Toa Payoh Zola"
        if (cleanLine.includes('beds') && cleanLine.includes('baths')) {
          // Extract beds and baths
          const bedMatch = cleanLine.match(/(\d+)\s*beds/);
          const bathMatch = cleanLine.match(/(\d+)\s*baths/);
          extractedBeds = bedMatch ? bedMatch[1] : '';
          extractedBaths = bathMatch ? bathMatch[1] : '';
          
          // Extract property type
          if (cleanLine.includes('Condominium')) {
            extractedPropertyType = 'Condominium';
          } else if (cleanLine.includes('Apartment')) {
            extractedPropertyType = 'Apartment';
          } else if (cleanLine.includes('Executive Condominium')) {
            extractedPropertyType = 'Executive Condominium';
          }
          
          // Extract district (D12, D19, etc.)
          const districtMatch = cleanLine.match(/D\d+/);
          if (districtMatch) {
            extractedDistrict = districtMatch[0];
          }
          
          // Extract year
          const yearMatch = cleanLine.match(/\b(19|20)\d{2}\b/);
          if (yearMatch) {
            extractedYear = yearMatch[0];
          }
          
          // Extract PSF
          const psfMatch = cleanLine.match(/S\$\s*[\d,]+\s*psf/);
          if (psfMatch) {
            extractedPsf = psfMatch[0];
          }
          
          // Extract size
          const sizeMatch = cleanLine.match(/\d+\s*sqft/);
          if (sizeMatch) {
            extractedSize = sizeMatch[0];
          }
          
          // Extract address (usually at the end before agent name)
          const addressParts = cleanLine.split(/\s+/);
          let addressStart = -1;
          for (let j = 0; j < addressParts.length; j++) {
            if (addressParts[j].match(/^[A-Z]/) && (addressParts[j].includes('Road') || addressParts[j].includes('Avenue') || addressParts[j].includes('Street') || addressParts[j].includes('Drive') || addressParts[j].includes('Lane'))) {
              addressStart = j;
              break;
            }
          }
          
          if (addressStart !== -1) {
            // Find where agent name starts (usually a short name at the end)
            let addressEnd = addressParts.length;
            for (let j = addressStart + 1; j < addressParts.length; j++) {
              // Agent name is usually short and doesn't contain numbers
              if (addressParts[j].length < 10 && !addressParts[j].match(/\d/)) {
                addressEnd = j;
                extractedAgentName = addressParts[j];
                break;
              }
            }
            
            extractedAddress = addressParts.slice(addressStart, addressEnd).join(' ');
          }
        }
        
        // Extract tenure (99 years, Freehold, etc.)
        if (cleanLine.includes('years') || cleanLine.includes('Freehold')) {
          extractedTenure = cleanLine;
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

testCardInfo().catch(console.error);
