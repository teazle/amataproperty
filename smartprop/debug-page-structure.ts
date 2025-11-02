#!/usr/bin/env npx tsx

/**
 * Debug script to examine EdgeProp page structure and identify correct selectors
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';

async function debugPageStructure() {
  console.log('🔍 Debugging EdgeProp Page Structure');
  console.log('=' .repeat(50));
  
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  
  try {
    console.log('🌐 Launching browser...');
    browser = await chromium.launch({
      headless: false,
      channel: 'chromium'
    });
    
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'Asia/Kuala_Lumpur'
    });
    
    page = await context.newPage();
    
    // Navigate to EdgeProp news page
    console.log('🔍 Navigating to EdgeProp Singapore news page...');
    const url = 'https://www.edgeprop.sg/property-news/latest';
    
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    console.log('✅ Page loaded successfully');
    console.log(`📍 Current URL: ${page.url()}`);
    
    // Wait for content to load
    await page.waitForTimeout(5000);
    
    // Get page title
    const title = await page.title();
    console.log(`📄 Page title: ${title}`);
    
    // Check for common article containers
    const containerInfo = await page.evaluate(() => {
      const selectors = [
        'article',
        '.article',
        '.article-item',
        '.news-item',
        '.post',
        '.entry',
        '[class*="article"]',
        '[class*="news"]',
        '[class*="post"]',
        '[class*="item"]',
        'a[href*="/property-news/"]'
      ];
      
      const results: any = {};
      
      selectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        results[selector] = {
          count: elements.length,
          samples: Array.from(elements).slice(0, 3).map(el => ({
            tagName: el.tagName,
            className: el.className,
            textContent: el.textContent?.substring(0, 100) + '...',
            href: (el as HTMLAnchorElement).href || 'N/A'
          }))
        };
      });
      
      return results;
    });
    
    console.log('\n🔍 CONTAINER ANALYSIS:');
    console.log('-' .repeat(40));
    
    Object.entries(containerInfo).forEach(([selector, info]: [string, any]) => {
      console.log(`\n📋 Selector: ${selector}`);
      console.log(`   Count: ${info.count}`);
      if (info.count > 0) {
        console.log('   Samples:');
        info.samples.forEach((sample: any, index: number) => {
          console.log(`     ${index + 1}. ${sample.tagName}.${sample.className}`);
          console.log(`        Text: ${sample.textContent}`);
          if (sample.href !== 'N/A') {
            console.log(`        Href: ${sample.href}`);
          }
        });
      }
    });
    
    // Get all links that might be articles
    const articleLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/property-news/"]'));
      return links.map(link => ({
        href: (link as HTMLAnchorElement).href,
        text: link.textContent?.trim(),
        className: link.className,
        parentClassName: link.parentElement?.className,
        grandParentClassName: link.parentElement?.parentElement?.className
      })).slice(0, 10); // First 10 for analysis
    });
    
    console.log('\n🔗 ARTICLE LINKS ANALYSIS:');
    console.log('-' .repeat(40));
    
    articleLinks.forEach((link, index) => {
      console.log(`\n${index + 1}. ${link.text}`);
      console.log(`   Href: ${link.href}`);
      console.log(`   Link class: ${link.className}`);
      console.log(`   Parent class: ${link.parentClassName}`);
      console.log(`   Grandparent class: ${link.grandParentClassName}`);
    });
    
    // Get page HTML structure (first 2000 chars)
    const htmlStructure = await page.evaluate(() => {
      return document.body.innerHTML.substring(0, 2000);
    });
    
    console.log('\n📄 HTML STRUCTURE SAMPLE:');
    console.log('-' .repeat(40));
    console.log(htmlStructure);
    
    // Wait for user to examine the page
    console.log('\n⏸️  Browser will stay open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);
    
  } catch (error) {
    console.error('❌ ERROR during debug:', error);
  } finally {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

// Run the debug
debugPageStructure().catch(console.error);