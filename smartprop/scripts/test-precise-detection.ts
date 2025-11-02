import { config } from 'dotenv';
config();

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { CHROME_UA, humanPause } from '../src/workers/stealth';

async function testPreciseDetection() {
  console.log('🔍 Testing precise EdgeProp listing detection...');
  
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
    
    console.log('📖 Navigating to EdgeProp search page...');
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
    
    console.log('⏳ Waiting for content to load...');
    await humanPause(3000, 4000);
    
    // Test the new precise detection method (same as in scraper)
    const resultContainer = page.locator('#result-container');
    const propertyHeadings = await resultContainer.locator('h1, h2, h3, h4, h5, h6').all();
    console.log(`📦 Found ${propertyHeadings.length} headings in result container`);
    
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
    
    console.log(`🏠 Found ${propertyNames.length} property listings:`);
    for (let i = 0; i < propertyNames.length; i++) {
      console.log(`  ${i + 1}: ${propertyNames[i].text}`);
    }
    
    
    if (propertyNames.length === 20) {
      console.log('✅ Perfect! Found exactly 20 listings as expected.');
    } else {
      console.log(`⚠️  Expected 20 listings but found ${propertyNames.length}`);
    }
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  } finally {
    await browser.close();
  }
}

testPreciseDetection().catch(console.error);
