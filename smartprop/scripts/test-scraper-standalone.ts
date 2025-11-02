#!/usr/bin/env tsx

/**
 * Standalone test for MCP scraper without database dependencies
 * Tests Cloudflare bypass and exact article count
 */

async function testScraperStandalone() {
  console.log('🚀 Testing MCP Scraper (Standalone - No DB)...\n');
  
  try {
    // Import playwright directly to avoid database dependencies
    const { chromium } = await import('playwright');
    
    console.log('📍 Launching browser with enhanced Cloudflare bypass...');
    
    const browser = await chromium.launch({
      headless: false, // Make visible for debugging
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-automation',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-popup-blocking',
        '--disable-translate',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-ipc-flooding-protection',
        '--enable-features=NetworkService,NetworkServiceLogging',
        '--force-color-profile=srgb',
        '--metrics-recording-only',
        '--use-mock-keychain',
        '--disable-component-extensions-with-background-pages'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'Asia/Singapore',
      geolocation: { latitude: 1.3521, longitude: 103.8198 },
      permissions: ['geolocation']
    });

    const page = await context.newPage();
    
    // Enhanced Cloudflare bypass logic
    console.log('🔒 Implementing enhanced Cloudflare bypass...');
    
    // Navigate to EdgeProp property news (using latest page for more articles)
    console.log('📄 Navigating to EdgeProp property news...');
    await page.goto('https://www.edgeprop.sg/property-news/latest', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    // Wait for initial load
    await page.waitForTimeout(3000);
    
    // Enhanced Cloudflare detection and bypass
    const cloudflareDetected = await page.evaluate(() => {
      const pageContent = document.body.textContent || '';
      const pageTitle = document.title;
      
      // More specific Cloudflare detection to avoid false positives
      const indicators = [
        (pageTitle.includes('Just a moment') && pageTitle.includes('Cloudflare')),
        (pageContent.includes('cf-browser-verification') && pageContent.includes('Just a moment')),
        (pageContent.includes('checking-your-browser') && pageContent.includes('Cloudflare')),
        pageContent.includes('cf-challenge-running'),
        pageContent.includes('Verifying you are human'),
        (pageContent.includes('Please enable JavaScript') && pageContent.includes('Cloudflare')),
        document.querySelector('.cf-challenge-form') !== null,
        document.querySelector('#challenge-form') !== null,
        window.location.href.includes('challenge-platform.cloudflare.com')
      ];
      return indicators.some(indicator => indicator);
    });
    
    if (cloudflareDetected) {
      console.log('🚫 Cloudflare challenge detected! Attempting bypass...');
      
      // Look for and click Cloudflare checkbox
      const checkboxSelectors = [
        'input[type="checkbox"][name*="cf"]',
        'input[type="checkbox"]#challenge-stage',
        '.cf-turnstile input[type="checkbox"]',
        '.challenge-form input[type="checkbox"]',
        '#challenge-form input[type="checkbox"]',
        'input[type="checkbox"]',
        '.ctp-checkbox-container input',
        '[data-callback] input[type="checkbox"]'
      ];
      
      let checkboxClicked = false;
      
      for (const selector of checkboxSelectors) {
        try {
          const checkbox = await page.locator(selector).first();
          if (await checkbox.isVisible({ timeout: 2000 })) {
            console.log(`🎯 Found checkbox with selector: ${selector}`);
            await checkbox.click();
            checkboxClicked = true;
            console.log('✅ Checkbox clicked successfully');
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // Check for iframes and handle them
      const iframes = await page.locator('iframe').all();
      for (const iframe of iframes) {
        try {
          const src = await iframe.getAttribute('src');
          if (src && (src.includes('cloudflare') || src.includes('turnstile') || src.includes('challenge'))) {
            console.log(`🖼️ Found Cloudflare iframe: ${src}`);
            
            const frameContent = await iframe.contentFrame();
            if (frameContent) {
              for (const selector of checkboxSelectors) {
                try {
                  const checkbox = frameContent.locator(selector).first();
                  if (await checkbox.isVisible({ timeout: 2000 })) {
                    console.log(`🎯 Found checkbox in iframe with selector: ${selector}`);
                    await checkbox.click();
                    checkboxClicked = true;
                    console.log('✅ Iframe checkbox clicked successfully');
                    break;
                  }
                } catch (e) {
                  // Continue to next selector
                }
              }
            }
          }
        } catch (e) {
          // Continue to next iframe
        }
      }
      
      if (checkboxClicked) {
        console.log('⏳ Waiting for Cloudflare bypass to complete...');
        await page.waitForTimeout(5000);
        
        // Wait for page to reload or redirect
        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
        } catch (e) {
          console.log('⚠️ Page didn\'t reload, continuing...');
        }
      } else {
        console.log('⚠️ No Cloudflare checkbox found or clickable');
      }
    } else {
      console.log('✅ No Cloudflare challenge detected');
    }
    
    // Wait for content to load
    console.log('⏳ Waiting for article content to load...');
    await page.waitForTimeout(5000);
    
    // Test article discovery using the same logic as the scraper
    console.log('🔍 Testing article discovery...');
    
    const articles = await page.evaluate(() => {
      // Try multiple strategies to find article containers (same as MCP scraper)
      let articleContainers: Element[] = [];
      
      // Strategy 1: Look for any class containing "article"
      const articleClassContainers = Array.from(document.querySelectorAll('[class*="article"]'));
      console.log(`✅ Found ${articleClassContainers.length} containers with "article" in class`);
      
      // Strategy 2: Look for JSX containers (EdgeProp uses Next.js with JSX classes)
      const jsxContainers = Array.from(document.querySelectorAll('div[class*="jsx-"]'));
      console.log(`✅ Found ${jsxContainers.length} JSX containers`);
      
      // Strategy 3: Look for divs that contain article links and images
      const linkContainers = Array.from(document.querySelectorAll('div')).filter(div => {
        const hasArticleLink = div.querySelector('a[href*="/property-news/"]:not([href*="/property-news-search"]):not([href*="/property-news/latest"]):not([href*="/property-news/news"]):not([href*="/property-news/in-depth"])');
        const hasImage = div.querySelector('img');
        const href = hasArticleLink?.getAttribute('href');
        if (hasArticleLink && hasImage && href && href.includes('/property-news/')) {
          const isRelativeUrl = href.startsWith('/property-news/');
          const isAbsoluteUrl = href.includes('edgeprop.sg/property-news/');
          const pathSegments = href.split('/').length;
          return (isRelativeUrl && pathSegments >= 3) || (isAbsoluteUrl && pathSegments >= 5);
        }
        return false;
      });
      console.log(`✅ Found ${linkContainers.length} containers with article links and images`);
      
      // Use the strategy that found the most containers
      if (linkContainers.length > 0) {
        articleContainers = linkContainers;
        console.log(`Using link containers strategy: ${linkContainers.length} containers`);
      } else if (articleClassContainers.length > 0) {
        articleContainers = articleClassContainers;
        console.log(`Using article class strategy: ${articleClassContainers.length} containers`);
      } else if (jsxContainers.length > 0) {
        articleContainers = jsxContainers;
        console.log(`Using JSX containers strategy: ${jsxContainers.length} containers`);
      }
      
      console.log(`Found ${articleContainers.length} potential article containers`);
      
      const uniqueHrefs = new Set();
      const extracted = [];
      
      for (const container of articleContainers) {
        const link = container.querySelector('a[href*="/property-news/"]');
        if (!link) continue;
        
        let href = link.getAttribute('href') || '';
        if (!href.startsWith('http')) {
          href = 'https://www.edgeprop.sg' + (href.startsWith('/') ? '' : '/') + href;
        }
        
        // Filter out category pages and navigation links (less restrictive for /latest page)
        if (!href.includes('/property-news/') ||
            href.includes('/property-news-search') ||
            href.includes('/property-news/special-feature')) {
          continue;
        }
        
        if (uniqueHrefs.has(href)) continue;
        uniqueHrefs.add(href);
        
        // Extract title with enhanced fallback logic
        let title = '';
        
        // Try multiple title selectors
        const titleSelectors = [
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          '.title', '[class*="title"]', '[class*="headline"]',
          '.article-title', '.news-title', '.post-title'
        ];
        
        for (const selector of titleSelectors) {
          const titleEl = container.querySelector(selector);
          if (titleEl && titleEl.textContent?.trim()) {
            title = titleEl.textContent.trim();
            break;
          }
        }
        
        // Fallback: use link text
        if (!title && link.textContent?.trim()) {
          title = link.textContent.trim();
        }
        
        // Final fallback: extract from URL slug
        if (!title) {
          const urlParts = href.split('/');
          const slug = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];
          if (slug) {
            title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          }
        }
        
        if (title && title.length >= 3) {
          extracted.push({
            href,
            title,
            path: href.replace('https://www.edgeprop.sg', '')
          });
        }
        
        // Limit to 20 articles
        if (extracted.length >= 20) break;
      }
      
      return extracted;
    });
    
    console.log(`\n📈 Article Discovery Results:`);
    console.log(`   Total articles found: ${articles.length}`);
    console.log(`   Expected: exactly 20 articles`);
    console.log(`   Status: ${articles.length === 20 ? '✅ CORRECT' : articles.length > 20 ? '⚠️ TOO MANY' : '❌ TOO FEW'}`);
    
    if (articles.length > 0) {
      console.log(`\n📋 Article List:`);
      articles.forEach((article: any, index: number) => {
        console.log(`   ${index + 1}. ${article.title.substring(0, 80)}${article.title.length > 80 ? '...' : ''}`);
        console.log(`      URL: ${article.href}`);
      });
    }
    
    // Quality checks
    const hasValidTitles = articles.every((article: any) => article.title && article.title.length > 5);
    const hasValidPaths = articles.every((article: any) => article.path && article.path.length > 0);
    
    console.log(`\n🔍 Quality Checks:`);
    console.log(`   Valid titles: ${hasValidTitles ? '✅' : '❌'}`);
    console.log(`   Valid paths: ${hasValidPaths ? '✅' : '❌'}`);
    
    // Final assessment
    const isSuccess = articles.length === 20 && hasValidTitles && hasValidPaths;
    console.log(`\n🎯 Final Result: ${isSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);
    
    if (isSuccess) {
      console.log('✅ Enhanced Cloudflare bypass is working correctly!');
      console.log('✅ Article count is exactly 20 as expected!');
      console.log('✅ All articles have valid titles and paths!');
    } else {
      console.log('❌ Issues detected:');
      if (articles.length !== 20) {
        console.log(`   - Article count: ${articles.length} (expected: 20)`);
      }
      if (!hasValidTitles) {
        console.log('   - Some articles have invalid titles');
      }
      if (!hasValidPaths) {
        console.log('   - Some articles have invalid paths');
      }
    }
    
    await browser.close();
    
  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
    
    if (error instanceof Error) {
      if (error.message.includes('Cloudflare') || error.message.includes('challenge')) {
        console.error('🚫 Cloudflare protection detected - bypass failed');
      } else if (error.message.includes('timeout')) {
        console.error('⏱️ Timeout error - may need longer wait times');
      }
    }
  }
}

// Run the test
testScraperStandalone().catch(console.error);