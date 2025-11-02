/**
 * Debug script to test EdgeProp content selectors
 * This will help us understand what content is available and why extraction is failing
 */

import { chromium } from 'playwright';

async function debugContentSelectors() {
  console.log('🔍 Starting EdgeProp content selector debugging...');
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Navigate to a specific article
  const testUrl = 'https://www.edgeprop.sg/property-news/sail-marina-bay-second-wind-residential-skyscraper';
  console.log(`📄 Navigating to: ${testUrl}`);
  
  await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Test different content selectors
  const results = await page.evaluate(() => {
    const selectors = [
      '.jsx-4217446631.article-detail.left-section',
      '.jsx-2128998887.detail-content', 
      '.jsx-4217446631',
      '.jsx-2128998887',
      'main article',
      'article',
      'main > div > div:first-child',
      'main',
      '[class*="article-content"]',
      '[class*="post-content"]',
      '[class*="content"]',
      'body'
    ];
    
    const results: any[] = [];
    
    selectors.forEach(selector => {
      try {
        const element = document.querySelector(selector);
        if (element) {
          const textContent = element.textContent || '';
          const innerHTML = element.innerHTML || '';
          
          results.push({
            selector,
            found: true,
            textLength: textContent.length,
            htmlLength: innerHTML.length,
            firstText: textContent.substring(0, 200),
            childrenCount: element.children.length,
            tagName: element.tagName
          });
        } else {
          results.push({
            selector,
            found: false
          });
        }
      } catch (e) {
        results.push({
          selector,
          found: false,
          error: (e as Error).message
        });
      }
    });
    
    // Also test paragraph extraction
    const paragraphSelectors = ['p', 'div'];
    const paragraphResults: any[] = [];
    
    paragraphSelectors.forEach(selector => {
      const elements = Array.from(document.querySelectorAll(selector));
      const validParagraphs = elements
        .map(el => el.textContent?.trim())
        .filter(text => text && text.length > 50)
        .slice(0, 10);
        
      paragraphResults.push({
        selector,
        totalElements: elements.length,
        validParagraphs: validParagraphs.length,
        samples: validParagraphs.slice(0, 3).map(p => p?.substring(0, 100))
      });
    });
    
    return { contentSelectors: results, paragraphResults };
  });
  
  console.log('\n📊 Content Selector Results:');
  results.contentSelectors.forEach(result => {
    if (result.found) {
      console.log(`✅ ${result.selector}:`);
      console.log(`   Text Length: ${result.textLength}`);
      console.log(`   HTML Length: ${result.htmlLength}`);
      console.log(`   Children: ${result.childrenCount}`);
      console.log(`   Tag: ${result.tagName}`);
      console.log(`   First Text: "${result.firstText}..."`);
    } else {
      console.log(`❌ ${result.selector}: Not found${result.error ? ` (${result.error})` : ''}`);
    }
    console.log('');
  });
  
  console.log('\n📝 Paragraph Extraction Results:');
  results.paragraphResults.forEach(result => {
    console.log(`${result.selector}:`);
    console.log(`   Total Elements: ${result.totalElements}`);
    console.log(`   Valid Paragraphs: ${result.validParagraphs}`);
    console.log(`   Samples:`);
    result.samples.forEach((sample: string, idx: number) => {
      console.log(`     ${idx + 1}. "${sample}..."`);
    });
    console.log('');
  });
  
  await browser.close();
}

debugContentSelectors().catch(console.error);