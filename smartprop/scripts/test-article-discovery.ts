#!/usr/bin/env bun

import { chromium } from 'playwright';

async function testArticleDiscovery() {
  console.log('🔍 Testing article discovery...\n');

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

  try {
    const url = 'https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=1&page_size=20&sort_by=posted_desc&category=';
    console.log(`🌐 Navigating to: ${url}`);
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    const articleInfo = await page.evaluate(() => {
      // Look for article links using the same selectors as the scraper
      const links = Array.from(document.querySelectorAll('a[href*="/property-news/"]'));
      
      console.log(`Found ${links.length} article links`);
      
      const articles = links.slice(0, 5).map((link, index) => {
        const href = link.getAttribute('href') || '';
        const title = link.textContent?.trim() || '';
        
        return {
          index: index + 1,
          href,
          title: title.substring(0, 100),
          fullTitle: title
        };
      });
      
      // Also check for the specific EdgeProp article containers
      const containers = Array.from(document.querySelectorAll('div[class*="jsx-2211414346"]'));
      console.log(`Found ${containers.length} EdgeProp article containers`);
      
      return {
        totalLinks: links.length,
        articles,
        containerCount: containers.length
      };
    });

    console.log(`📊 Discovery Results:`);
    console.log(`  Total article links found: ${articleInfo.totalLinks}`);
    console.log(`  EdgeProp containers found: ${articleInfo.containerCount}`);
    
    console.log(`\n📰 First 5 articles:`);
    articleInfo.articles.forEach(article => {
      console.log(`  ${article.index}. ${article.title}...`);
      console.log(`     URL: ${article.href}`);
    });

  } catch (error) {
    console.error(`❌ Error testing discovery:`, error);
  }

  await browser.close();
}

testArticleDiscovery();
