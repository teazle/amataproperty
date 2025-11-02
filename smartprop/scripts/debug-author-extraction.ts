#!/usr/bin/env bun

import { chromium } from 'playwright';

async function debugAuthorExtraction() {
  console.log('🔍 Debugging author extraction on individual articles...\n');

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
    // Remove webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Mock chrome object
    (window as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome = {
      runtime: {},
    };
    
    // Mock permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: PermissionDescriptor) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission } as PermissionStatus) :
        originalQuery(parameters)
    );
  });

  const page = await context.newPage();

  // Test articles that are falling back to "EdgeProp Staff"
  const testUrls = [
    'https://www.edgeprop.sg/property-news/ioi-properties-kicks-public-launch-w-residences-marina-view-100-units-3230-psf',
    'https://www.edgeprop.sg/property-news/worldwide-hotels-and-wyndham-partner-open-days-inn-wyndham-singapore-novena',
    'https://www.edgeprop.sg/property-news/system-over-luck-how-desiree-leung-built-6-figure-real-estate-career-while-raising-three-kids'
  ];

  for (const url of testUrls) {
    console.log(`\n🔍 Testing: ${url}`);
    console.log('=' .repeat(80));
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);

      const debugInfo = await page.evaluate(() => {
        // Wait for content to load
        const bodyText = document.body.textContent || '';
        
        // Find all possible content containers
        const contentSelectors = [
          'article',
          '[class*="article"]',
          '[class*="content"]',
          '[class*="post"]',
          'main',
          '.main-content',
          '[class*="news"]',
          '[class*="story"]',
          '[class*="text"]'
        ];
        
        const contentContainers = contentSelectors.map(selector => {
          const elements = document.querySelectorAll(selector);
          return {
            selector,
            count: elements.length,
            firstElement: elements[0] ? elements[0].tagName + (elements[0].className ? '.' + elements[0].className.split(' ').join('.') : '') : null,
            textLength: elements[0] ? (elements[0].textContent?.length || 0) : 0
          };
        });
        
        // Look for author patterns in different parts of the page
        const authorPatterns = [
          /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:and|&)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)?)\s*\/\s*EdgeProp Singapore/i,
          /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\/\s*EdgeProp Singapore/i,
          /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\/\s*EdgeProp Singapore/i,
          /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
        ];
        
        // Search in different sections of the page
        const searchSections = [
          { name: 'first 3000 chars', text: bodyText.substring(0, 3000) },
          { name: 'middle 3000 chars', text: bodyText.substring(15000, 18000) },
          { name: 'last 3000 chars', text: bodyText.substring(bodyText.length - 3000) },
          { name: 'full text', text: bodyText }
        ];
        
        const authorMatches = searchSections.map(section => {
          const matches = authorPatterns.map((pattern, index) => {
            const match = section.text.match(pattern);
            return {
              patternIndex: index,
              match: match ? match[1] : null,
              fullMatch: match ? match[0] : null
            };
          });
          return {
            section: section.name,
            matches
          };
        });
        
        // Look for specific author elements
        const authorElements = [
          'meta[name="author"]',
          '[class*="author"]',
          '[class*="byline"]',
          '[class*="writer"]',
          '[class*="reporter"]'
        ].map(selector => {
          const elements = document.querySelectorAll(selector);
          return {
            selector,
            count: elements.length,
            values: Array.from(elements).map(el => ({
              content: el.getAttribute('content') || el.textContent?.trim(),
              tagName: el.tagName,
              className: el.className
            }))
          };
        });
        
        return {
          title: document.title,
          bodyTextLength: bodyText.length,
          contentContainers,
          authorElements,
          authorMatches,
          sampleText: bodyText.substring(0, 1000)
        };
      });

      console.log(`📄 Title: ${debugInfo.title}`);
      console.log(`📄 Body Text Length: ${debugInfo.bodyTextLength}`);
      
      console.log(`\n📦 Content Containers:`);
      debugInfo.contentContainers.forEach(container => {
        if (container.count > 0) {
          console.log(`  ${container.selector}: ${container.count} elements, first: ${container.firstElement}, text length: ${container.textLength}`);
        }
      });
      
      console.log(`\n🏷️  Author Elements:`);
      debugInfo.authorElements.forEach(element => {
        if (element.count > 0) {
          console.log(`  ${element.selector}: ${element.count} elements`);
          element.values.forEach(value => {
            console.log(`    - ${value.tagName}: "${value.content}" (class: ${value.className})`);
          });
        }
      });
      
      console.log(`\n🔍 Author Pattern Matches:`);
      debugInfo.authorMatches.forEach(section => {
        console.log(`  ${section.section}:`);
        section.matches.forEach((match, index) => {
          if (match.match) {
            console.log(`    Pattern ${index + 1}: "${match.match}" (full: "${match.fullMatch}")`);
          }
        });
      });
      
      console.log(`\n📄 Sample Text (first 1000 chars):`);
      console.log(`"${debugInfo.sampleText}"`);

    } catch (error) {
      console.error(`❌ Error testing ${url}:`, error);
    }
  }

  await browser.close();
}

debugAuthorExtraction();