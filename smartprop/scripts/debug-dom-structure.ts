#!/usr/bin/env bun

import { chromium } from 'playwright';

async function debugDOMStructure() {
  console.log('🔍 Debugging DOM Structure for EdgeProp Article...\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const articleUrl = 'https://www.edgeprop.sg/property-news/six-storey-detached-factory-pandan-avenue-sale-21-mil';

  try {
    await page.goto(articleUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    const debugData = await page.evaluate(() => {
      console.log('🔍 Analyzing DOM structure...');
      
      // Find all elements that might contain article content
      const candidates = [
        'main',
        'main > div',
        'main > div > div:first-child',
        'main > div > div:last-child',
        'article',
        '.article-content',
        '.post-content',
        '.entry-content'
      ];
      
      const results: { selector: string; textLength: number; preview: string; hasRealContent: boolean }[] = [];
      
      candidates.forEach(selector => {
        try {
          const element = document.querySelector(selector);
          if (element) {
            const text = element.textContent?.trim() || '';
            const hasRealContent = text.includes('$21 million') || 
                                 text.includes('Pandan Avenue') || 
                                 text.includes('six-storey detached factory') ||
                                 text.includes('guide price') ||
                                 text.includes('232 psf');
            
            results.push({
              selector,
              textLength: text.length,
              preview: text.substring(0, 200),
              hasRealContent
            });
          }
        } catch (e) {
          console.log(`Error with selector ${selector}:`, e);
        }
      });
      
      // Also try to find elements by looking for specific content
      const allElements = document.querySelectorAll('*');
      const realContentElements: { tagName: string; className: string; textLength: number; preview: string }[] = [];
      
      allElements.forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text.includes('six-storey detached factory') && text.length > 100 && text.length < 5000) {
          realContentElements.push({
            tagName: el.tagName,
            className: el.className || '',
            textLength: text.length,
            preview: text.substring(0, 200)
          });
        }
      });
      
      return {
        candidates: results,
        realContentElements: realContentElements.slice(0, 5) // First 5 matches
      };
    });

    console.log('\n📊 DOM STRUCTURE ANALYSIS:');
    console.log('================================================================================\n');
    
    console.log('🎯 CANDIDATE ELEMENTS:');
    debugData.candidates.forEach((result, index) => {
      console.log(`${index + 1}. Selector: "${result.selector}"`);
      console.log(`   Text Length: ${result.textLength}`);
      console.log(`   Has Real Content: ${result.hasRealContent ? '✅ YES' : '❌ NO'}`);
      console.log(`   Preview: ${result.preview}...`);
      console.log('');
    });
    
    console.log('🔍 REAL CONTENT ELEMENTS:');
    debugData.realContentElements.forEach((result, index) => {
      console.log(`${index + 1}. Tag: ${result.tagName}, Class: "${result.className}"`);
      console.log(`   Text Length: ${result.textLength}`);
      console.log(`   Preview: ${result.preview}...`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Debugging failed:', error);
  } finally {
    await browser.close();
  }
}

debugDOMStructure();
