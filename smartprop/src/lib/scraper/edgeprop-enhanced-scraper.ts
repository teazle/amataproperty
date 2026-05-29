import { chromium, Browser, BrowserContext, Frame, Page } from 'playwright';
import * as _db from '@/lib/db/articles';
import { upsertArticleContent as _upsertArticleContent } from '@/lib/db/article-content';

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
 * Enhanced Cloudflare bypass with improved detection and handling
 */
async function bypassCloudflareChallenge(page: Page, maxAttempts: number = 12): Promise<boolean> {
  console.log(`🛡️ Starting enhanced Cloudflare bypass (max ${maxAttempts} attempts)...`);
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    console.log(`🔍 Cloudflare bypass attempt ${attempt + 1}/${maxAttempts}`);
    
    // Wait for page to stabilize
    await page.waitForTimeout(3000);
    
    // Enhanced Cloudflare detection patterns
    const pageContent = await page.content().catch(() => '');
    const pageTitle = await page.title().catch(() => '');
    const pageText = await page.textContent('body').catch(() => '') || '';
    const currentUrl = page.url();
    
    // Comprehensive Cloudflare detection
    const cloudflareIndicators = [
      // Content-based detection
      pageContent.includes('cf-browser-verification'),
      pageContent.includes('checking-your-browser'),
      pageContent.includes('Just a moment'),
      pageContent.includes('DDoS protection by Cloudflare'),
      pageContent.includes('cf-challenge'),
      pageContent.includes('cf-wrapper'),
      pageContent.includes('cf-im-under-attack'),
      pageContent.includes('ray-id'),
      
      // Text-based detection
      pageText.includes('Verifying you are human'),
      pageText.includes('checking-your-browser'),
      pageText.includes('Just a moment'),
      pageText.includes('Enable JavaScript and cookies'),
      pageText.includes('Please turn JavaScript on'),
      pageText.includes('Checking if the site connection is secure'),
      
      // Title-based detection
      pageTitle.includes('Just a moment'),
      pageTitle.includes('Checking your browser'),
      pageTitle.includes('Attention Required'),
      
      // URL-based detection
      currentUrl.includes('challenge-platform'),
      currentUrl.includes('cf-challenge'),
      currentUrl.includes('__cf_chl_jschl_tk__')
    ];
    
    const isCloudflare = cloudflareIndicators.some(indicator => indicator);
    
    if (!isCloudflare) {
      // Double-check that actual content is loaded
      const hasRealContent = await page.evaluate(() => {
        // Look for EdgeProp-specific content indicators
        const contentIndicators = [
          document.querySelector('article'),
          document.querySelector('main'),
          document.querySelector('[class*="content"]'),
          document.querySelector('.jsx-4217446631'),
          document.querySelector('.jsx-2128998887'),
          document.querySelector('[class*="article"]')
        ].filter(Boolean);
        
        const textLength = document.body.textContent?.length || 0;
        const hasEdgePropContent = document.body.innerHTML.includes('edgeprop') || 
                                  document.body.innerHTML.includes('EdgeProp');
        
        return contentIndicators.length > 0 && textLength > 1000 && hasEdgePropContent;
      }).catch(() => false);
      
      if (hasRealContent) {
        console.log(`✅ Cloudflare bypass successful! Content loaded (attempt ${attempt + 1})`);
        return true;
      }
    }
    
    console.log(`⚠️ Cloudflare challenge detected, attempting bypass...`);
    
    // Enhanced iframe detection and handling
    await handleCloudflareIframes(page);
    
    // Try alternative bypass methods
    await tryAlternativeBypassMethods(page);
    
    // Progressive wait times (exponential backoff)
    const waitTime = Math.min(5000 + (attempt * 2000), 15000);
    console.log(`⏳ Waiting ${waitTime}ms before next attempt...`);
    await page.waitForTimeout(waitTime);
  }
  
  console.log(`❌ Cloudflare bypass failed after ${maxAttempts} attempts`);
  return false;
}

/**
 * Enhanced iframe detection and interaction
 */
async function handleCloudflareIframes(page: Page): Promise<boolean> {
  console.log(`🔍 Scanning for Cloudflare challenge iframes...`);
  
  // Wait longer for dynamic iframes to load
  await page.waitForTimeout(8000);
  
  // Get all iframes with detailed analysis
  const iframeAnalysis = await page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll('iframe'));
    return iframes.map((iframe, index) => {
      const rect = iframe.getBoundingClientRect();
      // Ensure width and height are always numbers
      const width = Number(iframe.width) || rect.width;
      const height = Number(iframe.height) || rect.height;
      
      return {
        index,
        src: iframe.getAttribute('src') || '',
        id: iframe.id || '',
        className: iframe.className || '',
        name: iframe.name || '',
        title: iframe.title || '',
        width,
        height,
        isVisible: rect.width > 0 && rect.height > 0,
        position: { x: rect.x, y: rect.y },
        // Check for Cloudflare-specific attributes
        hasCloudflareIndicators: [
          iframe.getAttribute('src')?.includes('challenges.cloudflare.com'),
          iframe.getAttribute('src')?.includes('cloudflare'),
          iframe.id?.includes('cf-'),
          iframe.className?.includes('cf-'),
          iframe.name?.includes('challenge'),
          iframe.title?.toLowerCase().includes('challenge'),
          // Check parent elements for Cloudflare classes
          iframe.parentElement?.className?.includes('cf-'),
          iframe.closest('[class*="cf-"]') !== null
        ].some(Boolean)
      };
    });
  });

  console.log(`📊 Found ${iframeAnalysis.length} iframe(s):`);
  iframeAnalysis.forEach((iframe, idx) => {
    console.log(`   ${idx + 1}. ${iframe.hasCloudflareIndicators ? '🎯' : '❌'} src="${iframe.src.substring(0, 60)}", id="${iframe.id}", cf-indicators=${iframe.hasCloudflareIndicators}`);
  });

  // Filter for likely Cloudflare iframes
  const cloudflareIframes = iframeAnalysis.filter(iframe => 
    iframe.hasCloudflareIndicators || 
    (iframe.isVisible && iframe.width > 200 && iframe.height > 100 && !iframe.src.includes('facebook') && !iframe.src.includes('google'))
  );
  
  if (cloudflareIframes.length === 0) {
    console.log(`⚠️ No Cloudflare iframes detected`);
    return false;
  }
  
  // Try to interact with each potential Cloudflare iframe
  for (const iframeInfo of cloudflareIframes) {
    console.log(`🎯 Attempting to interact with iframe ${iframeInfo.index + 1}...`);
    
    try {
      const iframe = await page.$$('iframe').then(iframes => iframes[iframeInfo.index]);
      if (!iframe) continue;
      
      const frame = await iframe.contentFrame();
      if (!frame) {
        console.log(`   ⚠️ Could not access iframe content`);
        continue;
      }
      
      // Wait for iframe content to load
      await frame.waitForTimeout(5000);
      
      // Analyze iframe content
      const frameContent = await frame.evaluate(() => {
        const body = document.body;
        const html = body.innerHTML;
        const text = body.textContent || '';
        
        return {
          html: html.substring(0, 1000),
          text: text.substring(0, 500),
          hasCheckbox: document.querySelectorAll('input[type="checkbox"]').length > 0,
          hasButton: document.querySelectorAll('button, [role="button"]').length > 0,
          hasChallenge: text.toLowerCase().includes('challenge') || 
                       text.toLowerCase().includes('verify') ||
                       html.includes('cf-challenge'),
          elements: {
            checkboxes: Array.from(document.querySelectorAll('input[type="checkbox"]')).length,
            buttons: Array.from(document.querySelectorAll('button')).length,
            labels: Array.from(document.querySelectorAll('label')).length,
            clickables: Array.from(document.querySelectorAll('[onclick], [role="button"], .clickable')).length
          }
        };
      }).catch(() => null);
      
      if (!frameContent) {
        console.log(`   ⚠️ Could not analyze iframe content`);
        continue;
      }
      
      console.log(`   📄 Iframe content: "${frameContent.text.substring(0, 100)}..."`);
      console.log(`   📊 Elements: ${frameContent.elements.checkboxes} checkboxes, ${frameContent.elements.buttons} buttons`);
      
      if (!frameContent.hasChallenge && !frameContent.hasCheckbox && !frameContent.hasButton) {
        console.log(`   ❌ Iframe doesn't appear to contain Cloudflare challenge`);
        continue;
      }
      
      // Try to interact with challenge elements
      const success = await interactWithChallengeElements(frame);
      if (success) {
        console.log(`   ✅ Successfully interacted with Cloudflare challenge`);
        return true;
      }
      
    } catch (error) {
      console.log(`   ❌ Error interacting with iframe: ${error}`);
    }
  }
  
  return false;
}

/**
 * Interact with challenge elements in iframe
 */
async function interactWithChallengeElements(frame: Frame | Page): Promise<boolean> {
  console.log(`🎯 Attempting to interact with challenge elements...`);
  
  // Enhanced selector list for Cloudflare challenges
  const challengeSelectors = [
    // Checkbox selectors
    'input[type="checkbox"]',
    'input[type="checkbox"]#challenge-form',
    'input[id*="challenge"]',
    'input[name*="challenge"]',
    'input[class*="checkbox"]',
    '#cf-challenge-checkbox',
    '.cb-lb input[type="checkbox"]',
    '.cb-lb',
    'label[for*="challenge"] input',
    
    // Button selectors
    'button[type="submit"]',
    'button[id*="challenge"]',
    'button[class*="challenge"]',
    '.cf-button',
    '[role="button"]',
    
    // Label selectors (sometimes clickable)
    'label[for*="challenge"]',
    'label.cb-lb',
    
    // Generic clickable elements
    '[onclick]',
    '.clickable',
    '[data-action]'
  ];
  
  for (const selector of challengeSelectors) {
    try {
      console.log(`   🔍 Trying selector: ${selector}`);
      
      // Wait for element to appear
      await frame.waitForSelector(selector, { timeout: 3000, state: 'attached' }).catch(() => null);
      
      const element = await frame.$(selector);
      if (!element) continue;
      
      // Check element properties
      const elementInfo = await element.evaluate((el: Element) => {
        const rect = el.getBoundingClientRect();
        return {
          tagName: el.tagName,
          type: (el as HTMLInputElement).type || '',
          visible: rect.width > 0 && rect.height > 0,
          enabled: !(el as HTMLInputElement).disabled,
          text: el.textContent?.trim() || '',
          className: el.className,
          id: el.id
        };
      }).catch(() => null);
      
      if (!elementInfo) continue;
      
      console.log(`   📍 Found ${elementInfo.tagName}: visible=${elementInfo.visible}, enabled=${elementInfo.enabled}, text="${elementInfo.text}"`);
      
      if (!elementInfo.visible || !elementInfo.enabled) continue;
      
      // Scroll element into view
      await element.scrollIntoViewIfNeeded().catch(() => null);
      await frame.waitForTimeout(1000);
      
      // Try to click the element
      try {
        await element.click({ timeout: 5000, force: false });
        console.log(`   ✅ Successfully clicked ${elementInfo.tagName} with selector: ${selector}`);
        
        // Wait for challenge to process
        await frame.waitForTimeout(8000);
        
        // Check if challenge was resolved
        const challengeResolved = await frame.evaluate(() => {
          const text = document.body.textContent || '';
          return !text.toLowerCase().includes('verifying') && 
                 !text.toLowerCase().includes('checking') &&
                 !text.toLowerCase().includes('just a moment');
        }).catch(() => false);
        
        if (challengeResolved) {
          console.log(`   ✅ Challenge appears to be resolved`);
          return true;
        }
        
      } catch (clickError) {
        console.log(`   ⚠️ Click failed: ${clickError}`);
      }
      
    } catch (error) {
      console.log(`   ⚠️ Selector ${selector} failed: ${error}`);
    }
  }
  
  return false;
}

/**
 * Try alternative bypass methods
 */
async function tryAlternativeBypassMethods(page: Page): Promise<void> {
  console.log(`🔄 Trying alternative bypass methods...`);
  
  // Method 1: Simulate human-like mouse movements
  try {
    await page.mouse.move(100, 100);
    await page.waitForTimeout(500);
    await page.mouse.move(200, 200);
    await page.waitForTimeout(500);
    await page.mouse.move(300, 300);
    console.log(`   ✅ Simulated mouse movements`);
  } catch (e) {
    console.log(`   ⚠️ Mouse simulation failed: ${e}`);
  }
  
  // Method 2: Try keyboard interactions
  try {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    console.log(`   ✅ Simulated keyboard interactions`);
  } catch (e) {
    console.log(`   ⚠️ Keyboard simulation failed: ${e}`);
  }
  
  // Method 3: Scroll to trigger any lazy-loaded challenge elements
  try {
    await page.evaluate(() => {
      window.scrollTo({ top: 100, behavior: 'smooth' });
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    console.log(`   ✅ Performed scroll interactions`);
  } catch (e) {
    console.log(`   ⚠️ Scroll simulation failed: ${e}`);
  }
  
  // Method 4: Try to click any visible challenge elements on main page
  try {
    const challengeElements = await page.$$('[class*="cf-"], [id*="cf-"], [class*="challenge"], button, input[type="checkbox"]');
    for (const element of challengeElements.slice(0, 3)) { // Limit to first 3 to avoid spam
      try {
        const isVisible = await element.isVisible().catch(() => false);
        if (isVisible) {
          await element.click({ timeout: 2000 });
          await page.waitForTimeout(2000);
          console.log(`   ✅ Clicked potential challenge element`);
        }
      } catch (e) {
        // Continue to next element
      }
    }
  } catch (e) {
    console.log(`   ⚠️ Main page element clicking failed: ${e}`);
  }
}

/**
 * Enhanced browser setup with latest anti-detection measures
 */
async function createEnhancedBrowser(): Promise<{ browser: Browser, context: BrowserContext }> {
  console.log(`🚀 Setting up enhanced browser with advanced stealth measures...`);
  
  // Enhanced launch options
  const launchOptions = {
    headless: false, // Keep visible for debugging
    args: [
      // Core stealth args
      '--disable-blink-features=AutomationControlled',
      '--exclude-switches=enable-automation',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      
      // Enhanced stealth args
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-field-trial-config',
      '--disable-back-forward-cache',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-domain-reliability',
      '--disable-component-extensions-with-background-pages',
      '--disable-breakpad',
      
      // Additional anti-detection
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-domain-reliability',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--no-service-autorun',
      '--password-store=basic',
      '--use-mock-keychain',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--no-report-upload',
      '--safebrowsing-disable-auto-update',
      '--enable-surface-synchronization'
    ]
  };
  
  const browser = await chromium.launch(launchOptions);
  
  // Enhanced context with realistic fingerprint
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 },
    colorScheme: 'light',
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true,
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-SG,en;q=0.9,en-US;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"'
    }
  });
  
  // Enhanced stealth script
  await context.addInitScript(() => {
    // Remove webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Enhanced chrome object mock
    (window as unknown as Window & Record<string, unknown>).chrome = {
      runtime: {
        onConnect: undefined,
        onMessage: undefined,
      },
      app: {
        isInstalled: false,
      },
      webstore: {
        onInstallStageChanged: undefined,
        onDownloadProgress: undefined,
      },
    };
    
    // Mock permissions API
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: PermissionDescriptor) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: 'default' } as unknown as PermissionStatus) :
        originalQuery(parameters)
    );
    
    // Enhanced navigator properties
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
    
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => 0,
    });
    
    // Enhanced screen properties
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
    
    Object.defineProperty(screen, 'colorDepth', {
      get: () => 24,
    });
    
    Object.defineProperty(screen, 'pixelDepth', {
      get: () => 24,
    });
    
    // Mock plugins and mimeTypes with realistic data
    Object.defineProperty(navigator, 'plugins', {
      get: () => ({
        length: 3,
        0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        2: { name: 'Native Client', filename: 'internal-nacl-plugin' }
      }),
    });
    
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => ({
        length: 2,
        0: { type: 'application/pdf', suffixes: 'pdf' },
        1: { type: 'text/pdf', suffixes: 'pdf' }
      }),
    });
    
    // Remove automation indicators
    delete (window as unknown as Window & Record<string, unknown>).cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete (window as unknown as Window & Record<string, unknown>).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete (window as unknown as Window & Record<string, unknown>).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    delete (window as unknown as Window & Record<string, unknown>).__webdriver_evaluate;
    delete (window as unknown as Window & Record<string, unknown>).__webdriver_script_function;
    delete (window as unknown as Window & Record<string, unknown>).__webdriver_script_func;
    delete (window as unknown as Window & Record<string, unknown>).__webdriver_script_fn;
    delete (window as unknown as Window & Record<string, unknown>).__fxdriver_evaluate;
    delete (window as unknown as Window & Record<string, unknown>).__driver_unwrapped;
    delete (window as unknown as Window & Record<string, unknown>).__webdriver_unwrapped;
    delete (window as unknown as Window & Record<string, unknown>).__driver_evaluate;
    delete (window as unknown as Window & Record<string, unknown>).__selenium_evaluate;
    delete (window as unknown as Window & Record<string, unknown>).__selenium_unwrapped;
    delete (window as unknown as Window & Record<string, unknown>).__fxdriver_unwrapped;
    
    // Mock getBattery
    if ('getBattery' in navigator) {
      (navigator as unknown as Navigator & Record<string, unknown>).getBattery = () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 0.99
      });
    }
    
    // Fix EdgeProp's __name function
    if (typeof (window as unknown as Window & Record<string, unknown>).__name === 'undefined') {
      (window as unknown as Window & Record<string, unknown>).__name = function() { return ''; };
    }
    
    // Mock connection API
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        effectiveType: '4g',
        rtt: 50,
        downlink: 10,
        saveData: false
      }),
    });
    
    // Override Date.prototype.getTimezoneOffset
    const _originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function() {
      return -480; // Singapore timezone offset
    };
    
    // Mock Intl.DateTimeFormat
    const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function() {
      const options = originalResolvedOptions.call(this);
      options.timeZone = 'Asia/Singapore';
      return options;
    };
  });
  
  return { browser, context };
}

/**
 * Enhanced EdgeProp scraper with improved Cloudflare bypass
 */
export async function scrapeEdgePropEnhanced(
  maxPages: number,
  onProgress: MCPProgressCallback,
  _sessionId?: string,
  _saveImmediately: boolean = false,
  _maxArticles?: number
): Promise<MCPArticle[]> {
  console.log('🚀 Starting Enhanced EdgeProp scraper with advanced Cloudflare bypass...');
  
  const { browser, context } = await createEnhancedBrowser();
  
  try {
    const page = await context.newPage();
    
    // Enhanced page setup
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-SG,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    });
    
    const allArticles: MCPArticle[] = [];
    const seenIds = new Set<string>();
    let articlesFailed = 0;
    
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: 0,
      articlesScraped: 0,
      articlesFailed: 0,
      status: 'running',
      message: 'Starting enhanced EdgeProp scraper...'
    });
    
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`📄 Starting page ${pageNum} of ${maxPages}`);
      
      const url = pageNum === 1 
        ? `https://www.edgeprop.sg/property-news/latest`
        : `https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=${pageNum}&page_size=20&sort_by=posted_desc&category=`;
      
      console.log(`🌐 Navigating to: ${url}`);
      
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded', 
          timeout: 60000 
        });
        
        // Enhanced Cloudflare bypass for listing page
        const listingPageBypass = await bypassCloudflareChallenge(page, 5);
        if (!listingPageBypass) {
          console.log(`❌ Could not bypass Cloudflare on listing page ${pageNum}`);
          continue;
        }
        
        console.log(`✅ Successfully loaded listing page ${pageNum}`);
        
        // Rest of the scraping logic would go here...
        // For now, this is the enhanced framework
        
      } catch (error) {
        console.error(`❌ Failed to process page ${pageNum}:`, error);
        articlesFailed++;
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
      message: `Enhanced scraping completed! Found ${allArticles.length} articles, ${articlesFailed} failed.`
    });
    
    return allArticles;
    
  } finally {
    await browser.close();
  }
}
