#!/usr/bin/env bun

import { chromium } from 'playwright';

async function debugFailingAuthors() {
  console.log('🔍 Debugging failing author extractions...\n');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 },
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': 'en-SG,en;q=0.9',
    }
  });

  // Add stealth script
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    (window as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome = {
      runtime: {},
    };
    
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: PermissionDescriptor) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission } as PermissionStatus) :
        originalQuery(parameters)
    );
  });

  const page = await context.newPage();

  // Test the articles that are still failing
  const failingUrls = [
    'https://www.edgeprop.sg/property-news/penrith-over-41-times-subscribed-ahead-weekend-launch-oct-18',
    'https://www.edgeprop.sg/property-news/system-over-luck-how-desiree-leung-built-6-figure-real-estate-career-while-raising-three-kids'
  ];

  for (const url of failingUrls) {
    console.log(`\n🔍 Testing: ${url}`);
    console.log('=' .repeat(80));
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      const debugInfo = await page.evaluate(() => {
        const bodyText = document.body.textContent || '';
        
        // Look for any text that might contain author information
        const authorKeywords = ['By ', 'Author:', 'Writer:', 'Reporter:', '/ EdgeProp', 'EdgeProp Singapore'];
        
        const foundKeywords = authorKeywords.map(keyword => {
          const index = bodyText.indexOf(keyword);
          if (index !== -1) {
            const context = bodyText.substring(Math.max(0, index - 100), index + 200);
            return {
              keyword,
              index,
              context
            };
          }
          return null;
        }).filter(Boolean);
        
        // Look for any "By" patterns in the entire page
        const byPatterns = [
          /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
          /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\/\s*EdgeProp/gi,
          /Author:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi
        ];
        
        const allMatches = byPatterns.map((pattern, index) => {
          const matches = [];
          let match;
          while ((match = pattern.exec(bodyText)) !== null) {
            matches.push({
              patternIndex: index,
              match: match[0],
              author: match[1] || match[0],
              index: match.index
            });
          }
          return matches;
        }).flat();
        
        // Get the main content area
        const mainContent = document.querySelector('.main-content') || 
                           document.querySelector('[class*="news"]') ||
                           document.querySelector('main');
        
        const mainContentText = mainContent ? mainContent.textContent || '' : '';
        
        return {
          title: document.title,
          bodyTextLength: bodyText.length,
          mainContentLength: mainContentText.length,
          foundKeywords,
          allMatches: allMatches.slice(0, 10), // Limit to first 10 matches
          sampleMainContent: mainContentText.substring(0, 1000)
        };
      });

      console.log(`📄 Title: ${debugInfo.title}`);
      console.log(`📄 Body Text Length: ${debugInfo.bodyTextLength}`);
      console.log(`📄 Main Content Length: ${debugInfo.mainContentLength}`);
      
      console.log(`\n🔍 Found Keywords:`);
      debugInfo.foundKeywords.forEach(item => {
        console.log(`  "${item.keyword}" at position ${item.index}:`);
        console.log(`    Context: "${item.context}"`);
      });
      
      console.log(`\n🔍 All Author Matches:`);
      debugInfo.allMatches.forEach((match, index) => {
        console.log(`  ${index + 1}. Pattern ${match.patternIndex + 1}: "${match.match}"`);
        console.log(`     Author: "${match.author}" at position ${match.index}`);
      });
      
      console.log(`\n📄 Sample Main Content (first 1000 chars):`);
      console.log(`"${debugInfo.sampleMainContent}"`);

    } catch (error) {
      console.error(`❌ Error testing ${url}:`, error);
    }
  }

  await browser.close();
}

debugFailingAuthors();
