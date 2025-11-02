#!/usr/bin/env bun

import { chromium } from 'playwright';

async function debugEdgePropPage() {
  console.log('🔍 Debugging EdgeProp page structure...');
  
  const browser = await chromium.launch({
    headless: true
  });
  
  try {
    const page = await browser.newPage();
    
    // Navigate to EdgeProp
    console.log('📄 Navigating to EdgeProp...');
    await page.goto('https://www.edgeprop.sg/property-news/latest', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    // Wait for content to load
    await page.waitForTimeout(5000);
    
    // Check page title
    const title = await page.title();
    console.log(`📄 Page title: ${title}`);
    
    // Check for article containers
    const articleSelectors = [
      'article',
      '.article',
      '[class*="article"]',
      '.news-item',
      '[class*="news"]',
      '.jsx-2211414346',
      'a[href*="/property-news/"]',
      'a[href*="/news/"]'
    ];
    
    for (const selector of articleSelectors) {
      const count = await page.locator(selector).count();
      console.log(`🔍 Selector "${selector}": ${count} elements found`);
      
      if (count > 0) {
        // Get first few elements for inspection
        const elements = await page.locator(selector).first().allInnerTexts();
        console.log(`   📝 Sample content: ${elements.slice(0, 2).join(' | ')}`);
      }
    }
    
    // Check for links
    const links = await page.locator('a').count();
    console.log(`🔗 Total links found: ${links}`);
    
    // Check for property news links specifically
    const newsLinks = await page.locator('a[href*="property-news"]').count();
    console.log(`📰 Property news links: ${newsLinks}`);
    
    // Get page HTML structure (first 2000 chars)
    const html = await page.content();
    console.log(`📄 Page HTML structure (first 2000 chars):`);
    console.log(html.substring(0, 2000));
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

debugEdgePropPage().catch(console.error);