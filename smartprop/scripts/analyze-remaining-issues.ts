#!/usr/bin/env bun

import { chromium } from 'playwright';

async function analyzeRemainingIssues() {
  console.log('🔍 Analyzing remaining author extraction issues...\n');

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

  // Test the specific articles that are still failing
  const failingUrls = [
    'https://www.edgeprop.sg/property-news/ioi-properties-kicks-public-launch-w-residences-marina-view-100-units-3230-psf',
    'https://www.edgeprop.sg/property-news/worldwide-hotels-and-wyndham-partner-open-days-inn-wyndham-singapore-novena',
    'https://www.edgeprop.sg/property-news/system-over-luck-how-desiree-leung-built-6-figure-real-estate-career-while-raising-three-kids',
    'https://www.edgeprop.sg/property-news/grand-dunman-freedom-to-live-life-to-the-fullest-with-connectivity-and-convenience-at-ones-doorstep-in-prime-district-15'
  ];

  for (const url of failingUrls) {
    console.log(`\n🔍 Analyzing: ${url}`);
    console.log('=' .repeat(80));
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(5000); // Longer wait for Cloudflare

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
            bodyLength: bodyText.length,
            cloudflareText: bodyText.substring(0, 500)
          };
        }
        
        // Look for author patterns in different sections
        const searchSections = [
          { name: 'first 3000', text: bodyText.substring(0, 3000) },
          { name: '3000-6000', text: bodyText.substring(3000, 6000) },
          { name: '6000-9000', text: bodyText.substring(6000, 9000) },
          { name: '9000-12000', text: bodyText.substring(9000, 12000) }
        ];
        
        const patterns = [
          /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:and|&)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)?)\s*\/\s*EdgeProp Singapore/i,
          /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\/\s*EdgeProp Singapore/i,
          /By\s+EdgeProp Singapore\s*\/\s*EdgeProp Singapore/i
        ];
        
        const foundPatterns = searchSections.map(section => {
          const matches = patterns.map((pattern, index) => {
            const match = section.text.match(pattern);
            return {
              patternIndex: index,
              match: match ? match[0] : null,
              author: match ? match[1] : null
            };
          });
          return {
            section: section.name,
            matches
          };
        });
        
        // Look for specific author elements
        const authorSelectors = [
          '[class*="author"]',
          '[class*="byline"]',
          '[class*="writer"]',
          '[class*="reporter"]',
          'meta[name="author"]'
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
        });
        
        return {
          status: 'success',
          title: document.title,
          bodyLength: bodyText.length,
          foundPatterns,
          authorElements: authorElements.filter(el => el.count > 0),
          sampleText: bodyText.substring(0, 1000)
        };
      });

      if (analysis.status === 'cloudflare_blocked') {
        console.log(`❌ CLOUDFLARE BLOCKED`);
        console.log(`📄 Title: ${analysis.title}`);
        console.log(`📄 Body Length: ${analysis.bodyLength}`);
        console.log(`🔒 Cloudflare Text: ${analysis.cloudflareText}`);
      } else {
        console.log(`✅ SUCCESS`);
        console.log(`📄 Title: ${analysis.title}`);
        console.log(`📄 Body Length: ${analysis.bodyLength}`);
        
        console.log(`\n🔍 Author Pattern Analysis:`);
        analysis.foundPatterns.forEach(section => {
          console.log(`  ${section.section}:`);
          section.matches.forEach((match, index) => {
            if (match.match) {
              console.log(`    Pattern ${index + 1}: "${match.match}"`);
              if (match.author) {
                console.log(`      Author: "${match.author}"`);
              }
            }
          });
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
      }

    } catch (error) {
      console.error(`❌ Error analyzing ${url}:`, error);
    }
  }

  await browser.close();
}

analyzeRemainingIssues();
