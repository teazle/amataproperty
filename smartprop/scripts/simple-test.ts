#!/usr/bin/env ts-node

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

/**
 * Simple test to verify scraper setup
 */

async function testBrowserAndPages() {
  console.log('🧪 Testing browser setup...');
  
  const browser = await chromium.launch({
    headless: false, // Show browser for testing
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
  });

  const page = await context.newPage();

  try {
    // Test PropertyGuru
    console.log('📄 Testing PropertyGuru access...');
    await page.goto('https://www.propertyguru.com.sg/property-for-sale?listing_type=sale&minprice=1000000&maxprice=2999000');
    await page.waitForLoadState('networkidle');
    
    const pgTitle = await page.title();
    console.log(`✅ PropertyGuru loaded: ${pgTitle}`);
    
    // Check for listings
    const pgListings = await page.locator('[data-testid="listing-card"], .listing-card, article[class*="listing"]').count();
    console.log(`📦 Found ${pgListings} listings on PropertyGuru`);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test EdgeProp
    console.log('📄 Testing EdgeProp access...');
    await page.goto('https://www.edgeprop.sg/property-search?district=09&listing_type=sale');
    await page.waitForLoadState('networkidle');
    
    const epTitle = await page.title();
    console.log(`✅ EdgeProp loaded: ${epTitle}`);
    
    // Check for listings
    const epListings = await page.locator('[data-testid="property-card"], .property-card, article[class*="listing"]').count();
    console.log(`📦 Found ${epListings} listings on EdgeProp`);
    
  } catch (error) {
    console.error('❌ Error during testing:', error);
  } finally {
    await browser.close();
    console.log('🔚 Browser closed');
  }
}

async function testStorageStates() {
  console.log('\n💾 Testing storage states...');
  
  const pgStatePath = path.join(process.cwd(), 'storage', 'pg.state.json');
  const epStatePath = path.join(process.cwd(), 'storage', 'ep.state.json');
  
  if (fs.existsSync(pgStatePath)) {
    const pgState = JSON.parse(fs.readFileSync(pgStatePath, 'utf8'));
    console.log(`✅ PropertyGuru state found: ${Object.keys(pgState.cookies || {}).length} cookies`);
  } else {
    console.log('⚠️  No PropertyGuru state file found');
  }
  
  if (fs.existsSync(epStatePath)) {
    const epState = JSON.parse(fs.readFileSync(epStatePath, 'utf8'));
    console.log(`✅ EdgeProp state found: ${Object.keys(epState.cookies || {}).length} cookies`);
  } else {
    console.log('⚠️  No EdgeProp state file found');
  }
}

async function testEnvironmentVariables() {
  console.log('\n🔧 Testing environment variables...');
  
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE'
  ];
  
  for (const varName of requiredVars) {
    if (process.env[varName]) {
      console.log(`✅ ${varName} is set`);
    } else {
      console.log(`❌ ${varName} is missing`);
    }
  }
  
  // Optional scraper variables
  const optionalVars = [
    'PG_MAX_PAGES',
    'EP_DISTRICTS'
  ];
  
  for (const varName of optionalVars) {
    if (process.env[varName]) {
      console.log(`✅ ${varName} = ${process.env[varName]}`);
    } else {
      console.log(`ℹ️  ${varName} not set (will use defaults)`);
    }
  }
}

async function main() {
  console.log('🚀 Starting simple scraper test...\n');
  
  await testEnvironmentVariables();
  await testStorageStates();
  
  console.log('\n🌐 Testing browser automation...');
  console.log('   (Browser will open for 10 seconds to test page loading)');
  await testBrowserAndPages();
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary:');
  console.log('   If all tests passed, you can run:');
  console.log('   - bun run scrape:pg  (PropertyGuru)');
  console.log('   - bun run scrape:ep  (EdgeProp)');
  console.log('   - bun run scrape:all (Both)');
  console.log('='.repeat(50));
}

// Run the test
main().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
