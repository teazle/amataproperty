#!/usr/bin/env bun

import { chromium } from 'playwright';

async function debugFinal3Articles() {
  console.log('🔍 Debugging the final 3 articles for 100% success...\n');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-default-browser-check',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-domain-reliability',
      '--disable-component-extensions-with-background-pages',
      '--disable-background-networking',
      '--disable-breakpad'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 },
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': 'en-SG,en;q=0.9',
      'Cache-Control': 'max-age=0'
    }
  });

  // Add comprehensive stealth script
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
    
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-SG', 'en', 'en-US'],
    });
    
    Object.defineProperty(navigator, 'platform', {
      get: () => 'MacIntel',
    });
    
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });
    
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });
    
    Object.defineProperty(screen, 'width', {
      get: () => 1920,
    });
    
    Object.defineProperty(screen, 'height', {
      get: () => 1080,
    });
    
    Object.defineProperty(screen, 'availWidth', {
      get: () => 1920,
    });
    
    Object.defineProperty(screen, 'availHeight', {
      get: () => 1040,
    });
    
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
      value: function() {
        return { timeZone: 'Asia/Singapore' };
      },
    });
    
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  });

  const page = await context.newPage();

  // Test the 3 remaining problematic articles
  const problematicUrls = [
    {
      url: 'https://www.edgeprop.sg/property-news/ioi-properties-kicks-public-launch-w-residences-marina-view-100-units-3230-psf',
      expectedAuthor: 'Ashley Lo and Kalynskye Adrian'
    },
    {
      url: 'https://www.edgeprop.sg/property-news/worldwide-hotels-and-wyndham-partner-open-days-inn-wyndham-singapore-novena',
      expectedAuthor: 'Kalynskye Adrian'
    },
    {
      url: 'https://www.edgeprop.sg/property-news/system-over-luck-how-desiree-leung-built-6-figure-real-estate-career-while-raising-three-kids',
      expectedAuthor: 'Unknown (no author attribution)'
    }
  ];

  for (const article of problematicUrls) {
    console.log(`\n🔍 Analyzing: ${article.url}`);
    console.log(`Expected Author: ${article.expectedAuthor}`);
    console.log('=' .repeat(80));
    
    try {
      await page.goto(article.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(5000);

      const analysis = await page.evaluate(() => {
        const bodyText = document.body.textContent || '';
        
        // Check if we hit Cloudflare
        const isCloudflare = bodyText.includes('Verifying you are human') || 
                           bodyText.includes('Enable JavaScript and cookies to continue') ||
                           bodyText.includes('www.edgeprop.sg needs to review the security');
        
        if (isCloudflare) {
          return {
            status: 'cloudflare_blocked',
            title: document.title,
            bodyLength: bodyText.length
          };
        }
        
        // Look for ALL possible author patterns in the first 5000 characters
        const first5000 = bodyText.substring(0, 5000);
        
        const allPatterns = [
          // Standard patterns
          /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:and|&)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)?)\s*\/\s*EdgeProp Singapore/i,
          /By\s+EdgeProp Singapore\s*\/\s*EdgeProp Singapore/i,
          /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\/\s*EdgeProp Singapore/i,
          /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s|$)/i,
          
          // Alternative patterns
          /Author:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
          /Writer:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
          /Reporter:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
          
          // Look for any "By" followed by capitalized words
          /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi
        ];
        
        const allMatches = [];
        for (const pattern of allPatterns) {
          let match;
          while ((match = pattern.exec(first5000)) !== null) {
            allMatches.push({
              pattern: pattern.toString(),
              fullMatch: match[0],
              author: match[1] || match[0],
              index: match.index,
              context: first5000.substring(Math.max(0, match.index - 50), match.index + 100)
            });
          }
        }
        
        // Look for specific author elements
        const authorSelectors = [
          'meta[name="author"]',
          '[class*="author"]',
          '[class*="byline"]',
          '[class*="writer"]',
          '[class*="reporter"]'
        ];
        
        const authorElements = authorSelectors.map(selector => {
          const elements = document.querySelectorAll(selector);
          return {
            selector,
            count: elements.length,
            values: Array.from(elements).map(el => ({
              content: el.getAttribute('content') || el.textContent?.trim(),
              tagName: el.tagName
            }))
          };
        }).filter(el => el.count > 0);
        
        return {
          status: 'success',
          title: document.title,
          bodyLength: bodyText.length,
          first5000Length: first5000.length,
          allMatches,
          authorElements,
          sampleFirst5000: first5000
        };
      });

      if (analysis.status === 'cloudflare_blocked') {
        console.log(`❌ CLOUDFLARE BLOCKED`);
        console.log(`📄 Title: ${analysis.title}`);
        console.log(`📄 Body Length: ${analysis.bodyLength}`);
      } else {
        console.log(`✅ SUCCESS`);
        console.log(`📄 Title: ${analysis.title}`);
        console.log(`📄 Body Length: ${analysis.bodyLength}`);
        console.log(`📄 First 5000 chars: ${analysis.first5000Length}`);
        
        console.log(`\n🔍 ALL Pattern Matches:`);
        analysis.allMatches.forEach((match, index) => {
          console.log(`  ${index + 1}. Pattern: ${match.pattern.substring(0, 50)}...`);
          console.log(`     Full Match: "${match.fullMatch}"`);
          console.log(`     Author: "${match.author}"`);
          console.log(`     Context: "${match.context}"`);
          console.log('');
        });
        
        if (analysis.authorElements.length > 0) {
          console.log(`\n🏷️  Author Elements Found:`);
          analysis.authorElements.forEach(element => {
            console.log(`  ${element.selector}: ${element.count} elements`);
            element.values.forEach(value => {
              console.log(`    - ${value.tagName}: "${value.content}"`);
            });
          });
        }
        
        console.log(`\n📄 Sample First 5000 chars:`);
        console.log(`"${analysis.sampleFirst5000}"`);
      }

    } catch (error) {
      console.error(`❌ Error analyzing ${article.url}:`, error);
    }
  }

  await browser.close();
}

debugFinal3Articles();
