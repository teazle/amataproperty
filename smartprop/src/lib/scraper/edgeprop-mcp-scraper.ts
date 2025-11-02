/**
 * EdgeProp Scraper using Playwright MCP
 * More reliable approach using browser automation
 */

import * as db from '@/lib/db/articles';
import { upsertArticleContent } from '@/lib/db/article-content';
// Removed browser-incompatible imports
// import { cleanArticleParagraphs, sanitizeHtmlContent, extractCleanTextContent } from '@/lib/utils/content-parser';

export interface MCPArticle {
  nid: string;
  title: string;
  path: string;
  thumbnail: string;
  author: string;
  created: string;
  category: string[];
  description: string;
  created_on: string;
  keywords?: string[];
  
  // Full content fields
  html_content?: string;
  text_content: string;
  paragraphs: string[];
  links: Array<{text: string; url: string; type: 'internal' | 'external'}>;
  images: Array<{url: string; alt?: string; caption?: string}>;
  main_image_url?: string;
  main_image_caption?: string;
  tags?: string[];
  word_count: number;
  reading_time_minutes: number;
  
  scraped_at: Date;
}

export interface MCPProgress {
  currentPage: number;
  totalPages: number;
  currentArticle: number;
  articlesDiscovered: number;
  articlesScraped: number;
  articlesFailed: number;
  status: 'running' | 'completed' | 'stopped' | 'error';
  message: string;
}

export type MCPProgressCallback = (progress: MCPProgress) => void;

/**
 * Scrape EdgeProp using Playwright MCP approach
 */
export async function scrapeEdgePropMCP(
  maxPages: number,
  onProgress: MCPProgressCallback,
  sessionId?: string,
  saveImmediately: boolean = false,
  maxArticles?: number // Optional: limit number of articles to scrape
): Promise<MCPArticle[]> {
  console.log('Starting EdgeProp scraper using MCP approach...');
  
  // Try to use playwright-ghost for better Cloudflare bypass
  // If not available, fall back to regular playwright
  let chromium: any;
  let useGhost = false;
  try {
    const playwrightGhost = await import('playwright-ghost');
    chromium = playwrightGhost.chromium;
    useGhost = true;
    console.log('✅ Using playwright-ghost for enhanced Cloudflare bypass');
  } catch (e: unknown) {
    // Fall back to regular playwright
    const playwright = await import('playwright');
    chromium = playwright.chromium;
    console.log('⚠️ playwright-ghost not available, using regular playwright');
  }
  
  // Use new Chromium headless mode (channel: 'chromium') for better Cloudflare bypass
  // This uses the real Chrome browser instead of headless shell, making it harder to detect
  const launchOptions = { 
    headless: false, // Make browser visible for debugging
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Remove automation flags that Cloudflare detects
      '--exclude-switches=enable-automation',
      '--disable-blink-features=AutomationControlled',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
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
  };
  
  // Try to use chromium channel if available (better Cloudflare bypass)
  // If it fails, fall back to default browser
  let browser;
  try {
    browser = await chromium.launch({ 
      ...launchOptions,
      channel: 'chromium' // Use new Chromium headless mode - more authentic, harder to detect
    });
    console.log('✅ Using Chromium channel for better Cloudflare bypass');
  } catch (e: unknown) {
    console.log('⚠️ Chromium channel not available, using default browser:', e);
    browser = await chromium.launch(launchOptions);
  }
  
  // Create context with stealth configuration (same as EP live scraper)
  const context = await browser.newContext({
    // Add init script to prevent __name errors
    javaScriptEnabled: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 }, // Singapore coordinates
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-SG,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    }
  });
  
  // Remove automation indicators (crucial for bypassing Cloudflare)
  await context.addInitScript(() => {
    // Override the navigator.webdriver property
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
    
    // Override navigator properties
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
    
    // Mock screen properties
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
    
    // Mock timezone
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
      value: function() {
        return { timeZone: 'Asia/Singapore' };
      },
    });
    
    // Remove automation indicators
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    
    // Additional Cloudflare bypass: hide webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
    
    // Mock plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5], // Fake plugins array
    });
    
    // Mock mimeTypes
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => [1, 2, 3, 4, 5], // Fake mimeTypes array
    });
    
    // Override getBattery if it exists (TypeScript-safe check)
    if ('getBattery' in navigator && typeof (navigator as any).getBattery === 'function') {
      (navigator as any).getBattery = () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1
      });
    }
    
    // Fix __name error that EdgeProp's JavaScript expects
    if (typeof (window as any).__name === 'undefined') {
      (window as any).__name = function() { return ''; };
    }
  });
  
  const page = await context.newPage();
  
  // Listen to console events to capture logs from page.evaluate()
  page.on('console', (msg: any) => {
    const logType = msg.type();
    const args = msg.args();
    const text = msg.text();
    
    // Log all important messages including debug info - be more permissive for debugging
    if (text.includes('🔍') || text.includes('⚠️') || text.includes('✅') || text.includes('❌') || 
        text.includes('📷') || text.includes('📊') ||
        text.includes('Starting article') || text.includes('Cloudflare') || text.includes('Navigation') ||
        text.includes('Page title') || text.includes('Selector') || text.includes('Found') ||
        text.includes('images') || text.includes('image') || text.includes('Extracted') ||
        text.includes('paragraph') || text.includes('Raw paragraphs') || text.includes('cleaned') ||
        text.includes('Generated textContent') || text.includes('Fallback') || text.includes('Last resort') ||
        text.includes('After cleanParagraphs') || text.includes('Minimal filter') || text.includes('ULTIMATE FALLBACK') ||
        text.includes('DEBUG') || text.includes('cleanParagraphs') || text.includes('filtered')) {
      console.log(`[Browser] ${text}`);
    }
  });
  
  // Listen to page errors
  page.on('pageerror', (error: any) => {
    console.error(`[Page Error] ${error.message}`);
  });
  
  const allArticles: MCPArticle[] = [];
  const seenIds = new Set<string>();
  let articlesFailed = 0;
  
  try {
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: 0,
      articlesScraped: 0,
      articlesFailed: 0,
      status: 'running',
      message: 'Starting EdgeProp scraper...'
    });
    
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`Starting page ${pageNum} of ${maxPages}`);
      
      onProgress({
        currentPage: pageNum,
        totalPages: maxPages,
        currentArticle: 0,
        articlesDiscovered: seenIds.size,
        articlesScraped: allArticles.length,
        articlesFailed,
        status: 'running',
        message: `Scraping page ${pageNum} of ${maxPages}...`
      });
      
      // Navigate to the page with human-like behavior
      // Use /property-news/latest for page 1 (shows latest articles), then use search URL for pagination
      const url = pageNum === 1 
        ? `https://www.edgeprop.sg/property-news/latest`
        : `https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=${pageNum}&page_size=20&sort_by=posted_desc&category=`;
      console.log(`Navigating to: ${url}`);
      
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded', 
          timeout: 45000 
        });
      console.log(`✅ Navigation completed for page ${pageNum}`);
      
      // Enhanced Cloudflare detection and bypass - comprehensive approach
      let cloudflareResolved = false;
      for (let cfAttempt = 0; cfAttempt < 10 && !cloudflareResolved; cfAttempt++) {
        await page.waitForTimeout(Math.min(2000 + (cfAttempt * 1000), 8000)); // Progressive delay up to 8s
        
        const pageContent = await page.content().catch(() => '');
        const pageTitle = await page.title().catch(() => '');
        
        // Enhanced Cloudflare detection patterns - more specific to avoid false positives
        const isCloudflare = (pageContent.includes('cf-browser-verification') && pageContent.includes('Just a moment')) ||
          (pageContent.includes('checking-your-browser') && pageContent.includes('Cloudflare')) ||
          (pageTitle.includes('Just a moment') && pageTitle.includes('Cloudflare')) ||
          pageContent.includes('cf-challenge-running') ||
          pageContent.includes('Verifying you are human') ||
          (pageContent.includes('Please enable JavaScript') && pageContent.includes('Cloudflare')) ||
          page.url().includes('challenge-platform.cloudflare.com');

        if (!isCloudflare) {
          // Verify actual EdgeProp content is loaded
          const hasContent = await page.evaluate(() => {
            const contentIndicators = [
              document.querySelector('.jsx-4217446631.article-detail.left-section'),
              document.querySelector('.jsx-2128998887.detail-content'),
              document.querySelector('main article'),
              document.querySelector('[class*="article"]'),
              document.querySelector('[class*="content"]'),
              document.querySelector('h1'),
              document.querySelector('p')
            ];
            
            const hasValidContent = contentIndicators.some(el => el && el.textContent && el.textContent.trim().length > 50);
            const bodyText = document.body?.textContent || '';
            const hasSubstantialText = bodyText.length > 500;
            
            return hasValidContent && hasSubstantialText;
          });
          
          if (hasContent) {
            cloudflareResolved = true;
            console.log(`✅ Cloudflare resolved, content loaded (attempt ${cfAttempt + 1})`);
            break;
          }
        }

        if (isCloudflare) {
          console.log(`⚠️ Cloudflare detected (attempt ${cfAttempt + 1}/10), implementing comprehensive bypass...`);
          
          // Wait for Cloudflare challenge iframe to load (they load dynamically)
          await page.waitForTimeout(3000);
          
          try {
            // COMPREHENSIVE CLOUDFLARE BYPASS STRATEGY
            
            // Strategy 1: Handle Cloudflare iframes with enhanced detection
            const iframes = await page.$$('iframe');
            console.log(`   🔍 Checking ${iframes.length} iframe(s) for Cloudflare checkbox...`);
            
            let iframeSuccess = false;
            for (const iframe of iframes) {
              const src = await iframe.getAttribute('src').catch(() => '');
              const id = await iframe.getAttribute('id').catch(() => '');
              const className = await iframe.getAttribute('class').catch(() => '');
              
              // Enhanced Cloudflare iframe detection
              const isCloudflareIframe = src && (
                src.includes('challenges.cloudflare.com') ||
                src.includes('cf-challenge') ||
                src.includes('cloudflare')
              ) || (id && (
                id.includes('cf-chl') || 
                id.includes('cf-challenge') ||
                id.includes('challenge')
              )) || (className && (
                className.includes('cf-challenge') || 
                className.includes('cf-chl') ||
                className.includes('challenge')
              ));

              if (isCloudflareIframe || iframes.length === 1) { // If only one iframe, assume it's Cloudflare
                console.log(`   🎯 Processing potential Cloudflare iframe: ${src.substring(0, 50)}...`);
                
                try {
                  const frame = await iframe.contentFrame();
                  if (frame) {
                    // Wait for Cloudflare content to fully load
                    console.log(`   ⏳ Waiting for Cloudflare challenge content to load...`);
                    await page.waitForTimeout(4000);
                    
                    // Check frame content
                    const frameContent = await frame.evaluate(() => {
                      const text = document.body?.textContent || '';
                      const html = document.body?.innerHTML || '';
                      return {
                        text: text.substring(0, 200),
                        html: html.substring(0, 500),
                        checkboxes: Array.from(document.querySelectorAll('input[type="checkbox"]')).length,
                        labels: Array.from(document.querySelectorAll('label')).length,
                        buttons: Array.from(document.querySelectorAll('button')).length,
                        hasChallenge: text.toLowerCase().includes('verify') || text.toLowerCase().includes('human') || text.toLowerCase().includes('challenge')
                      };
                    });
                    
                    console.log(`   📊 Frame elements: ${frameContent.checkboxes} checkboxes, ${frameContent.labels} labels, ${frameContent.buttons} buttons`);
                    
                    // Enhanced checkbox detection and clicking
                    const checkboxSelectors = [
                      'input[type="checkbox"]',
                      'input[type="checkbox"]#challenge-form',
                      'input[id*="challenge"]',
                      'input[name*="challenge"]',
                      'input[class*="checkbox"]',
                      '#cf-challenge-checkbox',
                      '.cb-lb input[type="checkbox"]',
                      'label[for*="challenge"] input',
                      'label[for*="challenge"]',
                      '[role="checkbox"]',
                      '.checkbox',
                      '.challenge-checkbox'
                    ];

                    for (const selector of checkboxSelectors) {
                      try {
                        await frame.waitForSelector(selector, { timeout: 2000 });
                        const checkbox = await frame.$(selector);
                        if (checkbox) {
                          const isVisible = await checkbox.isVisible().catch(() => false);
                          const isEnabled = await checkbox.isEnabled().catch(() => true);
                          const boundingBox = await checkbox.boundingBox().catch(() => null);
                          
                          console.log(`   🎯 Found element: ${selector}, visible: ${isVisible}, enabled: ${isEnabled}, box: ${!!boundingBox}`);
                          
                          if (isVisible && isEnabled && boundingBox) {
                            // Scroll into view and wait
                            await checkbox.scrollIntoViewIfNeeded().catch(() => null);
                            await page.waitForTimeout(1000);
                            
                            console.log(`   ✅ Found checkbox in iframe with selector: ${selector}`);
                            await checkbox.click({ timeout: 5000, force: false });
                            await page.waitForTimeout(2000);
                            console.log(`   ✅ Clicked checkbox in iframe`);
                            iframeSuccess = true;
                            break;
                          }
                        }
                      } catch (selectorError: unknown) {
                        // Continue to next selector
                      }
                    }
                    
                    if (iframeSuccess) break;
                    
                    // Strategy 2: Try clicking any interactive element in the iframe
                    console.log(`   🔄 Trying alternative iframe interaction methods...`);
                    const clickables = await frame.$$('label, button, [role="button"], [onclick], .cf-button, [class*="challenge"], [class*="checkbox"]').catch(() => []);
                    
                    for (const clickable of clickables.slice(0, 3)) { // Limit to first 3
                      try {
                        const isVisible = await clickable.isVisible().catch(() => false);
                        if (isVisible) {
                          await clickable.scrollIntoViewIfNeeded().catch(() => null);
                          await clickable.click({ timeout: 3000 });
                          console.log(`   ✅ Clicked interactive element in iframe`);
                          await page.waitForTimeout(2000);
                          iframeSuccess = true;
                          break;
                        }
                      } catch (clickError: unknown) {
                        // Continue to next element
                      }
                    }
                    
                    if (iframeSuccess) break;
                  }
                } catch (frameError: unknown) {
                  console.log(`   ⚠️ Error accessing iframe: ${frameError instanceof Error ? frameError.message : 'Unknown error'}`);
                }
              }
            }
            
            // Strategy 3: Direct page Cloudflare elements (if iframe approach failed)
            if (!iframeSuccess) {
              console.log(`   🔄 Trying direct page Cloudflare elements...`);
              const cloudflareSelectors = [
                'input[type="checkbox"]',
                'label[for*="challenge"]',
                'button[id*="challenge"]',
                '#challenge-form input[type="checkbox"]',
                '.cf-turnstile input[type="checkbox"]',
                '.ctp-checkbox-label',
                'button[class*="challenge"]',
                'label[class*="checkbox"]',
                '[data-callback*="challenge"]',
                '.challenge-form input',
                '.cloudflare-challenge input'
              ];

              for (const selector of cloudflareSelectors) {
                try {
                  const element = await page.$(selector);
                  if (element) {
                    const isVisible = await element.isVisible().catch(() => false);
                    if (isVisible) {
                      console.log(`   ✅ Found Cloudflare element: ${selector}`);
                      await element.scrollIntoViewIfNeeded().catch(() => null);
                      await element.click({ timeout: 3000 });
                      console.log(`   ✅ Clicked Cloudflare verification`);
                      await page.waitForTimeout(3000);
                      break;
                    }
                  }
                } catch (directError: unknown) {
                  // Continue to next selector
                }
              }
            }
            
            // Strategy 4: Human-like behavior simulation
            console.log(`   🤖 Simulating human-like behavior...`);
            
            // Random mouse movements
            await page.mouse.move(Math.random() * 800 + 100, Math.random() * 600 + 100);
            await page.waitForTimeout(500);
            await page.mouse.move(Math.random() * 800 + 100, Math.random() * 600 + 100);
            
            // Random scrolling
            await page.evaluate(() => {
              window.scrollTo(0, Math.random() * 500);
            });
            await page.waitForTimeout(1000);
            
            // Try pressing space or enter (sometimes works for challenges)
            await page.keyboard.press('Space').catch(() => null);
            await page.waitForTimeout(500);
            await page.keyboard.press('Tab').catch(() => null);
            await page.waitForTimeout(500);
            await page.keyboard.press('Enter').catch(() => null);
            
          } catch (clickError: unknown) {
            console.log(`   ⚠️ Error in Cloudflare bypass: ${clickError instanceof Error ? clickError.message : 'Unknown error'}`);
          }
        }
      }
      
      if (!cloudflareResolved) {
        console.log('⚠️ Cloudflare challenge may persist after 10 attempts, but continuing...');
      }
      
        // Wait for content to load properly - longer wait for Cloudflare
        await page.waitForTimeout(4000 + Math.random() * 3000); // 4-7 seconds
        
        // Human-like scrolling behavior to trigger lazy loading
        const scrollSteps = [0, 300, 600, 900, 1200];
        for (const scrollPos of scrollSteps) {
          await page.evaluate((pos: number) => {
            window.scrollTo({ top: pos, behavior: 'smooth' });
          }, scrollPos);
          await page.waitForTimeout(800 + Math.random() * 400); // Random delays between scrolls
        }
        
        // Scroll back to top
        await page.evaluate(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        await page.waitForTimeout(1000);
        
        console.log(`Fast loading completed for page ${pageNum}`);
      } catch (error: unknown) {
        console.error(`Navigation failed for page ${pageNum}:`, error);
        articlesFailed++;
        continue;
      }
      
      // Extract articles from the page
      console.log('🔍 Starting article extraction...');
      const articles = await page.evaluate(() => {
        console.log('📄 Page title:', document.title);
        console.log('📄 Page URL:', window.location.href);
        
        // Check if Cloudflare challenge is blocking
        const cloudflareText = document.body?.textContent || '';
        if (cloudflareText.includes('Just a moment') || cloudflareText.includes('Checking your browser')) {
          console.log('⚠️ Cloudflare challenge detected!');
          return [];
        }
        
        console.log('🔍 Trying multiple selectors to find article links...');
        
        // Try multiple strategies to find article containers
        let articleContainers: Element[] = [];
        
        // Strategy 1: Look for any class containing "article"
        const articleClassContainers = Array.from(document.querySelectorAll('[class*="article"]'));
        console.log(`✅ Found ${articleClassContainers.length} containers with "article" in class`);
        
        // Strategy 2: Look for JSX containers (EdgeProp uses Next.js with JSX classes)
        const jsxContainers = Array.from(document.querySelectorAll('div[class*="jsx-"]'));
        console.log(`✅ Found ${jsxContainers.length} JSX containers`);
        
        // Strategy 3: Look for divs that contain article links and images
        const linkContainers = Array.from(document.querySelectorAll('div')).filter(div => {
          // Look for divs that contain an article link and an image, likely article cards
          const hasArticleLink = div.querySelector('a[href*="/property-news/"]:not([href*="/property-news-search"]):not([href*="/property-news/latest"]):not([href*="/property-news/news"]):not([href*="/property-news/in-depth"])');
          const hasImage = div.querySelector('img');
          const href = hasArticleLink?.getAttribute('href');
          // Only count if it's a proper article URL (not a category page)
          // Handle both relative and absolute URLs
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
        
        // Extract unique article hrefs from the containers (limit to 20 per page)
        const uniqueHrefs = new Map<string, any>();
        
        // Process all containers but only take first 20
        for (let index = 0; index < articleContainers.length && uniqueHrefs.size < 20; index++) {
          const container = articleContainers[index];
          
          // Find all article links in this container
          const allLinks = Array.from(container.querySelectorAll('a[href*="/property-news/"]'));
          const articleLinks = allLinks.filter(link => {
            const href = link.getAttribute('href') || '';
            // Filter out category pages, search pages, and non-article links
            // Handle both relative (/property-news/...) and absolute (https://www.edgeprop.sg/property-news/...) URLs
            const isRelativeUrl = href.startsWith('/property-news/');
            const isAbsoluteUrl = href.includes('edgeprop.sg/property-news/');
            const pathSegments = href.split('/').length;
            
            return (isRelativeUrl || isAbsoluteUrl) && 
                   !href.includes('/property-news-search') &&
                   !href.includes('/property-news/latest') &&
                   !href.includes('/property-news/news') &&
                   !href.includes('/property-news/in-depth') &&
                   !href.includes('/property-news/showcase') &&
                   !href.includes('/property-news/deal-watch') &&
                   !href.includes('/property-news/international') &&
                   !href.includes('/property-news/personality') &&
                   !href.includes('/property-news/mandarin') &&
                   // For relative URLs: ['', 'property-news', 'article-slug'] = 3 segments minimum
                   // For absolute URLs: ['https:', '', 'www.edgeprop.sg', 'property-news', 'article-slug'] = 5 segments minimum
                   ((isRelativeUrl && pathSegments >= 3) || (isAbsoluteUrl && pathSegments >= 5));
          });
          
          // Find the article href (prefer links with longer text content - those are usually the title links)
          let articleHref = '';
          let title = '';
          let category = '';
          let imgSrc = '';
          
          // Sort links by text length to prefer title links over category links
          const sortedLinks = articleLinks.sort((a, b) => (b.textContent?.trim().length || 0) - (a.textContent?.trim().length || 0));
          
          sortedLinks.forEach(link => {
            const href = link.getAttribute('href') || '';
            const text = link.textContent?.trim() || '';
            
            // Get the article href (first valid article link)
            if (href && !articleHref) {
              articleHref = href;
            }
            
            // Get category (short uppercase text like "PROPERTY NEWS", "PERSONALITY", etc.)
            if (['PROPERTY NEWS', 'DEAL WATCH', 'PERSONALITY', 'SPECIAL FEATURE', 'NEWS / IN DEPTH', 'NEWS / INTERNATIONAL'].includes(text)) {
              category = text;
            }
            
            // Get title (prefer longer text, but be flexible about length)
            if (text && text.length > 10 && !text.includes('EDGEPROP SINGAPORE') && !text.includes('PROPERTY NEWS') && !text.includes('PERSONALITY') && !text.includes('SPECIAL FEATURE')) {
              if (!title || text.length > title.length) {
                title = text;
              }
            }
          });
          
          // Fallback: if no title found from links, try to get it from h2, h3, or heading tags
          if (!title || title.length < 10) {
            const heading = container.querySelector('h2, h3, h4, [class*="title"], [class*="heading"], [class*="headline"]');
            if (heading) {
              const headingText = heading.textContent?.trim() || '';
              if (headingText && headingText.length > 5 && !headingText.includes('EDGEPROP SINGAPORE')) {
                title = headingText;
              }
            }
          }
          
          // Get image - try multiple sources
          const img = container.querySelector('img');
          if (img) {
            imgSrc = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
            // Make sure it's not a logo or icon
            if (imgSrc && (imgSrc.includes('logo') || imgSrc.includes('icon') || imgSrc.includes('avatar'))) {
              imgSrc = '';
            }
          }
          
          // Normalize href (remove domain if present, ensure leading slash)
          const normalizedHref = articleHref.replace(/^https?:\/\/www\.edgeprop\.sg/, '').replace(/^([^/])/, '/$1');
          
          // Additional fallback: try to extract title from the URL slug
          if (!title || title.length < 10) {
            const urlParts = normalizedHref.split('/');
            const slug = urlParts[urlParts.length - 1] || '';
            if (slug && slug.length > 10) {
              // Convert slug to readable title (replace hyphens with spaces, capitalize)
              title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            }
          }
          
          if (normalizedHref && normalizedHref.includes('/property-news/') && !uniqueHrefs.has(normalizedHref)) {
            uniqueHrefs.set(normalizedHref, {
              href: normalizedHref,
              title: title,
              category: category,
              imgSrc: imgSrc,
              index: index
            });
          }
        }
        
        const articleLinks = Array.from(uniqueHrefs.values());
        console.log(`📊 Found ${articleLinks.length} unique articles on page`);
        if (articleLinks.length === 0) {
          console.log('❌ No article links found! Checking page structure...');
          console.log('   Body HTML length:', document.body.innerHTML.length);
          console.log('   All links on page:', document.querySelectorAll('a').length);
        }
        
        const extracted: any[] = [];
        
        articleLinks.forEach((articleData, index) => {
          const { href, title, category, imgSrc } = articleData;
          
          console.log(`Article ${index}: "${title?.substring(0, 60)}..." -> ${href}`);
          
          if (href && title && title.length > 10) {
            // Get thumbnail URL
            let thumbnail = 'https://via.placeholder.com/300x200/4F46E5/FFFFFF?text=EdgeProp+News';
            if (imgSrc && !imgSrc.includes('placeholder') && !imgSrc.includes('logo')) {
              thumbnail = imgSrc.startsWith('http') ? imgSrc : `https://www.edgeprop.sg${imgSrc}`;
            }
            
              extracted.push({
                nid: `mcp-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
                title: title,
              path: href.replace(/^https?:\/\/www\.edgeprop\.sg/, ''),
                thumbnail: thumbnail,
                author: 'Unknown',
                created: new Date().toISOString(),
              category: category ? [category] : ['Property News'],
                description: title.substring(0, 200)
              });
            console.log(`✅ Added article: ${title.substring(0, 60)}...`);
          }
        });
        
        console.log(`Total articles extracted: ${extracted.length}`);
        // Ensure exactly 20 articles per page (no more, no less)
        const limitedExtracted = extracted.slice(0, 20);
        console.log(`Limited to exactly 20 articles: ${limitedExtracted.length}`);
        return limitedExtracted;
      });
      
      console.log(`Server: Found ${articles.length} articles on page ${pageNum}`);
      
      onProgress({
        currentPage: pageNum,
        totalPages: maxPages,
        currentArticle: 0,
        articlesDiscovered: seenIds.size + articles.length,
        articlesScraped: allArticles.length,
        articlesFailed,
        status: 'running',
        message: `Found ${articles.length} articles on page ${pageNum}, now scraping content...`
      });
      
          // Scrape articles found on the page (with optional limit)
          const articlesToScrape = maxArticles ? articles.slice(0, maxArticles) : articles;
        
        for (let i = 0; i < articlesToScrape.length; i++) {
          const article = articlesToScrape[i];
          
          if (seenIds.has(article.nid)) continue;
          seenIds.add(article.nid);
          
          onProgress({
            currentPage: pageNum,
            totalPages: maxPages,
            currentArticle: i + 1,
            articlesDiscovered: seenIds.size,
            articlesScraped: allArticles.length,
            articlesFailed,
            status: 'running',
            message: `Scraping article ${i + 1}/${articlesToScrape.length}: ${article.title.substring(0, 50)}...`
          });
          
          try {
            // Navigate to article page with enhanced Cloudflare handling
            // Fix URL construction - ensure no double slashes
            const cleanPath = article.path.startsWith('/') ? article.path : `/${article.path}`;
            const articleUrl = `https://www.edgeprop.sg${cleanPath}`;
            console.log(`🌐 Navigating to: ${articleUrl}`);
            
            // Set up automatic Cloudflare challenge handler using addLocatorHandler
            // This will automatically click the checkbox when it appears
            try {
              await page.addLocatorHandler(
                page.locator('text=/Just a moment|Verifying you are human|Checking your browser|Enable JavaScript and cookies/i'),
                async () => {
                  console.log(`   🔍 Cloudflare challenge detected, attempting auto-bypass...`);
                  // Try to find and click the checkbox
                  const checkbox = await page.locator('input[type="checkbox"]').first();
                  if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await checkbox.click({ timeout: 3000 });
                    console.log(`   ✅ Auto-clicked Cloudflare checkbox`);
                    await page.waitForTimeout(5000);
                  }
                }
              );
            } catch (e: unknown) {
              // Handler setup failed, continue with manual handling
              console.log(`   ⚠️ Could not set up auto-handler: ${e}`);
            }
            
            try {
              await page.goto(articleUrl, { 
                waitUntil: 'domcontentloaded', // Use domcontentloaded instead of networkidle for faster navigation
                timeout: 60000
              });
            console.log(`✅ Successfully navigated to: ${article.title}`);
            } catch (navError: unknown) {
              console.log(`⚠️ Navigation timeout (may be Cloudflare), waiting and retrying...`);
              await page.waitForTimeout(5000);
            }
            
            // Enhanced Cloudflare detection and wait - multiple attempts with progressive delays
            let cloudflareResolved = false;
            for (let cfAttempt = 0; cfAttempt < 8; cfAttempt++) {
              const pageContent = await page.content().catch(() => '');
              const pageTitle = await page.title().catch(() => '');
              const pageText = await page.textContent('body').catch(() => '') || '';
              
              // More specific Cloudflare detection for article pages
              const isCloudflare = (pageContent.includes('cf-browser-verification') && pageContent.includes('cloudflare')) || 
                                  (pageContent.includes('checking-your-browser') && pageContent.includes('cloudflare')) ||
                                  (pageTitle.includes('Just a moment') && pageTitle.includes('Cloudflare')) ||
                                  pageContent.includes('cf-challenge-running') ||
                                  page.url().includes('challenge-platform.cloudflare.com');
              
              if (!isCloudflare) {
                // Verify actual content is loaded with better selectors
                const hasArticle = await page.evaluate(() => {
                  // Try more specific selectors first
                  const selectors = [
                    'article .content',
                    '.article-content', 
                    '.post-content',
                    '.entry-content',
                    'article',
                    'main',
                    '.content-body',
                    '.article-body'
                  ];
                  
                  for (const selector of selectors) {
                    const el = document.querySelector(selector);
                    if (el && (el.textContent?.length || 0) > 500) {
                      return true;
                    }
                  }
                  
                  // Fallback: check if page has substantial text content
                  const bodyText = document.body?.textContent || '';
                  return bodyText.length > 2000;
                }).catch(() => false);
                
                if (hasArticle) {
                  cloudflareResolved = true;
                  console.log(`✅ Cloudflare resolved, content loaded (attempt ${cfAttempt + 1})`);
                  break;
                }
              }
              
              if (cfAttempt < 7) {
                console.log(`⚠️ Cloudflare detected (attempt ${cfAttempt + 1}/8), trying to click verify button...`);
                
                // Wait longer for Cloudflare challenge iframe to load (they load dynamically)
                await page.waitForTimeout(5000);
                
                // Debug: log all iframes on the page
                const allIframes = await page.evaluate(() => {
                  const iframes = Array.from(document.querySelectorAll('iframe'));
                  return iframes.map(iframe => ({
                    src: iframe.getAttribute('src') || '',
                    id: iframe.id || '',
                    className: iframe.className || '',
                    width: iframe.width || '',
                    height: iframe.height || ''
                  }));
                });
                if (allIframes.length > 0) {
                  console.log(`   🔍 Found ${allIframes.length} iframe(s)`);
                  allIframes.forEach((iframe: any, idx: number) => {
                    console.log(`      ${idx + 1}. src="${iframe.src?.substring(0, 100) || 'no-src'}", id="${iframe.id}", class="${iframe.className}"`);
                  });
                }
                
                // Try to find and click the Cloudflare checkbox/verify button
                let clicked = false;
                try {
                  // First, check for iframe (most common Cloudflare challenge)
                  const iframes = await page.$$('iframe');
                  console.log(`   🔍 Checking ${iframes.length} iframe(s) for Cloudflare checkbox...`);
                  
                  for (const iframe of iframes) {
                    try {
                      const src = await iframe.getAttribute('src').catch(() => '');
                      // Cloudflare iframes often don't have src or have empty src initially
                      const id = await iframe.getAttribute('id').catch(() => '');
                      const className = await iframe.getAttribute('class').catch(() => '');
                      
                      // Only check iframes that are actually Cloudflare-related
                      const isCloudflareIframe = src && (src.includes('challenges.cloudflare.com') || 
                                                          src.includes('cf-chl-bypass') ||
                                                          src.includes('cf-challenge')) ||
                                                  (id && (id.includes('cf-chl') || id.includes('cf-challenge'))) ||
                                                  (className && (className.includes('cf-challenge') || className.includes('cf-chl')));
                      
                      if (isCloudflareIframe) {
                        console.log(`   ✅ Checking iframe: src="${src}", id="${id}"`);
                        const frame = await iframe.contentFrame();
                        if (frame) {
                          // Wait longer for Cloudflare content to fully load
                          console.log(`   ⏳ Waiting for Cloudflare challenge content to load...`);
                          await frame.waitForTimeout(5000);
                          
                          // Check what's in the frame
                          const frameContent = await frame.evaluate(() => {
                            const body = document.body;
                            return {
                              html: body.innerHTML.substring(0, 500),
                              text: body.textContent?.substring(0, 200) || '',
                              checkboxes: Array.from(document.querySelectorAll('input[type="checkbox"]')).length,
                              labels: Array.from(document.querySelectorAll('label')).length,
                              buttons: Array.from(document.querySelectorAll('button')).length
                            };
                          }).catch(() => null);
                          
                          if (frameContent) {
                            console.log(`   📄 Frame content preview: ${frameContent.text}`);
                            console.log(`   📊 Frame elements: ${frameContent.checkboxes} checkboxes, ${frameContent.labels} labels, ${frameContent.buttons} buttons`);
                          }
                          
                          // Try multiple approaches to find and click checkbox - wait longer for each
                          const checkboxSelectors = [
                            'input[type="checkbox"]',
                            'input[type="checkbox"]#challenge-form',
                            'input[id*="challenge"]',
                            'input[name*="challenge"]',
                            'input[class*="checkbox"]',
                            '#cf-challenge-checkbox',
                            '.cb-lb input',
                            '.cb-lb',
                            'label[for*="challenge"] input',
                            'label[for*="challenge"]'
                          ];
                          
                          for (const selector of checkboxSelectors) {
                            try {
                              console.log(`   🔍 Trying selector: ${selector}`);
                              await frame.waitForSelector(selector, { timeout: 5000, state: 'visible' }).catch(() => null);
                              const checkbox = await frame.$(selector);
                              if (checkbox) {
                                const isVisible = await checkbox.isVisible().catch(() => false);
                                const isEnabled = await checkbox.isEnabled().catch(() => true);
                                const boundingBox = await checkbox.boundingBox().catch(() => null);
                                console.log(`   📍 Element found: visible=${isVisible}, enabled=${isEnabled}, hasBox=${!!boundingBox}`);
                                
                                if ((isVisible || boundingBox) && isEnabled) {
                                  // Scroll into view first
                                  await checkbox.scrollIntoViewIfNeeded().catch(() => null);
                                  await frame.waitForTimeout(1000);
                                  
                                  console.log(`   ✅ Found checkbox in iframe with selector: ${selector}`);
                                  await checkbox.click({ timeout: 5000, force: false });
                                  clicked = true;
                                  console.log(`   ✅ Clicked checkbox in iframe`);
                                  await page.waitForTimeout(10000); // Wait longer for verification
                                  break;
                                }
                              }
              } catch (e: unknown) {
                              console.log(`   ⚠️ Selector ${selector} failed: ${e}`);
                              // Try next selector
                            }
                          }
                          
                          // If checkbox not found, try clicking any clickable/interactive element in iframe
                          if (!clicked) {
                            try {
                              console.log(`   🔍 Trying to find any clickable element...`);
                              const clickables = await frame.$$('label, button, [role="button"], [onclick], .cf-button, [class*="challenge"]').catch(() => []);
                              for (const clickable of clickables) {
                                try {
                                  const isVisible = await clickable.isVisible().catch(() => false);
                                  const tagName = await clickable.evaluate((el: any) => el.tagName).catch(() => '');
                                  if (isVisible) {
                                    console.log(`   ✅ Trying to click ${tagName} element...`);
                                    await clickable.scrollIntoViewIfNeeded().catch(() => null);
                                    await frame.waitForTimeout(500);
                                    await clickable.click({ timeout: 3000, force: false });
                                    clicked = true;
                                    console.log(`   ✅ Clicked element in iframe`);
                                    await page.waitForTimeout(10000);
                                    break;
                                  }
            } catch (e: unknown) {
                                  // Try next element
                                }
                              }
                            } catch (e: unknown) {
              console.log(`   ⚠️ Could not click any element: ${e}`);
                            }
                          }
                          
                          if (clicked) break;
                        }
                      }
                    } catch (e: unknown) {
                      console.log(`   ⚠️ Error checking iframe: ${e}`);
                      // Continue to next iframe
                    }
                  }
                  
                  // If no iframe checkbox found, try direct page elements
                  if (!clicked) {
                    const cloudflareSelectors = [
                      'input[type="checkbox"]',
                      'label[for*="challenge"]',
                      '.cb-lb',
                      '#challenge-form input[type="checkbox"]',
                      'label[for*="cf-"]',
                      '.ctp-checkbox-label',
                      '[data-ray]',
                      'label[class*="checkbox"]'
                    ];
                    
                    for (const selector of cloudflareSelectors) {
                      try {
                        await page.waitForSelector(selector, { timeout: 2000 }).catch(() => null);
                        const element = await page.$(selector);
                        if (element) {
                          const isVisible = await element.isVisible().catch(() => false);
                          if (isVisible) {
                            console.log(`   ✅ Found Cloudflare element: ${selector}`);
                            await element.click({ timeout: 3000 });
                            clicked = true;
                            console.log(`   ✅ Clicked Cloudflare verification`);
                            await page.waitForTimeout(5000); // Wait for verification to process
                            break;
                          }
                        }
                      } catch (e: unknown) {
                        // Try next selector
                      }
                    }
                  }
                  
                  // If we clicked, wait longer for verification to complete
                  if (clicked) {
                    await page.waitForTimeout(8000);
                  } else {
                    console.log(`   ⚠️ Could not find Cloudflare checkbox, using fallback...`);
                    // Human-like behavior: random scrolling
                    await page.evaluate(() => {
                      const scrollAmount = Math.random() * 1000 + 200;
                      window.scrollTo({ top: scrollAmount, behavior: 'smooth' });
                    });
                    
                    // Progressive wait times: 5s, 7s, 9s, 11s, 13s, 15s, 17s
                    const waitTime = 5000 + (cfAttempt * 2000);
                    await page.waitForTimeout(waitTime);
                    
                    // Scroll back to top
                    await page.evaluate(() => {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    });
                    await page.waitForTimeout(1000);
                  }
                  
                  // Try reloading on later attempts if not clicked
                  if (!clicked && cfAttempt >= 3) {
                    console.log(`   🔄 Reloading page...`);
                    try {
                      await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
                      await page.waitForTimeout(2000);
            } catch (e: any) {
                      // Ignore reload errors
                    }
                  }
                } catch (clickError: any) {
                  console.log(`   ⚠️ Error clicking Cloudflare element: ${clickError}`);
                  await page.waitForTimeout(5000 + (cfAttempt * 2000));
                }
              } else {
                console.log(`❌ Cloudflare challenge persists after ${cfAttempt + 1} attempts, skipping article`);
                articlesFailed++;
                onProgress({
                  currentPage: pageNum,
                  totalPages: maxPages,
                  currentArticle: i + 1,
                  articlesDiscovered: articles.length,
                  articlesScraped: allArticles.length,
                  articlesFailed: articlesFailed,
                  status: 'running',
                  message: `Cloudflare challenge: ${article.title}`
                });
                continue; // Skip this article - exit the try block
              }
            }
            
            if (!cloudflareResolved) {
              // This shouldn't happen due to continue above, but just in case
              console.log(`⚠️ Could not resolve Cloudflare, skipping article`);
              articlesFailed++;
              onProgress({
                currentPage: pageNum,
                totalPages: maxPages,
                currentArticle: i + 1,
                articlesDiscovered: articles.length,
                articlesScraped: allArticles.length,
                articlesFailed: articlesFailed,
                status: 'running',
                message: `Cloudflare unresolved: ${article.title}`
              });
              continue;
            }
            
            // Final wait for content to stabilize
            await page.waitForTimeout(3000);
            
            // Extract metadata AND content together
            console.log(`📊 Extracting content from: ${article.title}`);
            console.log(`🔍 About to run page.evaluate() for extraction...`);
            
            // Wait for content container to exist before extracting
            try {
              await page.waitForSelector('.jsx-2128998887.detail-content, .jsx-4217446631, main article, article', { timeout: 5000 });
              console.log(`✅ Content container found`);
              
              // Wait a bit more for images to load (lazy loading)
              await page.waitForTimeout(2000);
              
              // Scroll to trigger lazy-loaded images
              await page.evaluate(() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              });
              await page.waitForTimeout(1000);
              await page.evaluate(() => {
                window.scrollTo({ top: 500, behavior: 'smooth' });
              });
              await page.waitForTimeout(1000);
            } catch (e: unknown) {
              console.log(`⚠️ Content container not found, proceeding anyway...`);
            }
            
            const articleData = await page.evaluate((articleTitle: string) => {
              // FIRST: EdgeProp's JavaScript tries to call __name() as a function, so provide a no-op function
              try {
                if (typeof (window as any).__name === 'undefined') {
                  (window as any).__name = function() { return ''; };
                }
              } catch (e: any) {
                // Ignore if we can't set it
              }
              


              // Isolate from page's JavaScript by using IIFE and catch errors
              try {
                // Already handled __name workaround at the top
              } catch (e: any) {
                // Ignore if we can't set it
              }
              
              return (function(articleTitle) {
                // Helper function to clean paragraphs (inline, browser-safe) - defined at IIFE scope
                const cleanParagraphs = (rawParagraphs: string[]): string[] => {
                  return rawParagraphs
                    .map(p => p.trim())
                    .filter(text => {
                      // Basic validation
                      if (!text || typeof text !== 'string') return false;
                      
                      // Basic length check - reduced threshold for better content capture
                      if (text.length < 15) return false;
                      
                      // Skip very short paragraphs (less than 3 words)
                      const wordCount = text.split(/\s+/).length;
                      if (wordCount < 3) {
                        return false;
                      }
                      
                      const lower = text.toLowerCase();
                      
                      // Skip obvious non-content (but be less aggressive)
                      const skipPatterns = [
                        /^(subscribe|login|register|sign up|sign in)$/i,
                        /^(home|news|property|search)$/i,
                        /^(follow us|contact us|about us)$/i,
                        /^(privacy policy|terms of service|cookie policy)$/i,
                        /^(advertisement|sponsored|promoted)$/i,
                        /^(read more|view more|see more|load more)$/i,
                        /^(share|like|comment|tweet)$/i,
                        /^(next|previous|back|continue)$/i,
                        /^(menu|navigation|sidebar|footer)$/i,
                        /^(copyright|all rights reserved)$/i,
                        /^(loading|please wait)$/i,
                        /^(error|not found|404)$/i,
                        /^(javascript|enable javascript)$/i,
                        /^(cookies|accept cookies)$/i,
                        /^(newsletter|subscribe to)$/i,
                        /^(related articles|you may also like)$/i,
                        /^(tags?:|categories?:|filed under)$/i,
                        /^(posted by|written by|author:)$/i,
                        /^(published on|updated on|last modified)$/i,
                        /^(share this|print this|email this)$/i,
                        /^(comments?|leave a comment|add comment)$/i,
                        /^(social media|follow|connect)$/i,
                        /^(download|pdf|print version)$/i,
                        /^(mobile app|get the app)$/i,
                        /^(weather|traffic|stock)$/i,
                        /^(trending|popular|most read)$/i,
                        /^(advertisement|ad|sponsored content)$/i
                      ];
                      
                      for (const pattern of skipPatterns) {
                        if (pattern.test(text)) {
                          return false;
                        }
                      }
                      
                      // Skip if it's mostly numbers or symbols
                      const alphaCount = (text.match(/[a-zA-Z]/g) || []).length;
                      if (alphaCount < text.length * 0.5) {
                        return false;
                      }
                      
                      // Skip if it's too similar to the article title (avoid duplication)
                      if (articleTitle && text.length > 10) {
                        const titleWords = articleTitle.toLowerCase().split(/\s+/);
                        const textWords = text.toLowerCase().split(/\s+/);
                        const commonWords = titleWords.filter(word => textWords.includes(word));
                        if (commonWords.length > titleWords.length * 0.7) {
                          return false;
                        }
                      }
                      
                      // Skip if it looks like JavaScript code
                      if (text.includes('function(') || text.includes('var ') || text.includes('const ') || 
                          text.includes('let ') || text.includes('return ') || text.includes('console.')) {
                        return false;
                      }
                      
                      // Skip common footer/sidebar content
                      if (lower.includes('edgeprop') && (lower.includes('subscribe') || lower.includes('follow') || lower.includes('newsletter'))) {
                        return false;
                      }
                      
                      // Skip EdgeProp specific patterns
                      if (lower.includes('edgeprop singapore') || 
                          lower.includes('edgeprop.sg') ||
                          lower.includes('contact agents') ||
                          lower.includes('clear all')) {
                        return false;
                      }
                      
                      return true;
                    });
                    // Removed .slice(0, 50) limit to get ALL paragraphs
                };

                // Declare ALL variables at function scope so they're accessible in catch block
                let extractionSuccess = false;
                let paragraphs: string[] = [];
                let textContent = '';
                let contentContainer: Element | null = null;
                let usedSelector = '';
                let author = 'EdgeProp Staff';
                let publishedDate = '';
                let categories: string[] = [];
                let links: Array<{text: string; url: string; type: 'internal' | 'external'}> = [];
                const images: Array<{url: string; alt?: string; caption?: string}> = [];
                let mainImageUrl = '';
                let mainImageCaption = '';
                let tags: string[] = [];
                let htmlContent = '';
                let wordCount = 0;
                let readingTime = 0;
                let description = '';
                
                // Additional isolation: wrap in try-catch to handle any remaining errors
                try {
              console.log(`   - Using title: ${articleTitle}`); // For debugging
              console.log('🔍 Starting article data extraction...');
              
              // Mark as success as soon as we have paragraphs
              const checkSuccess = () => {
                if (paragraphs.length > 0 && textContent.length > 100) {
                  extractionSuccess = true;
                }
              };

              // Find the main article content area - use EdgeProp specific selectors
              const articleSelectors = [
                '.jsx-4217446631.article-detail.left-section', // Main article container
                '.jsx-2128998887.detail-content', // Article content area
                '.jsx-4217446631', // Article container
                '.jsx-2128998887', // Content wrapper
                'main article', // Semantic article in main
                'article', // Fallback article tag
                'main > div > div:first-child', // Fallback structure
                'main', // Main content
                '[class*="article-content"]',
                '[class*="post-content"]',
                '[class*="content"]'
              ];
              for (const selector of articleSelectors) {
                try {
                  const element = document.querySelector(selector);
                  if (element) {
                    contentContainer = element;
                    usedSelector = selector;
                    console.log(`✅ Using selector: ${selector}`);
                    console.log(`   Element has ${element.textContent?.length || 0} characters`);
                    break;
                  }
                } catch (e: any) {
                  console.log(`❌ Selector failed: ${selector}`);
                }
              }
              
              // Fallback to body but be more selective
              if (!contentContainer) {
                contentContainer = document.body;
                usedSelector = 'document.body';
                console.log(`⚠️ Using document.body as fallback content container`);
                console.log(`   Body has ${document.body.textContent?.length || 0} characters`);
              } else {
                console.log(`✅ Using targeted content container: ${contentContainer.tagName} (${usedSelector})`);
              }
              
              // Extract metadata from article page (variables already declared at function scope)
              
              // Try to find author using multiple approaches
              
              // First: Check if we're on a Cloudflare protection page
              const isCloudflareProtection = document.body.textContent?.includes('Verify you are human') ||
                                           document.body.textContent?.includes('Cloudflare') ||
                                           document.querySelector('[data-cf-beacon]') ||
                                           document.querySelector('.cf-browser-verification') ||
                                           document.title?.toLowerCase().includes('cloudflare') ||
                                           document.body.textContent?.includes('Just a moment');
              
              if (isCloudflareProtection) {
                console.log('⚠️ Detected Cloudflare protection page - skipping author extraction');
                author = 'EdgeProp Staff'; // Safe fallback for Cloudflare pages
              } else {
                // Method 1: Look for meta tag
                const metaAuthor = document.querySelector('meta[name="author"]');
                if (metaAuthor) {
                  const metaValue = metaAuthor.getAttribute('content');
                  if (metaValue && metaValue.trim() && !metaValue.toLowerCase().includes('edgeprop')) {
                    author = metaValue.trim();
                    console.log(`Found author from meta tag: ${author}`);
                  }
                }
                
                // Method 1.5: Try additional meta tags
                if (author === 'EdgeProp Staff') {
                  const additionalMetaTags = document.querySelectorAll('meta[property="author"], meta[name="article:author"], meta[property="article:author"]');
                  for (const metaTag of additionalMetaTags) {
                    const metaValue = metaTag.getAttribute('content');
                    if (metaValue && metaValue.trim() && !metaValue.toLowerCase().includes('edgeprop')) {
                      author = metaValue.trim();
                      console.log(`Found author from additional meta tag: ${author}`);
                      break;
                    }
                  }
                }
                
                // Method 1.6: Look for JSON-LD structured data
                if (author === 'EdgeProp Staff') {
                  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
                  for (const script of jsonLdScripts) {
                    try {
                      const data = JSON.parse(script.textContent || '');
                      if (data.author) {
                        const authorName = typeof data.author === 'string' ? data.author : 
                                         data.author.name || data.author['@name'] || '';
                        if (authorName && authorName.trim() && !authorName.toLowerCase().includes('edgeprop')) {
                          author = authorName.trim();
                          console.log(`Found author from JSON-LD: ${author}`);
                          break;
                        }
                      }
                    } catch (e: any) {
                      // Ignore JSON parsing errors
                    }
                  }
                }
              }
              
              // Method 2: Look for specific EdgeProp author patterns in different sections
              if (author === 'EdgeProp Staff') {
                const pageText = document.body.textContent || '';
                
                // Try different patterns in order of preference
                const patterns = [
                  // Pattern 1: "By Author Name / EdgeProp Singapore" (most reliable)
                  /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:and|&)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)?)\s*\/\s*EdgeProp Singapore/i,
                  // Pattern 2: "By EdgeProp Singapore / EdgeProp Singapore" (staff writer)
                  /By\s+EdgeProp Singapore\s*\/\s*EdgeProp Singapore/i,
                  // Pattern 3: "Author Name / EdgeProp Singapore" (without By, but more strict)
                  /(?<![\w\s])([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\/\s*EdgeProp Singapore/i,
                  // Pattern 4: "By Author Name" (simple fallback)
                  /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s|$)/i
                ];
                
                // Search in different sections of the page
                const searchSections = [
                  pageText.substring(0, 5000),      // First 5000 chars
                  pageText.substring(5000, 10000),  // Next 5000 chars  
                  pageText.substring(10000, 20000), // Next 10000 chars
                  pageText                          // Full text as last resort
                ];
                
                for (const pattern of patterns) {
                  for (const section of searchSections) {
                    const match = section.match(pattern);
                    if (match) {
                      // Handle EdgeProp staff writer case
                      if (pattern === patterns[1]) { // "By EdgeProp Singapore / EdgeProp Singapore"
                        author = 'EdgeProp Singapore';
                        console.log(`Found EdgeProp staff writer: ${author}`);
                        break;
                      }
                      
                      // Handle individual author case
                      if (match[1]) {
                        const candidateAuthor = match[1].trim();
                        
                        // Enhanced validation for author names
                        if (candidateAuthor &&
                            candidateAuthor.length > 3 &&
                            candidateAuthor.length < 50 &&
                            /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(candidateAuthor) &&
                            !candidateAuthor.toLowerCase().includes('edgeprop') &&
                            !candidateAuthor.toLowerCase().includes('staff') &&
                            !candidateAuthor.toLowerCase().includes('news') &&
                            !candidateAuthor.toLowerCase().includes('amenities') &&
                            !candidateAuthor.toLowerCase().includes('market') &&
                            !candidateAuthor.toLowerCase().includes('watch') &&
                            !candidateAuthor.toLowerCase().includes('psf') &&
                            !candidateAuthor.toLowerCase().includes('singapore') &&
                            !candidateAuthor.toLowerCase().includes('worldwide') &&
                            !candidateAuthor.toLowerCase().includes('hotels') &&
                            !candidateAuthor.toLowerCase().includes('wyndham') &&
                            !candidateAuthor.toLowerCase().includes('novena') &&
                            !candidateAuthor.toLowerCase().includes('cloudflare') &&
                            !candidateAuthor.toLowerCase().includes('verify') &&
                            !candidateAuthor.toLowerCase().includes('human') &&
                            !candidateAuthor.toLowerCase().includes('moment') &&
                            !candidateAuthor.toLowerCase().includes('protection') &&
                            !candidateAuthor.toLowerCase().includes('security') &&
                            !candidateAuthor.toLowerCase().includes('browser') &&
                            !candidateAuthor.toLowerCase().includes('javascript') &&
                            !/^(the|and|or|but|for|with|from|about|into|through|during|before|after|above|below|up|down|out|off|over|under|again|further|then|once)$/i.test(candidateAuthor)) {
                          author = candidateAuthor;
                          console.log(`Found author from pattern: ${author}`);
                          break;
                        }
                      }
                    }
                  }
                  if (author !== 'EdgeProp Staff') break;
                }
              }
              
              // Method 3: Look in main content area specifically
              if (author === 'EdgeProp Staff') {
                const mainContent = document.querySelector('.main-content') || 
                                   document.querySelector('[class*="news"]') ||
                                   document.querySelector('main');
                
                if (mainContent) {
                  const contentText = mainContent.textContent || '';
                  
                  // Look for author patterns in main content only
                  const contentPatterns = [
                    /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:and|&)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)?)\s*\/\s*EdgeProp Singapore/i,
                    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\/\s*EdgeProp Singapore/i,
                    /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
                  ];
                  
                  for (const pattern of contentPatterns) {
                    const match = contentText.match(pattern);
                    if (match && match[1]) {
                      const candidateAuthor = match[1].trim();
                      
                      if (candidateAuthor &&
                          candidateAuthor.length > 3 &&
                          candidateAuthor.length < 50 &&
                          /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(candidateAuthor) &&
                          !candidateAuthor.toLowerCase().includes('edgeprop') &&
                          !candidateAuthor.toLowerCase().includes('staff') &&
                          !candidateAuthor.toLowerCase().includes('news')) {
                        author = candidateAuthor;
                        console.log(`Found author from main content: ${author}`);
                      break;
                      }
                    }
                  }
                }
              }
              
              // Method 4: Try JSON-LD structured data
              if (author === 'EdgeProp Staff') {
                const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (const script of jsonLdScripts) {
                  try {
                    const data = JSON.parse(script.textContent || '');
                    if (data.author) {
                      let authorName = '';
                      if (typeof data.author === 'string') {
                        authorName = data.author;
                      } else if (data.author.name) {
                        authorName = data.author.name;
                      }
                      
                      if (authorName && 
                          authorName.length > 3 && 
                          authorName.length < 50 &&
                          !authorName.toLowerCase().includes('edgeprop') &&
                          !authorName.toLowerCase().includes('staff') &&
                          !authorName.toLowerCase().includes('cloudflare')) {
                        author = authorName.trim();
                        console.log(`Found author from JSON-LD: ${author}`);
                        break;
                      }
                    }
                  } catch (e: any) {
                    // Ignore JSON parsing errors
                  }
                }
              }
              
              // Method 5: Try byline selectors
              if (author === 'EdgeProp Staff') {
                const bylineSelectors = [
                  '.byline',
                  '.author-name',
                  '.article-author',
                  '.post-author',
                  '[class*="byline"]',
                  '[class*="author"]',
                  '.writer',
                  '.journalist'
                ];
                
                for (const selector of bylineSelectors) {
                  const element = document.querySelector(selector);
                  if (element) {
                    const text = element.textContent?.trim();
                    if (text && 
                        text.length > 3 && 
                        text.length < 50 &&
                        /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(text) &&
                        !text.toLowerCase().includes('edgeprop') &&
                        !text.toLowerCase().includes('staff') &&
                        !text.toLowerCase().includes('cloudflare')) {
                      author = text;
                      console.log(`Found author from byline selector: ${author}`);
                      break;
                    }
                  }
                }
              }
              
              console.log(`Final author determined: ${author}`);
              
              // Try to find published date
              const dateElement = document.querySelector('time, [class*="date"], [class*="published"], meta[property="article:published_time"]');
              if (dateElement) {
                publishedDate = dateElement.getAttribute('datetime') || 
                                dateElement.getAttribute('content') || 
                                dateElement.textContent?.trim() || '';
              }
              
              // Try to find categories/tags - improved extraction
              const categoryElements = document.querySelectorAll('[class*="category"], [class*="tag"], meta[property="article:section"], a[href*="field_tags_tid"]');
              const rawCategories = Array.from(categoryElements).map(el => 
                el.getAttribute('content') || el.textContent?.trim()
              ).filter(Boolean);
              
              // Clean and deduplicate categories
              categories = [...new Set(rawCategories)]
                .filter(cat => cat && cat.length > 0 && cat.length < 100)
                .map(cat => cat.trim())
                .filter(cat => !cat.toLowerCase().includes('tags:') && 
                               !cat.toLowerCase().includes('property news') ||
                               cat.toLowerCase() === 'property news');
              
              if (categories.length === 0) {
                categories = ['Property News'];
              }
              
              // Extract text content and paragraphs using improved content parser
              // (paragraphs and textContent already declared above)
              
              // Method 1: Extract from paragraph tags and div elements (EdgeProp uses divs)
              // Focus on the main content area - exclude headers, nav, footers
              // Try to find the actual article body content area first
              let mainContentArea = contentContainer;
              
              // Look for specific EdgeProp content containers
              const contentAreaSelectors = [
                '.jsx-2128998887.detail-content',
                '.jsx-4217446631.article-detail',
                '[class*="detail-content"]',
                '[class*="article-content"]',
                'article > div',
                'main > article > div'
              ];
              
              for (const selector of contentAreaSelectors) {
                const area = contentContainer.querySelector(selector);
                if (area && area.textContent && area.textContent.length > 500) {
                  mainContentArea = area;
                  console.log(`✅ Using content area: ${selector}`);
                  break;
                }
              }
              
              // First try semantic tags from main content area
              let paragraphElements = Array.from(mainContentArea.querySelectorAll('p'));
              
              // If not enough, also try divs that are likely content paragraphs
              if (paragraphElements.length < 5) {
                const articleDivs = Array.from(mainContentArea.querySelectorAll('div')).filter(el => {
                const text = el.textContent || '';
                  // More strict: must be substantial content, not navigation/ads
                  return text.length > 100 && 
                         text.split(/\s+/).length > 10 &&
                       !el.querySelector('div div div') && // Not deeply nested containers
                       !el.querySelector('button, input, script, style, iframe') &&
                       !text.toLowerCase().includes('subscribe') &&
                       !text.toLowerCase().includes('follow us') &&
                         !text.toLowerCase().includes('www.edgeprop') &&
                         !text.toLowerCase().includes('cookie') &&
                         !text.toLowerCase().includes('read also') &&
                         el.children.length <= 8; // Can have some inline children
                });
              paragraphElements = paragraphElements.concat(articleDivs as any);
              }
              
              console.log(`Found ${paragraphElements.length} paragraph elements from main content area`);
              
              if (paragraphElements.length > 0) {
                const rawParagraphs = paragraphElements
                  .map(el => el.textContent?.trim())
                  .filter(text => {
                    // Filter out obvious non-content
                    if (!text || text.length < 20) return false;
                    const lower = text.toLowerCase();
                    return !lower.includes('www.edgeprop') &&
                           !lower.includes('subscribe') &&
                           !lower.includes('cookie') &&
                           !lower.startsWith('http');
                  });
                
                console.log(`Raw paragraphs after filtering non-content: ${rawParagraphs.length}`);
                
                console.log(`Raw paragraphs after initial filter: ${rawParagraphs.length}`);
                if (rawParagraphs.length > 0) {
                  console.log(`First raw paragraph: "${rawParagraphs[0]?.substring(0, 150)}..."`);
                }
                
                // Try cleanParagraphs first
                paragraphs = cleanParagraphs(rawParagraphs);
                console.log(`🔍 After cleanParagraphs: ${paragraphs.length} paragraphs from ${rawParagraphs.length} raw`);
                if (paragraphs.length === 0 && rawParagraphs.length > 0) {
                  console.log(`⚠️ DEBUG: cleanParagraphs filtered all ${rawParagraphs.length} paragraphs`);
                  console.log(`   First raw was: "${rawParagraphs[0]?.substring(0, 80)}..."`);
                }
                
                // If cleanParagraphs filtered everything, use raw with minimal filter
                if (paragraphs.length === 0 && rawParagraphs.length > 0) {
                  console.log(`⚠️ All paragraphs filtered by cleanParagraphs, using raw with minimal filter`);
                  paragraphs = rawParagraphs.filter(p => {
                    if (!p || p.length < 20) return false; // At least 20 chars
                    const lower = p.toLowerCase();
                    // Only filter out obvious non-content
                    return !lower.includes('subscribe') && 
                           !lower.includes('follow us') && 
                           !lower.includes('cookie policy') &&
                           !lower.includes('read also:') &&
                           !lower.startsWith('http') &&
                           !lower.startsWith('www.');
                  });
                  console.log(`Minimal filter result: ${paragraphs.length} paragraphs`);
                  if (paragraphs.length > 0) {
                    console.log(`First minimal filtered paragraph: "${paragraphs[0].substring(0, 150)}..."`);
                  }
                }
                
                // If STILL nothing, accept all raw paragraphs (last resort)
                if (paragraphs.length === 0 && rawParagraphs.length > 0) {
                  console.log(`⚠️ Even minimal filter removed everything, accepting all raw paragraphs`);
                  paragraphs = rawParagraphs.filter(p => p && p.length >= 20);
                  console.log(`Last resort: ${paragraphs.length} paragraphs`);
                  if (paragraphs.length > 0) {
                    console.log(`First last resort paragraph: "${paragraphs[0].substring(0, 150)}..."`);
                  }
                }
                
                // DEBUG: Log why paragraphs might be empty
                if (paragraphs.length === 0 && rawParagraphs.length > 0) {
                  console.log(`❌ DEBUG: Why paragraphs empty?`);
                  console.log(`   Raw paragraphs: ${rawParagraphs.length}`);
                  console.log(`   Raw[0] length: ${rawParagraphs[0]?.length || 0}`);
                  console.log(`   Raw[0] preview: "${rawParagraphs[0]?.substring(0, 100) || ''}"`);
                }
                
                // If still nothing, extract from full text
                if (paragraphs.length === 0 && contentContainer) {
                  console.log(`⚠️ Still no paragraphs, extracting from full text`);
                  const allText = contentContainer.textContent || '';
                  if (allText.length > 200) {
                    const sentences = allText.split(/[.!?]\s+/)
                      .map(s => s.trim())
                      .filter(s => s.length > 30 && 
                                   !s.toLowerCase().includes('subscribe') &&
                                   !s.toLowerCase().includes('cookie') &&
                                   !s.toLowerCase().includes('edgeprop singapore'));
                    
                    // Group sentences into paragraphs (3-5 sentences each)
                    for (let i = 0; i < sentences.length; i += 4) {
                      const para = sentences.slice(i, i + 4).join('. ');
                      if (para.length > 50) {
                        paragraphs.push(para + '.');
                      }
                    }
                    console.log(`Extracted ${paragraphs.length} paragraphs from full text`);
                  }
                }
                
                // Check if we hit Cloudflare challenge page
                const firstParaText = rawParagraphs.length > 0 ? rawParagraphs[0].toLowerCase() : '';
                const isCloudflarePage = firstParaText.includes('verifying you are human') ||
                                        firstParaText.includes('checking your browser') ||
                                        firstParaText.includes('just a moment');
                
                if (isCloudflarePage) {
                  console.log(`❌ Cloudflare challenge page detected - cannot extract content`);
                  extractionSuccess = false;
                  textContent = '';
                  paragraphs = [];
                } else {
                  // FINAL CHECK: Ensure we have paragraphs before proceeding
                  if (paragraphs.length === 0 && rawParagraphs.length > 0) {
                    // ULTIMATE FALLBACK: Use raw paragraphs with absolute minimum filtering
                    console.log(`⚠️ ULTIMATE FALLBACK: All filtering removed paragraphs, using raw paragraphs (length >= 20 only)`);
                    paragraphs = rawParagraphs.filter(p => p && p.trim().length >= 20);
                    console.log(`Ultimate fallback result: ${paragraphs.length} paragraphs from ${rawParagraphs.length} raw`);
                  }
                }
                
                if (paragraphs.length > 0) {
                  textContent = paragraphs.join('\n\n');
                  extractionSuccess = true;
                  console.log(`✅ Generated textContent: ${textContent.length} chars from ${paragraphs.length} paragraphs`);
                  checkSuccess(); // Make sure extractionSuccess is set
                } else {
                  console.log(`❌ Failed to extract any paragraphs after all attempts`);
                  console.log(`   Raw paragraphs count: ${rawParagraphs.length}`);
                  if (rawParagraphs.length > 0) {
                    console.log(`   First raw paragraph length: ${rawParagraphs[0]?.length || 0}`);
                    console.log(`   First raw paragraph: "${rawParagraphs[0]?.substring(0, 100)}..."`);
                  }
                  console.log(`   Content container text length: ${contentContainer?.textContent?.length || 0}`);
                  extractionSuccess = false;
                  textContent = '';
                  paragraphs = [];
                }
              } else {
                console.log(`⚠️ No paragraphElements found (${paragraphElements.length})`);
              }
              
              // Method 2: If we don't have enough paragraphs, also try div elements
              // EdgeProp uses divs instead of p tags, so we need to be more flexible
              if (paragraphs.length < 10) {
                const contentDivs = Array.from(contentContainer.querySelectorAll('div')).filter(el => {
                  const text = el.textContent || '';
                  const hasDirectText = el.childNodes.length > 0 && 
                                       Array.from(el.childNodes).some(node => 
                                         node.nodeType === 3 && (node.textContent?.trim().length ?? 0) > 20
                                       );
                  
                  // Look for divs that:
                  // 1. Have substantial text content (min 50 chars)
                  // 2. Are NOT navigation/ad/sidebar elements
                  // 3. Have text nodes directly (can have children like strong, emphasis, etc.)
                  // 4. Are likely article content (contain substantial words)
                  return text.length > 50 && 
                         text.split(/\s+/).length > 8 && // At least 8 words
                         !el.querySelector('h1, h2, h3') && 
                         !el.querySelector('button') &&
                         !el.querySelector('input') &&
                         !el.querySelector('script') &&
                         !el.querySelector('style') &&
                         !el.querySelector('iframe') &&
                         !el.textContent?.includes('Subscribe') &&
                         !el.textContent?.includes('!function') &&
                         !el.textContent?.includes('fbq(') &&
                         !el.textContent?.includes('obApi(') &&
                         !el.textContent?.includes('vgo(') &&
                         !el.textContent?.includes('window._peq') &&
                         !el.textContent?.includes('Check out our insightful property news') &&
                         !el.textContent?.includes('We also provide fruitful information') &&
                         !el.textContent?.includes('Related Articles') &&
                         !el.textContent?.includes('Tags:') &&
                         !el.textContent?.includes('Follow Us') &&
                         (hasDirectText || el.children.length <= 5); // Allow divs with few children (like strong, emphasis)
                });
                
                console.log(`Found ${contentDivs.length} content divs`);
                
                if (contentDivs.length > 0) {
                  const rawParagraphs = contentDivs
                    .map(el => el.textContent?.trim() || '')
                    .filter(text => text && text.length > 20);
                  
                  const additionalParagraphs = cleanParagraphs(rawParagraphs);
                  // Merge with existing, avoiding duplicates
                  const existingTexts = new Set(paragraphs);
                  additionalParagraphs.forEach(p => {
                    if (!existingTexts.has(p)) {
                      paragraphs.push(p);
                      existingTexts.add(p);
                    }
                  });
                }
              }
              
              // Method 3: Fallback to text-based extraction if still not enough
              if (paragraphs.length < 5) {
              const allText = contentContainer.textContent || '';
                console.log(`Fallback: Total text length: ${allText.length}`);
              
                const rawParagraphs = allText
                  .split(/\n\s*\n|\.\s+(?=[A-Z])/)
                  .map(p => p.trim())
                  .filter(text => text && text.length > 50);
                
                if (rawParagraphs.length > 0) {
                  const fallbackParagraphs = cleanParagraphs(rawParagraphs);
                  // Merge with existing, avoiding duplicates
                  const existingTexts = new Set(paragraphs);
                  fallbackParagraphs.forEach(p => {
                    if (!existingTexts.has(p)) {
                      paragraphs.push(p);
                      existingTexts.add(p);
                    }
                  });
                }
              }
              
              console.log(`Found ${paragraphs.length} paragraphs from article content`);
              
              // Update textContent if not already set
              if (!textContent && paragraphs.length > 0) {
                textContent = paragraphs.join('\n\n');
              }
              wordCount = textContent.split(/\s+/).length;
              readingTime = Math.ceil(wordCount / 200);
              
              // Mark as successful if we have any substantial content (lower threshold)
              if (textContent && textContent.length > 50) {
                extractionSuccess = true;
                console.log(`✅ Extraction successful: ${textContent.length} chars, ${paragraphs.length} paragraphs`);
              } else {
                console.log(`❌ Extraction failed: textContent length is ${textContent?.length || 0}, need > 50`);
              }
              
              // Extract links
              links = Array.from(contentContainer.querySelectorAll('a'))
                .map(link => {
                  const href = link.getAttribute('href') || '';
                  return {
                  text: link.textContent?.trim() || '',
                    url: href,
                    type: (href.includes('edgeprop.sg') ? 'internal' : 'external') as 'internal' | 'external'
                  };
                })
                .filter(link => link.url);
              
              // Extract images from article content
              // Search in contentContainer first, but also check the article/main area for images
              console.log(`🔍 Looking for images in contentContainer (${contentContainer.tagName})...`);
              const imageElements = Array.from(contentContainer.querySelectorAll('img'));
              console.log(`📷 Found ${imageElements.length} total img elements in contentContainer`);
              
              // Also search in the parent article/main area if contentContainer doesn't have many images
              if (imageElements.length < 3) {
                const articleElement = contentContainer.closest('article') || 
                                      contentContainer.closest('main') ||
                                      document.querySelector('article') ||
                                      document.querySelector('main');
                if (articleElement && articleElement !== contentContainer) {
                  const articleImages = Array.from(articleElement.querySelectorAll('img'));
                  console.log(`📷 Also found ${articleImages.length} img elements in article/main area`);
                  // Merge, avoiding duplicates
                  const existingSrcs = new Set(imageElements.map(img => img.getAttribute('src') || img.getAttribute('data-src') || ''));
                  articleImages.forEach(img => {
                    const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
                    if (src && !existingSrcs.has(src)) {
                      imageElements.push(img);
                      existingSrcs.add(src);
                    }
                  });
                  console.log(`📷 Total unique images found: ${imageElements.length}`);
                }
              }
              
              // Get all paragraph elements to determine image positions
              // Use the same logic as paragraph extraction to get matching elements
              let allParagraphElements: Element[] = [];
              
              // Get semantic paragraph elements
              const semanticParas = Array.from(contentContainer.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li'));
              
              // Get div elements that look like paragraphs (same logic as paragraph extraction)
              const imageParagraphDivs = Array.from(contentContainer.querySelectorAll('div')).filter(el => {
                const text = el.textContent || '';
                return text.length > 50 && 
                       text.split(/\s+/).length > 8 &&
                       !el.querySelector('div div div') &&
                       !el.querySelector('button, input, script, style, iframe') &&
                       !text.toLowerCase().includes('subscribe') &&
                       !text.toLowerCase().includes('follow us') &&
                       !text.toLowerCase().includes('related articles') &&
                       !text.toLowerCase().includes('related news') &&
                       !text.toLowerCase().includes('tags:') &&
                       el.children.length <= 5;
              });
              
              allParagraphElements = [...semanticParas, ...imageParagraphDivs];
              
              // Helper function to find which paragraph an image comes after
              const findParagraphIndex = (imgElement: Element): number => {
                if (!contentContainer) return -1;
                // Get all child nodes of contentContainer in order
                const walker = document.createTreeWalker(
                  contentContainer as Node,
                  NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
                  null
                );
                
                const nodes: Node[] = [];
                let node: Node | null;
                while (node = walker.nextNode()) {
                  nodes.push(node);
                }
                
                const imgNode = imgElement;
                const imgPosition = nodes.indexOf(imgNode);
                
                if (imgPosition === -1) return -1;
                
                // Find the last paragraph element that appears before this image
                let lastParaIndex = -1;
                for (let i = 0; i < imgPosition; i++) {
                  const node = nodes[i];
                  if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node as Element;
                    if (allParagraphElements.includes(el)) {
                      const paraText = el.textContent?.trim() || '';
                      // Only count paragraphs with substantial content (>50 chars)
                      if (paraText.length > 50) {
                        lastParaIndex = allParagraphElements.indexOf(el);
                      }
                    }
                  }
                }
                
                // Now map to our extracted paragraphs array index
                // We need to match the paragraph text to find its index in the paragraphs array
                if (lastParaIndex >= 0 && lastParaIndex < allParagraphElements.length) {
                  const paraElement = allParagraphElements[lastParaIndex];
                  const paraText = paraElement.textContent?.trim() || '';
                  
                  // Find matching paragraph in our extracted paragraphs array
                  const matchingParaIdx = paragraphs.findIndex(p => {
                    // Check if this paragraph text matches or is contained in the extracted paragraph
                    return p.includes(paraText.substring(0, 50)) || paraText.includes(p.substring(0, 50));
                  });
                  
                  return matchingParaIdx >= 0 ? matchingParaIdx : lastParaIndex;
                }
                
                return lastParaIndex;
              };
              
              const images: Array<{url: string; alt?: string; caption?: string; paragraph_index?: number}> = [];
              
              imageElements.forEach((img, idx) => {
                const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
                const srcSet = img.getAttribute('srcset') || '';
                
                // Get the actual image URL (prefer src, fallback to first srcset entry)
                let imageUrl = src;
                if (!imageUrl && srcSet) {
                  const srcSetMatch = srcSet.match(/([^\s,]+)/);
                  if (srcSetMatch) {
                    imageUrl = srcSetMatch[1];
                  }
                }
                
                if (imageUrl) {
                  // Filter out logos, icons, avatars, and other non-content images
                  const lowerUrl = imageUrl.toLowerCase();
                  if (lowerUrl.includes('logo') || 
                      lowerUrl.includes('icon') || 
                      lowerUrl.includes('avatar') ||
                      lowerUrl.includes('button') ||
                      lowerUrl.includes('badge') ||
                      lowerUrl.includes('spinner') ||
                      lowerUrl.includes('loading') ||
                      lowerUrl.includes('placeholder') ||
                      imageUrl.includes('data:image')) {
                    console.log(`   ⏭️  Skipping image ${idx + 1}: ${imageUrl.substring(0, 80)}... (logo/icon/avatar)`);
                    return;
                  }
                  
                  // Make URL absolute if relative
                  const fullUrl = imageUrl.startsWith('http') ? imageUrl : `https://www.edgeprop.sg${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
                  const alt = img.getAttribute('alt') || '';
                  
                  // Try to find caption (check multiple possible locations)
                  let caption = '';
                  
                  // Check parent figure for figcaption
                  if (img.closest('figure')) {
                    const figCaption = img.closest('figure')?.querySelector('figcaption');
                    if (figCaption) {
                      caption = figCaption.textContent?.trim() || '';
                    }
                  }
                  
                  // Check next sibling
                  if (!caption && img.nextElementSibling) {
                    const nextSibling = img.nextElementSibling;
                    if (nextSibling.tagName === 'FIGCAPTION' || 
                        nextSibling.classList.toString().includes('caption') ||
                        nextSibling.tagName === 'P') {
                      caption = nextSibling.textContent?.trim() || '';
                    }
                  }
                  
                  // Check parent for caption class
                  if (!caption && img.parentElement) {
                    const captionEl = img.parentElement.querySelector('[class*="caption"], figcaption');
                    if (captionEl) {
                      caption = captionEl.textContent?.trim() || '';
                    }
                  }
                  
                  // Find which paragraph this image comes after
                  const paragraphIndex = findParagraphIndex(img);
                  
                  images.push({
                    url: fullUrl,
                    alt: alt,
                    caption: caption,
                    paragraph_index: paragraphIndex >= 0 ? paragraphIndex : undefined
                  });
                  console.log(`   ✅ Added image ${idx + 1}: ${fullUrl.substring(0, 80)}... (after paragraph ${paragraphIndex >= 0 ? paragraphIndex : 'unknown'})`);
                } else {
                  console.log(`   ⚠️  Image ${idx + 1} has no src or data-src`);
                }
              });
              
              console.log(`📊 Extracted ${images.length} valid images from ${imageElements.length} total img elements`);
              
              // Get main image (usually the first large image, or featured image)
              // mainImageUrl and mainImageCaption already declared at function scope
              
              console.log(`🔍 Looking for main/featured image...`);
              
              // Try to find featured/main image (prioritize larger images or featured images)
              let mainImage = contentContainer.querySelector('img[class*="featured"], img[class*="main"], img[class*="hero"]') ||
                              contentContainer.querySelector('img[class*="cover"]') ||
                              null;
              
              // If no featured image, try to find the first large image (not logo/icon)
              if (!mainImage && images.length > 0) {
                // Use the first valid image as main image
                const firstValidImage = imageElements.find(img => {
                  const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
                  return src && 
                         !src.toLowerCase().includes('logo') && 
                         !src.toLowerCase().includes('icon') &&
                         !src.toLowerCase().includes('avatar');
                });
                mainImage = firstValidImage || imageElements[0];
              }
              
              if (mainImage && images.length > 0) {
                // Use the corresponding image from our extracted images array
                const mainSrc = mainImage.getAttribute('src') || mainImage.getAttribute('data-src') || mainImage.getAttribute('data-lazy-src') || '';
                if (mainSrc) {
                  mainImageUrl = mainSrc.startsWith('http') ? mainSrc : `https://www.edgeprop.sg${mainSrc.startsWith('/') ? '' : '/'}${mainSrc}`;
                  
                  // Find the corresponding image in our images array to get caption
                  const correspondingImage = images.find(img => img.url === mainImageUrl || img.url.includes(mainSrc));
                  if (correspondingImage && correspondingImage.caption) {
                    mainImageCaption = correspondingImage.caption;
                  } else {
                    // Fallback: try to find caption in DOM
                    const captionEl = mainImage.parentElement?.querySelector('figcaption') ||
                                     mainImage.nextElementSibling ||
                                     mainImage.closest('figure')?.querySelector('figcaption');
                    if (captionEl) {
                      mainImageCaption = captionEl.textContent?.trim() || '';
                    }
                  }
                  
                  console.log(`✅ Found main image: ${mainImageUrl.substring(0, 80)}...`);
                }
              } else {
                console.log(`⚠️  No main image found`);
              }
              
              // Extract HTML content (sanitized)
              htmlContent = contentContainer.innerHTML || '';
              
              // Extract tags
              const tagElements = document.querySelectorAll('[class*="tag"], a[href*="field_tags_tid"]');
              tags = Array.from(tagElements)
                .map(el => el.textContent?.trim())
                .filter(tag => tag && tag.length > 0 && !tag.includes('Tags:'))
                .slice(0, 10); // Limit tags to 10
              
              description = paragraphs.length > 0 ? 
                paragraphs.find(p => p.length > 50 && !p.toLowerCase().includes(articleTitle.toLowerCase().substring(0, 20)))?.substring(0, 200) || 
                paragraphs[0].substring(0, 200) : '';
              
              console.log(`📊 Final image summary: ${images.length} images extracted, main image: ${mainImageUrl ? mainImageUrl.substring(0, 60) + '...' : 'Not found'}`);
              
              return {
                extractionSuccess,
                usedSelector,
                author,
                created: publishedDate,
                category: categories,
                description,
                html_content: htmlContent,
                text_content: textContent,
                paragraphs,
                links,
                images,
                main_image_url: mainImageUrl,
                main_image_caption: mainImageCaption,
                tags,
                word_count: wordCount,
                reading_time_minutes: readingTime
              };
                } catch (error: any) {
                  console.error('Error in article extraction:', error?.message || error);
                  // Return partial data if we have any (preserve progress)
                  const hasPartialData = paragraphs.length > 0 || textContent.length > 0;
                  return {
                    extractionSuccess: hasPartialData, // Mark as success if we have partial data
                    usedSelector: usedSelector || 'error',
                    author: author || 'EdgeProp Staff',
                    created: publishedDate || '',
                    category: categories || [],
                    description: description || '',
                    html_content: htmlContent || '',
                    text_content: textContent || '',
                    paragraphs: paragraphs || [],
                    links: links || [],
                    images: images || [],
                    main_image_url: mainImageUrl || '',
                    main_image_caption: mainImageCaption || '',
                    tags: tags || [],
                    word_count: textContent ? textContent.split(/\s+/).length : 0,
                    reading_time_minutes: textContent ? Math.ceil(textContent.split(/\s+/).length / 200) : 0
                  };
                }
              })(articleTitle); // Close IIFE and pass articleTitle
            }, article.title); // Pass the article title as a parameter
            
            console.log(`✅ page.evaluate() completed for: ${article.title}`);
            console.log(`🔍 Checking extraction results:`);
            console.log(`   - articleData exists: ${!!articleData}`);
            console.log(`   - extractionSuccess: ${articleData?.extractionSuccess}`);
            console.log(`   - usedSelector: ${articleData?.usedSelector || 'unknown'}`);
            console.log(`   - text_content exists: ${!!articleData?.text_content}`);
            console.log(`   - text_content length: ${articleData?.text_content?.length || 0}`);
            console.log(`   - author: ${articleData?.author || 'Not found'}`);
            console.log(`   - category: ${JSON.stringify(articleData?.category || [])}`);
            console.log(`   - paragraphs count: ${articleData?.paragraphs?.length || 0}`);
            console.log(`   - images count: ${articleData?.images?.length || 0}`);
            if (articleData?.images && articleData.images.length > 0) {
              console.log(`   - First image URL: ${(articleData.images[0] as any)?.url?.substring(0, 80) || 'N/A'}`);
            }
            console.log(`   - main_image_url: ${articleData?.main_image_url ? articleData.main_image_url.substring(0, 80) + '...' : 'Not found'}`);
            console.log(`   - tags count: ${articleData?.tags?.length || 0}`);
            
            if (articleData && articleData.extractionSuccess && articleData.text_content && articleData.text_content.length > 0) {
              console.log(`✅ Extraction successful! Creating fullArticle object...`);
              const fullArticle: MCPArticle = {
                ...article,
                author: articleData.author,
                created: articleData.created || article.created,
                category: articleData.category,
                description: articleData.description || article.description,
                html_content: articleData.html_content,
                text_content: articleData.text_content,
                paragraphs: articleData.paragraphs,
                links: articleData.links,
                images: articleData.images || [],
                main_image_url: articleData.main_image_url,
                main_image_caption: articleData.main_image_caption,
                tags: articleData.tags,
                word_count: articleData.word_count,
                reading_time_minutes: articleData.reading_time_minutes,
                scraped_at: new Date()
              };

              allArticles.push(fullArticle);
              console.log(`✅ Scraped: ${article.title} by ${articleData.author}`);
              
              // Save immediately if requested
              if (saveImmediately && sessionId) {
                try {
                  console.log(`💾 Saving article immediately: ${article.title}`);
                  console.log(`💾 saveImmediately: ${saveImmediately}, sessionId: ${sessionId}`);
                  
                  // Save basic article metadata
                  const savedArticles = await db.upsertArticles([fullArticle], sessionId);
                  console.log(`✅ Saved metadata: ${savedArticles.newArticles} new, ${savedArticles.duplicates} duplicates`);
                  
                  // Save full content
                  if (fullArticle.text_content) {
                    const contentData = {
                      article_id: '', // Will be set by upsertArticleContent
                      html_content: fullArticle.html_content || '',
                      text_content: fullArticle.text_content,
                      paragraphs: fullArticle.paragraphs,
                      images: (fullArticle.images || []).map(img => typeof img === 'string' ? img : img.url),
                      links: fullArticle.links || [],
                      main_image_url: fullArticle.main_image_url || '',
                      main_image_caption: fullArticle.main_image_caption || '',
                      tags: fullArticle.tags || [],
                      word_count: fullArticle.word_count,
                      reading_time_minutes: fullArticle.reading_time_minutes,
                      published_date: new Date().toISOString()
                    };
                    await upsertArticleContent({ ...fullArticle, ...contentData });
                    console.log(`✅ Saved full content with ${fullArticle.images?.length || 0} images for: ${article.title}`);
                  }
                  
                  // Send progress update with save confirmation
                  onProgress?.({
                    currentPage: pageNum,
                    totalPages: maxPages,
                    currentArticle: i + 1,
                    articlesDiscovered: seenIds.size,
                    articlesScraped: allArticles.length,
                    articlesFailed,
                    status: 'running',
                    message: `✅ Saved: ${article.title.substring(0, 50)}...`
                  });
                  
                } catch (saveError: any) {
                  console.error(`❌ Failed to save article ${article.title}:`, saveError);
                }
              }
            } else {
              articlesFailed++;
              console.log(`❌ Failed to extract content: ${article.title}`);
              console.log(`   - Reason: extractionSuccess=${articleData?.extractionSuccess}, text_content_length=${articleData?.text_content?.length || 0}`);
            }
            
          } catch (error: any) {
            articlesFailed++;
            console.error(`Failed to scrape article ${article.title}:`, error);
          }
          
          // Increased delay between articles to avoid Cloudflare detection
          await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 3000)); // 5-8 seconds
        }
        
        // Increased delay between pages to avoid rate limiting
        if (pageNum < maxPages) {
          await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 4000)); // 3-7 seconds
        }
    }
    
    onProgress({
      currentPage: maxPages,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: seenIds.size,
      articlesScraped: allArticles.length,
      articlesFailed,
      status: 'completed',
      message: `Scraping completed! Found ${allArticles.length} articles, ${articlesFailed} failed.`
    });
    
    return allArticles;
    
  } finally {
    await browser.close();
  }
}
