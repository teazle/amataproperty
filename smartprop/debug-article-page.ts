#!/usr/bin/env bun
import { chromium } from 'playwright';

const TEST_URL = 'https://www.edgeprop.sg/property-news/singapore-property-market-outlook-2024-experts-weigh-in-on-trends-and-predictions';

async function debugArticlePage() {
  console.log('🔍 Debugging Article Page Loading');
  console.log('='.repeat(60));
  console.log(`📰 URL: ${TEST_URL}`);
  console.log('='.repeat(60));

  let browser;
  try {
    // Launch browser with Cloudflare bypass
    console.log('🌐 Launching browser...');
    browser = await chromium.launch({ 
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--disable-web-security',
        '--disable-features=site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    });
    
    const page = await context.newPage();
    
    // Add stealth scripts
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // Remove automation indicators
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    });
    
    // Navigate to article
    console.log('📖 Navigating to article...');
    const response = await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    console.log(`📊 Response status: ${response?.status()}`);
    console.log(`🔗 Final URL: ${page.url()}`);
    
    // Wait for content to load
    await page.waitForTimeout(5000);
    
    // Check for Cloudflare challenge
    const cloudflareChallenge = await page.$('.cf-challenge-running, .cf-browser-verification, #challenge-form');
    if (cloudflareChallenge) {
      console.log('🛡️ Cloudflare challenge detected, waiting...');
      await page.waitForTimeout(10000);
    }
    
    // Extract basic page info
    const pageTitle = await page.title();
    const h1Text = await page.$eval('h1', el => el.textContent?.trim()).catch(() => 'No H1 found');
    const bodyText = await page.$eval('body', el => el.textContent?.trim().substring(0, 200)).catch(() => 'No body text');
    
    console.log('\n📋 Page Analysis:');
    console.log(`📄 Page Title: "${pageTitle}"`);
    console.log(`📰 H1 Text: "${h1Text}"`);
    console.log(`📝 Body Preview: "${bodyText}..."`);
    
    // Check for common article selectors
    const selectors = [
      'article h1',
      '.article-title',
      '.post-title',
      '[data-testid="article-title"]',
      '.content-title',
      'h1.title'
    ];
    
    console.log('\n🔍 Testing Article Title Selectors:');
    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          console.log(`✅ ${selector}: "${text?.trim()}"`);
        } else {
          console.log(`❌ ${selector}: Not found`);
        }
      } catch (error) {
        console.log(`❌ ${selector}: Error - ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Take a screenshot for manual inspection
    await page.screenshot({ path: 'debug-article-page.png', fullPage: true });
    console.log('\n📸 Screenshot saved as debug-article-page.png');
    
    // Keep browser open for manual inspection
    console.log('\n⏸️ Browser will stay open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);
    
  } catch (error) {
    console.error('❌ Debug failed:', error instanceof Error ? error.message : String(error));
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

debugArticlePage().catch(console.error);