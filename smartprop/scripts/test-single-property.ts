import { config } from 'dotenv';
config();

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { CHROME_UA, humanPause } from '../src/workers/stealth';

async function testSingleProperty() {
  console.log('🔍 Testing single property extraction...');
  
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
    
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await humanPause(3000, 4000);
    
    // Get first property heading
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
        
        if (propertyNames.length >= 1) { // Just get the first one
          break;
        }
      }
    }
    
    if (propertyNames.length === 0) {
      console.log('❌ No properties found');
      return;
    }
    
    const { heading, text: propertyName } = propertyNames[0];
    console.log(`\n--- Testing Property: ${propertyName} ---`);
    
    // Click on property heading to open popup
    console.log(`🖱️  Opening popup...`);
    const popupPromise = page.waitForEvent('popup');
    await heading.click();
    const popup = await popupPromise;
    console.log(`✅ Popup opened!`);
    
    await humanPause(2000, 3000);
    
    // Reveal phone number
    console.log(`📞 Revealing phone number...`);
    try {
      await popup.locator('div').filter({ hasText: /^WhatsApp$/ }).getByRole('button').nth(1).click();
      await humanPause(500, 800);
      await popup.getByRole('link', { name: 'Phone Number +65' }).click();
      await humanPause(500, 800);
      
      const phoneText = await popup.textContent('body');
      const phoneMatch = phoneText?.match(/\+65\s*(\d{8})/);
      const cleanPhone = phoneMatch ? phoneMatch[1] : '';
      console.log(`   📞 Phone: ${cleanPhone}`);
    } catch (error) {
      console.log(`   ⚠️  Could not reveal phone number: ${error}`);
    }
    
    // Extract agent name
    console.log(`👤 Extracting agent name...`);
    let agentName = '';
    try {
      // Try the specific heading selector first
      agentName = await popup.getByRole('heading', { name: /^[A-Z][a-z]+ [A-Z][a-z]+$/ }).textContent({ timeout: 2000 }).catch(() => '') || '';
      
      // If not found, try looking for any heading that looks like a name
      if (!agentName) {
        const headings = await popup.locator('h1, h2, h3, h4, h5, h6').all();
        for (const heading of headings) {
          const text = await heading.textContent().catch(() => '') || '';
          if (text.length > 2 && text.length < 50 && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(text.trim())) {
            agentName = text.trim();
            break;
          }
        }
      }
      
      console.log(`   👤 Agent: ${agentName}`);
    } catch (error) {
      console.log(`   ⚠️  Could not extract agent name: ${error}`);
    }
    
    // Extract property details using your pattern
    console.log(`🏠 Extracting property details...`);
    let propertyDetails = '';
    let extractedBeds = '';
    let extractedBaths = '';
    let extractedSize = '';
    let extractedPropertyType = '';
    let extractedPsf = '';
    let extractedDistrict = '';
    let extractedYear = '';
    
    try {
      // Use your exact pattern: "4 Beds4 Bath1,410 sqftCondominium$ 1617 psfD232013"
      propertyDetails = await popup.getByText(/\d+\s*Beds?\d+\s*Baths?[\d,]+\s*sqft\w+\$\s*[\d,]+\s*psfD\d+\d{4}/, { exact: true }).textContent({ timeout: 3000 }).catch(() => '') || '';
      
      if (propertyDetails) {
        console.log(`   📊 Raw details: ${propertyDetails}`);
        
        // Parse the details: "4 Beds4 Bath1,410 sqftCondominium$ 1617 psfD232013"
        const bedMatch = propertyDetails.match(/(\d+)\s*Beds?/);
        const bathMatch = propertyDetails.match(/(\d+)\s*Baths?/);
        const sizeMatch = propertyDetails.match(/([\d,]+)\s*sqft/);
        const psfMatch = propertyDetails.match(/\$\s*([\d,]+)\s*psf/);
        const districtMatch = propertyDetails.match(/D(\d+)/);
        const yearMatch = propertyDetails.match(/(\d{4})$/);
        
        extractedBeds = bedMatch ? bedMatch[1] : '';
        extractedBaths = bathMatch ? bathMatch[1] : '';
        extractedSize = sizeMatch ? `${sizeMatch[1]} sqft` : '';
        extractedPsf = psfMatch ? `$${psfMatch[1]} psf` : '';
        extractedDistrict = districtMatch ? `D${districtMatch[1]}` : '';
        extractedYear = yearMatch ? yearMatch[1] : '';
        
        // Extract property type
        if (propertyDetails.includes('Condominium')) {
          extractedPropertyType = 'Condominium';
        } else if (propertyDetails.includes('Apartment')) {
          extractedPropertyType = 'Apartment';
        } else if (propertyDetails.includes('Executive Condominium')) {
          extractedPropertyType = 'Executive Condominium';
        }
        
        console.log(`   🏠 Beds: ${extractedBeds}`);
        console.log(`   🛁 Baths: ${extractedBaths}`);
        console.log(`   📏 Size: ${extractedSize}`);
        console.log(`   🏢 Type: ${extractedPropertyType}`);
        console.log(`   💵 PSF: ${extractedPsf}`);
        console.log(`   📍 District: ${extractedDistrict}`);
        console.log(`   📅 Year: ${extractedYear}`);
      } else {
        console.log(`   ⚠️  Could not find property details pattern`);
      }
    } catch (error) {
      console.log(`   ⚠️  Could not extract property details: ${error}`);
    }
    
    // Extract price
    console.log(`💰 Extracting price...`);
    let priceElement = null;
    try {
      const priceTexts = await popup.getByText(/\$\s*[\d,]+/).all();
      if (priceTexts.length > 1) {
        priceElement = await priceTexts[1].textContent({ timeout: 1000 }).catch(() => null);
      } else if (priceTexts.length > 0) {
        priceElement = await priceTexts[0].textContent({ timeout: 1000 }).catch(() => null);
      }
      console.log(`   💰 Price: ${priceElement || 'Not found'}`);
    } catch (error) {
      console.log(`   ⚠️  Could not extract price: ${error}`);
    }
    
    // Extract address
    console.log(`📍 Extracting address...`);
    let extractedAddress = '';
    try {
      const addressText = await popup.locator('[id="_keydetails"] div').filter({ hasText: /Road|Avenue|Street|Drive|Lane/ }).textContent({ timeout: 2000 }).catch(() => '') || '';
      
      if (addressText) {
        // Extract just the address part (before the property type)
        const addressMatch = addressText.match(/^([^,]+),/);
        if (addressMatch) {
          extractedAddress = addressMatch[1].trim();
        } else {
          // Fallback: take first line that looks like an address
          const lines = addressText.split('\n');
          for (const line of lines) {
            if (line.includes('Road') || line.includes('Avenue') || line.includes('Street') || line.includes('Drive') || line.includes('Lane')) {
              extractedAddress = line.trim();
              break;
            }
          }
        }
        console.log(`   📍 Address: ${extractedAddress}`);
      } else {
        console.log(`   ⚠️  Could not find address`);
      }
    } catch (error) {
      console.log(`   ⚠️  Could not extract address: ${error}`);
    }
    
    console.log(`\n✅ Summary:`);
    console.log(`   Property: ${propertyName}`);
    console.log(`   Agent: ${agentName}`);
    console.log(`   Phone: ${cleanPhone}`);
    console.log(`   Price: ${priceElement || 'Not found'}`);
    console.log(`   District: ${extractedDistrict}`);
    console.log(`   Type: ${extractedPropertyType}`);
    console.log(`   Size: ${extractedSize}`);
    console.log(`   Beds/Baths: ${extractedBeds}b${extractedBaths}b`);
    console.log(`   PSF: ${extractedPsf}`);
    console.log(`   Year: ${extractedYear}`);
    console.log(`   Address: ${extractedAddress}`);
    
    // Keep browser open for inspection
    console.log(`\n🔍 Browser will stay open for inspection. Press Ctrl+C to close.`);
    await new Promise(() => {}); // Keep running
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  } finally {
    // Don't close browser automatically for inspection
    // await browser.close();
  }
}

testSingleProperty().catch(console.error);
