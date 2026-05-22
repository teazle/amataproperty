import { chromium } from 'playwright-ghost';
import plugins from 'playwright-ghost/plugins';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { solveCloudflareWithFlaresolverr, applyFlaresolverrToContext, FLARESOLVERR_UA, resetFlaresolverrSession } from './flaresolverr.js';
import { humanPause } from './stealth.js';
import { waitForCloudflareAutoResolve, bypassCloudflareDirect } from './cloudflare-bypass-alternative.js';
import { getProxyFromEnv } from '../utils/free-proxy-rotator.js';
import { checkFlaresolverr, getBrowserRuntimeStatus, inspectAuthState } from '../lib/scraper/runtime-health.js';

function isPropertyGuruCloudflareBlocked(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes('just a moment') ||
    normalized.includes('checking your browser') ||
    normalized.includes('pardon our interruption') ||
    normalized.includes('verify you are human') ||
    normalized.includes('performing security verification') ||
    normalized.includes('security service to protect against malicious bots') ||
    normalized.includes('enable javascript and cookies');
}

async function ensurePropertyGuruAuthRuntimeReady() {
  const browserStatus = getBrowserRuntimeStatus(
    typeof chromium.executablePath === 'function' ? chromium.executablePath() : undefined
  );
  if (!browserStatus.ok) {
    throw new Error(`${browserStatus.error}. Run 'bunx playwright install chromium' first.`);
  }

  const flaresolverrStatus = await checkFlaresolverr();
  if (!flaresolverrStatus.reachable) {
    throw new Error(`Flaresolverr is unavailable at ${flaresolverrStatus.url}: ${flaresolverrStatus.error ?? 'unknown error'}`);
  }
}

async function authenticatePropertyGuru() {
  await ensurePropertyGuruAuthRuntimeReady();

  const email = process.env.PG_EMAIL;
  const password = process.env.PG_PASSWORD;
  const isAutomated = email && password;

  // Detect if we should use headless mode
  // Priority: HEADLESS env var > DISPLAY > CI/production defaults
  const hasDisplay = !!process.env.DISPLAY;
  const forceHeadless = process.env.HEADLESS === 'true' || process.env.HEADLESS === '1';
  const forceHeaded = process.env.HEADLESS === 'false' || process.env.HEADLESS === '0';

  // If explicitly set to headed, use headed mode
  // Otherwise, if explicitly set to headless, use headless mode
  // Otherwise, check DISPLAY and environment
  let isHeadless: boolean;
  if (forceHeaded) {
    isHeadless = false;
  } else if (forceHeadless) {
    isHeadless = true;
  } else {
    // Default: headless if no DISPLAY or in CI/production
    isHeadless = !hasDisplay || process.env.CI === 'true' || process.env.NODE_ENV === 'production';
  }

  if (isAutomated) {
    console.log(`🚀 Launching Chromium browser for automated login (${isHeadless ? 'headless' : 'headed'} mode)...`);
    console.log(`📧 Email: ${email}`);
  } else {
    console.log(`🚀 Launching Chromium browser for manual login (${isHeadless ? 'headless' : 'headed'} mode)...`);
  }

  if (isHeadless && !hasDisplay) {
    console.log('⚠️  DISPLAY not set - using headless mode. Set DISPLAY=:99 if Xvfb is running.');
  }

  // Use REAL Chrome browser instead of Playwright's Chromium for better Cloudflare bypass
  // Real Chrome has fewer automation-detecting flags and better fingerprinting
  // Minimal flags - only what's necessary, avoid flags that make it detectable

  // Try to find Chrome (macOS, Linux, Windows)
  let chromePath: string | undefined;
  const possibleChromePaths = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/opt/google/chrome/chrome',
    '/opt/google/chrome/google-chrome',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // Environment variable override
    process.env.CHROME_PATH,
  ].filter(Boolean) as string[];

  for (const path of possibleChromePaths) {
    if (fs.existsSync(path)) {
      chromePath = path;
      console.log(`✅ Found Chrome at: ${chromePath}`);
      break;
    }
  }

  // Enhanced stealth launch args - comprehensive anti-detection
  // CRITICAL: Don't disable features that Cloudflare needs (JavaScript, cookies, storage)
  // Based on research: need to remove ALL automation indicators but keep browser functionality
  const stealthLaunchArgs = [
    // Core stealth - remove automation indicators
    '--disable-blink-features=AutomationControlled',
    '--exclude-switches=enable-automation',
    '--disable-dev-shm-usage',

    // CRITICAL: Enable JavaScript and cookies (don't disable these!)
    // Cloudflare Turnstile requires JavaScript execution
    '--enable-javascript', // Explicitly enable (should be default, but be explicit)

    // Remove headless indicators
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-site-isolation-trials',

    // Realistic browser behavior
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection',
    '--disable-hang-monitor',
    '--disable-prompt-on-repost',
    '--disable-domain-reliability',
    '--disable-component-extensions-with-background-pages',
    '--disable-breakpad',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-service-autorun',
    '--password-store=basic',
    '--use-mock-keychain',
    '--force-color-profile=srgb',
    '--metrics-recording-only',
    '--no-report-upload',
    '--safebrowsing-disable-auto-update',

    // Only add headless-specific flags if actually headless
    ...(isHeadless ? ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox'] : []),
  ];

  // Check for proxy configuration
  const proxyConfig = getProxyFromEnv();
  if (proxyConfig) {
    console.log(`🌐 Using proxy: ${proxyConfig.server.replace(/\/\/.*@/, '//***:***@')}`);
  }

  async function launchBrowserWithFallback() {
    // Strategy 1: Try real Chrome with channel option (best for Cloudflare bypass)
    try {
      console.log('🔄 Attempting to launch real Chrome browser (best for Cloudflare bypass)...');
      const browser = await chromium.launch({
        channel: 'chrome', // Use real Chrome instead of bundled Chromium
        headless: isHeadless,
        plugins: plugins.recommended({
          humanize: {
            click: { delay: { min: 200, max: 600 } },
            cursor: false,
            dialog: { delay: { min: 800, max: 2000 } }
          }
        }),
        proxy: proxyConfig || undefined, // Add proxy if configured
        args: stealthLaunchArgs,
        timeout: 30000
      });
      await browser.version();
      console.log('✅ Real Chrome launched successfully');
      return browser;
    } catch (err) {
      console.log('⚠️  Real Chrome launch failed, trying with executablePath...', err instanceof Error ? err.message : String(err));

      // Strategy 2: Try with explicit executablePath if channel doesn't work
      if (chromePath) {
        try {
          const browser = await chromium.launch({
            executablePath: chromePath,
            headless: isHeadless,
            plugins: plugins.recommended({
              humanize: {
                click: { delay: { min: 200, max: 600 } },
                cursor: false,
                dialog: { delay: { min: 800, max: 2000 } }
              }
            }),
            proxy: proxyConfig || undefined, // Add proxy if configured
            args: stealthLaunchArgs,
            timeout: 30000
          });
          await browser.version();
          console.log('✅ Chrome launched via executablePath');
          return browser;
        } catch (err2) {
          console.log('⚠️  Chrome executablePath failed, falling back to bundled Chromium...', err2 instanceof Error ? err2.message : String(err2));
        }
      }

      // Strategy 3: Fallback to bundled Chromium with minimal flags
      try {
        console.log('🔄 Falling back to bundled Chromium with minimal flags...');
        const browser = await chromium.launch({
          headless: isHeadless,
          plugins: plugins.recommended({
            humanize: {
              click: { delay: { min: 200, max: 600 } },
              cursor: false,
              dialog: { delay: { min: 800, max: 2000 } }
            }
          }),
          chromiumSandbox: false,
          proxy: proxyConfig || undefined, // Add proxy if configured
          args: stealthLaunchArgs,
          timeout: 30000
        });
        await browser.version();
        console.log('✅ Bundled Chromium launched (fallback)');
        return browser;
      } catch (err3) {
        console.log('❌ All browser launch strategies failed');
        throw err3;
      }
    }
  }

  const browser = await launchBrowserWithFallback();

  // Match Flaresolverr's fingerprint so cf_clearance cookies remain valid in this context.
  const realisticUA = FLARESOLVERR_UA;

  // Create context with comprehensive stealth settings
  // CRITICAL: Must explicitly enable JavaScript and cookies for Cloudflare Turnstile
  // Based on research: Cloudflare checks for JavaScript execution and cookie storage
  const context = await browser.newContext({
    userAgent: realisticUA, // Set explicitly for consistency
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation', 'notifications'], // Add notifications permission
    geolocation: { latitude: 1.3521, longitude: 103.8198 }, // Singapore coordinates
    colorScheme: 'light',
    deviceScaleFactor: 1, // Explicit device scale
    hasTouch: false, // Desktop browser
    isMobile: false, // Desktop browser
    javaScriptEnabled: true, // CRITICAL: Explicitly enable JavaScript for Cloudflare
    // Comprehensive HTTP headers matching real Chrome
    extraHTTPHeaders: {
      'Accept-Language': 'en-SG,en;q=0.9,en-US;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Sec-Ch-Ua': '"Google Chrome";v="142", "Chromium";v="142", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Linux"',
      'Cache-Control': 'max-age=0',
    },
    // CRITICAL: Enable cookies and storage for Cloudflare
    ignoreHTTPSErrors: false, // Don't ignore HTTPS errors (Cloudflare needs proper SSL)
    bypassCSP: false, // Don't bypass CSP (Cloudflare uses CSP)
  });

  // COMPREHENSIVE stealth scripts - remove ALL automation indicators
  // Based on research: Cloudflare checks multiple properties
  await context.addInitScript(() => {
    // 1. Remove webdriver property completely (not undefined, but false)
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false, // false is more realistic than undefined
      configurable: true,
    });

    // 2. Remove all cdc_ and __playwright properties (Playwright markers)
    Object.keys(window).forEach(key => {
      if (key.includes('cdc_') || key.includes('__playwright') || key.includes('__pw')) {
        try {
          delete (window as any)[key];
        } catch (e) {
          // Ignore
        }
      }
    });

    // 3. Realistic plugins array (Chrome has multiple plugins)
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        return plugins as any;
      },
      configurable: true,
    });

    // 4. Realistic mimeTypes
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const mimeTypes = [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
          { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
          { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' },
        ];
        return mimeTypes as any;
      },
      configurable: true,
    });

    // 5. Languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-SG', 'en-US', 'en'],
      configurable: true,
    });

    // 6. Platform
    Object.defineProperty(navigator, 'platform', {
      get: () => 'Linux x86_64',
      configurable: true,
    });

    // 7. Hardware concurrency (realistic CPU count)
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8, // Common MacBook Pro CPU count
      configurable: true,
    });

    // 8. Device memory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8, // 8GB RAM
      configurable: true,
    });

    // 9. Permissions API
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission } as PermissionStatus) :
        originalQuery(parameters)
    );

    // 10. Chrome object (must exist for Chrome)
    (window as any).chrome = {
      runtime: {
        onConnect: undefined,
        onMessage: undefined,
      },
      loadTimes: function() {},
      csi: function() {},
      app: {},
    };

    // 11. Battery API
    const navigatorWithBattery = navigator as Navigator & {
      getBattery?: () => Promise<unknown>;
    };
    if (typeof navigatorWithBattery.getBattery === 'function') {
      navigatorWithBattery.getBattery = () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      });
    }

    // 12. WebGL vendor/renderer (realistic GPU info)
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
      if (parameter === 37445) { // UNMASKED_VENDOR_WEBGL
        return 'Intel Inc.';
      }
      if (parameter === 37446) { // UNMASKED_RENDERER_WEBGL
        return 'Intel Iris OpenGL Engine';
      }
      return getParameter.call(this, parameter);
    };

    // 15. CRITICAL: Ensure localStorage and sessionStorage are available (Cloudflare checks this)
    try {
      if (typeof Storage === 'undefined') {
        (window as any).Storage = function() {};
      }
      if (!window.localStorage) {
        const storage: any = {};
        window.localStorage = {
          getItem: (key: string) => storage[key] || null,
          setItem: (key: string, value: string) => { storage[key] = value; },
          removeItem: (key: string) => { delete storage[key]; },
          clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
          key: (index: number) => Object.keys(storage)[index] || null,
          get length() { return Object.keys(storage).length; }
        };
      }
      if (!window.sessionStorage) {
        const storage: any = {};
        window.sessionStorage = {
          getItem: (key: string) => storage[key] || null,
          setItem: (key: string, value: string) => { storage[key] = value; },
          removeItem: (key: string) => { delete storage[key]; },
          clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
          key: (index: number) => Object.keys(storage)[index] || null,
          get length() { return Object.keys(storage).length; }
        };
      }
    } catch (e) {
      // Ignore storage errors
    }

    // 16. CRITICAL: Ensure IndexedDB is available (Cloudflare may check this)
    if (!window.indexedDB) {
      (window as any).indexedDB = {
        open: () => Promise.reject(new Error('IndexedDB not available')),
      };
    }

    // 17. CRITICAL: Ensure Web Crypto API is available (Cloudflare uses this)
    if (!window.crypto || !window.crypto.subtle) {
      (window as any).crypto = {
        getRandomValues: (arr: any) => {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 256);
          }
          return arr;
        },
        subtle: {
          digest: () => Promise.reject(new Error('SubtleCrypto not available')),
        },
        randomUUID: () => {
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        },
      };
    }

    // 13. Canvas fingerprinting protection (add noise)
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type?: string, quality?: any) {
      const context = this.getContext('2d');
      if (context) {
        const imageData = context.getImageData(0, 0, this.width, this.height);
        // Add minimal noise to prevent fingerprinting
        for (let i = 0; i < imageData.data.length; i += 4) {
          if (Math.random() < 0.001) { // 0.1% chance
            imageData.data[i] = Math.min(255, imageData.data[i] + Math.floor(Math.random() * 2) - 1);
          }
        }
        context.putImageData(imageData, 0, 0);
      }
      return originalToDataURL.call(this, type, quality);
    };

    // 14. Screen properties
    Object.defineProperty(screen, 'availWidth', { get: () => 1920, configurable: true });
    Object.defineProperty(screen, 'availHeight', { get: () => 1080, configurable: true });
    Object.defineProperty(screen, 'width', { get: () => 1920, configurable: true });
    Object.defineProperty(screen, 'height', { get: () => 1080, configurable: true });
    Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true });
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24, configurable: true });
  });

  const page = await context.newPage();

  const loginUrl = 'https://www.propertyguru.com.sg/login';

  // Enhanced navigation with better stealth - try multiple approaches
  console.log('📄 Navigating to PropertyGuru login page with enhanced stealth...');

  // First, try to navigate with realistic delays and behavior
  try {
    // Add human-like mouse movement before navigation
    await page.mouse.move(100, 100);
    await humanPause(500, 1000);

    await page.goto(loginUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000, // Longer timeout
      referer: 'https://www.google.com.sg' // Add referer to look more natural
    });

    // Wait and simulate human behavior
    await humanPause(3000, 5000);

    // Simulate scrolling (human behavior)
    await page.evaluate(() => {
      window.scrollTo(0, 100);
      setTimeout(() => window.scrollTo(0, 0), 500);
    });
    await humanPause(1000, 2000);

  } catch (navError) {
    console.log(`   ⚠️  Initial navigation failed: ${navError instanceof Error ? navError.message : String(navError)}`);
    // Try again with simpler approach
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await humanPause(2000, 3000);
  }

  // MANUAL CLOUDFLARE BYPASS: If in headed mode, wait for user to manually complete Cloudflare
  if (!isHeadless) {
    const pageContent = await page.content().catch(() => '') || '';
    const pageText = await page.textContent('body').catch(() => '') || '';
    const hasCloudflareChallenge = isPropertyGuruCloudflareBlocked(pageText) ||
                                   pageText.length < 10000;

    if (hasCloudflareChallenge) {
      console.log('');
      console.log('🛡️  CLOUDFLARE CHALLENGE DETECTED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📋 MANUAL ACTION REQUIRED:');
      console.log('   1. Look at the Chrome browser window that opened');
      console.log('   2. Complete the Cloudflare challenge manually');
      console.log('   3. Wait until you see the PropertyGuru login page');
      console.log('   4. The script will automatically continue in 2 minutes');
      console.log('   (Or press Enter in this terminal to continue immediately)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');

      // Wait for user to complete Cloudflare (2 minutes max, or until Enter is pressed)
      const waitStart = Date.now();
      const maxWait = 120000; // 2 minutes

      // Poll for Cloudflare resolution
      while (Date.now() - waitStart < maxWait) {
        await humanPause(5000, 7000); // Check every 5-7 seconds

        const currentText = await page.textContent('body').catch(() => '') || '';
        const currentLength = currentText.length;
        const stillBlocked = isPropertyGuruCloudflareBlocked(currentText) ||
                            currentLength < 10000;

        if (!stillBlocked && currentLength > 10000) {
          console.log('✅ Cloudflare challenge appears to be resolved!');
          break;
        }

        // Show progress
        const elapsed = Math.floor((Date.now() - waitStart) / 1000);
        if (elapsed % 15 === 0) {
          console.log(`   ⏳ Still waiting... (${elapsed}s elapsed, page: ${currentLength} chars)`);
        }
      }

      console.log('🔄 Continuing with authentication...');
      await humanPause(2000, 3000);
    }
  }

  // Check if page is blocked by Cloudflare
  const initialPageText = await page.textContent('body').catch(() => '') || '';
  const initialPageLength = initialPageText.length;
  const isBlocked = isPropertyGuruCloudflareBlocked(initialPageText) ||
                    initialPageLength < 10000;

  let flaresolverrSucceeded = false;

  // MANUAL CLOUDFLARE BYPASS: If in headed mode and Cloudflare detected, wait for user to manually complete
  if (!isHeadless && isBlocked) {
    console.log('');
    console.log('🛡️  CLOUDFLARE CHALLENGE DETECTED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 MANUAL ACTION REQUIRED:');
    console.log('   1. Look at the Chrome browser window that opened');
    console.log('   2. Complete the Cloudflare challenge manually');
    console.log('   3. Wait until you see the PropertyGuru login page');
    console.log('   4. The script will automatically continue in 2 minutes');
    console.log('   (The script will check every 5 seconds for resolution)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    // Wait for user to complete Cloudflare (2 minutes max)
    const waitStart = Date.now();
    const manualWaitTime = 120000; // 2 minutes

    // Poll for Cloudflare resolution
    while (Date.now() - waitStart < manualWaitTime) {
      await humanPause(5000, 7000); // Check every 5-7 seconds

      const currentText = await page.textContent('body').catch(() => '') || '';
      const currentLength = currentText.length;
      const stillBlocked = isPropertyGuruCloudflareBlocked(currentText) ||
                          currentLength < 10000;

      if (!stillBlocked && currentLength > 10000) {
        console.log('✅ Cloudflare challenge appears to be resolved!');
        console.log(`   Page content: ${currentLength} chars (was ${initialPageLength} chars)`);
        flaresolverrSucceeded = true; // Mark as succeeded so we skip Flaresolverr
        break;
      }

      // Show progress
      const elapsed = Math.floor((Date.now() - waitStart) / 1000);
      if (elapsed % 15 === 0) {
        console.log(`   ⏳ Still waiting... (${elapsed}s elapsed, page: ${currentLength} chars)`);
      }
    }

    console.log('🔄 Continuing with authentication...');
    await humanPause(2000, 3000);
  }

  // If still blocked and manual bypass didn't work, try Flaresolverr
  if (isBlocked && !flaresolverrSucceeded) {
    console.log('   🛡️  Cloudflare detected, using Flaresolverr to solve...');
    const maxTimeout = 300000; // 300s for tough PG challenges
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts && !flaresolverrSucceeded; attempt++) {
      // Reset session each attempt to avoid stuck session
      resetFlaresolverrSession();
      try {
        console.log(`   🔧 Flaresolverr attempt ${attempt}/${maxAttempts} (timeout ${maxTimeout / 1000}s)...`);
        // CRITICAL: Use sessionless mode ONLY - sessions are crashing immediately
        // Based on logs: "invalid session id: session deleted as the browser has closed the connection"
        // Sessionless mode is more stable for PropertyGuru's aggressive Cloudflare
        const useSession = false; // Always use sessionless - sessions crash too quickly
        const flaresolverrResult = await solveCloudflareWithFlaresolverr(page.url(), useSession, undefined, maxTimeout);

        if (flaresolverrResult && flaresolverrResult.cookies.length > 0) {
          await applyFlaresolverrToContext(context, flaresolverrResult, '.propertyguru.com.sg');
          flaresolverrSucceeded = true;

          const storagePath = path.join(process.cwd(), 'storage');
          if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
          }
          const tempStatePath = path.join(storagePath, 'pg.state.temp.json');
          try {
            await context.storageState({ path: tempStatePath });
            console.log('   💾 Saved Cloudflare cookies temporarily');
          } catch (saveError) {
            console.log(`   ⚠️  Failed to save temp cookies: ${saveError}`);
          }

          console.log('   🔄 Reloading page with Flaresolverr cookies...');
          await page.reload({ waitUntil: 'load', timeout: 120000 });
          await humanPause(4000, 7000);
        } else {
          console.log('   ⚠️  Flaresolverr returned no cookies - page may be blocked');
        }
      } catch (error) {
        console.log(`   ⚠️  Flaresolverr attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (!flaresolverrSucceeded && attempt < maxAttempts) {
        console.log('   ⏳ Waiting before next Flaresolverr attempt...');
        await humanPause(4000, 7000);
      }
    }
    // Final best-effort: if still blocked, try direct reload to collect any partial cookies
    if (!flaresolverrSucceeded) {
      console.log('   ⚠️  All Flaresolverr attempts failed, trying direct reload (best effort)...');
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
        await humanPause(3000, 5000);
      } catch (e) {
        console.log('   ⚠️  Direct reload also failed:', e instanceof Error ? e.message : String(e));
      }
    }
  } else if (!isBlocked) {
    console.log('   ✅ No Cloudflare detected, proceeding with login...');
  }

  // If Flaresolverr succeeded, verify cookies were applied correctly
  if (flaresolverrSucceeded) {
    console.log('   🔍 Verifying Flaresolverr cookies were applied...');
    const cookiesAfterFlaresolverr = await context.cookies();
    const cfCookies = cookiesAfterFlaresolverr.filter((c: any) =>
      ['__cf_bm', 'cf_clearance', '__cfduid'].some(cfName => c.name.toLowerCase().includes(cfName.toLowerCase()))
    );
    console.log(`   📊 Found ${cfCookies.length} Cloudflare cookies in context`);
    if (cfCookies.length > 0) {
      console.log(`   🍪 Cloudflare cookies: ${cfCookies.map((c: any) => `${c.name} (domain: ${c.domain || 'default'}, path: ${c.path || '/'})`).join(', ')}`);
    } else {
      console.log('   ⚠️  Warning: No Cloudflare cookies found after Flaresolverr!');
    }
  }

  // Navigate to PropertyGuru login page
  // Use load instead of networkidle to avoid timeout (networkidle can wait forever on some pages)
  // Use domcontentloaded when Flaresolverr failed (to fail faster if blocked)
  const waitUntil = flaresolverrSucceeded ? 'load' : 'domcontentloaded';
  const timeout = flaresolverrSucceeded ? 60000 : 30000; // 1 min if Flaresolverr succeeded, 30s if failed
  console.log(`📄 Navigating to PropertyGuru login page (waiting for ${waitUntil})...`);
  await page.goto(loginUrl, { waitUntil, timeout });
  console.log('📄 Navigated to PropertyGuru login page');

  // If Flaresolverr succeeded, wait longer for Cloudflare transition to complete
  if (flaresolverrSucceeded) {
    console.log('   ⏳ Waiting for Cloudflare transition to complete (this may take 10-20 seconds)...');
    // Wait longer for Cloudflare to transition - it can take 10-20 seconds
    await humanPause(10000, 15000);

    // Check if page has transitioned by looking for login form or Cloudflare indicators
    let loginFormFound = false;
    let retries = 0;
    const maxRetries = 6; // Try for up to 60 seconds (6 * 10s)

    while (!loginFormFound && retries < maxRetries) {
      try {
        // Check for login form
        const emailInput = await page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
        const isVisible = await emailInput.isVisible({ timeout: 5000 }).catch(() => false);

        if (isVisible) {
          loginFormFound = true;
          console.log('   ✅ Login form appeared - Cloudflare bypass successful!');
          break;
        }
      } catch (e) {
        // Form not found yet, continue waiting
      }

      // Check if still in Cloudflare transition
      const pageText = await page.textContent('body').catch(() => '') || '';
      if (pageText.includes('Verification successful') && pageText.includes('Waiting for')) {
        console.log(`   ⏳ Still in Cloudflare transition (attempt ${retries + 1}/${maxRetries})...`);

        // Try executing JavaScript to trigger Cloudflare completion
        try {
          // Try to trigger any pending JavaScript that might complete the transition
          await page.evaluate(() => {
            // Trigger any pending events
            window.dispatchEvent(new Event('load'));
            window.dispatchEvent(new Event('DOMContentLoaded'));
            // Try to find and click any "Continue" or "Verify" buttons if they exist
            const continueBtn = document.querySelector('button[type="submit"], input[type="submit"], button:contains("Continue"), button:contains("Verify")');
            if (continueBtn && (continueBtn as HTMLElement).offsetParent !== null) {
              (continueBtn as HTMLElement).click();
            }
          }).catch(() => {});
        } catch (e) {
          // Ignore JavaScript errors
        }

        // Try reloading the page after 2-3 attempts to force Cloudflare to re-evaluate cookies
        if (retries === 2 || retries === 4) {
          console.log(`   🔄 Reloading page to force Cloudflare re-evaluation...`);
          await page.reload({ waitUntil: 'load', timeout: 60000 });
          await humanPause(5000, 8000);
        } else {
          await humanPause(10000, 12000);
        }
        retries++;
      } else if (pageText.length < 10000) {
        // Page is still blocked
        console.log(`   ⏳ Page still blocked (attempt ${retries + 1}/${maxRetries}), waiting 10 more seconds...`);
        await humanPause(10000, 12000);
        retries++;
      } else {
        // Page seems loaded, try to find login form one more time
        try {
          await page.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="email" i]', {
            timeout: 10000,
            state: 'visible'
          });
          loginFormFound = true;
          console.log('   ✅ Login form appeared after transition!');
          break;
        } catch (e) {
          retries++;
          if (retries < maxRetries) {
            console.log(`   ⏳ Login form not found yet (attempt ${retries + 1}/${maxRetries}), waiting 10 more seconds...`);
            await humanPause(10000, 12000);
          }
        }
      }
    }

      if (!loginFormFound) {
        // Final check - get page state
        const pageContent = await page.content().catch(() => '') || '';
        const pageText = await page.textContent('body').catch(() => '') || '';
        const pageLength = pageText.length;

        console.log(`   📊 Page content length: ${pageLength}`);

        // Check current cookies
        const cookiesAfterNav = await context.cookies();
        const cfCookiesAfterNav = cookiesAfterNav.filter((c: any) =>
          ['__cf_bm', 'cf_clearance', '__cfduid'].some(cfName => c.name.toLowerCase().includes(cfName.toLowerCase()))
        );
        console.log(`   📊 Cloudflare cookies after navigation: ${cfCookiesAfterNav.length}`);

        // Check for Cloudflare indicators
        const cloudflareIndicators = [
          'Just a moment...',
          'Pardon Our Interruption',
          'Checking your browser',
          'Just a moment',
          'challenge-platform',
          'cf-browser-verification',
          'cf-im-under-attack',
          'Verify you are human',
          'Verification successful',
          'Performing security verification',
          'security service to protect against malicious bots',
          'Enable JavaScript and cookies'
        ];

        const hasCloudflare = isPropertyGuruCloudflareBlocked(pageContent) ||
          isPropertyGuruCloudflareBlocked(pageText) ||
          cloudflareIndicators.some(indicator =>
            pageContent.includes(indicator) || pageText.includes(indicator)
          );

        if (hasCloudflare || pageLength < 10000) {
          console.log('   🛡️  Cloudflare challenge still present after waiting 60+ seconds!');
          console.log(`   📄 Page content preview: ${pageText.substring(0, 200)}...`);
          console.log('   ⚠️  Flaresolverr failed - attempting to proceed without it (may fail if Cloudflare is too aggressive)');
          // Don't throw - try to proceed anyway, the login attempt might still work
        } else {
          console.log('   ⚠️  Login form not found, but page appears loaded. Attempting to proceed...');
        }
      }

    // Verify cookies are still present after navigation
    const cookiesAfterNav = await context.cookies();
    const cfCookiesAfterNav = cookiesAfterNav.filter((c: any) =>
      ['__cf_bm', 'cf_clearance', '__cfduid'].some(cfName => c.name.toLowerCase().includes(cfName.toLowerCase()))
    );
    console.log(`   📊 Cloudflare cookies after navigation: ${cfCookiesAfterNav.length}`);
  } else {
    // Flaresolverr failed - check immediately and try to wait for auto-resolve
    const pageContent = await page.content().catch(() => '') || '';
    const pageText = await page.textContent('body').catch(() => '') || '';
    let pageLength = pageText.length;

    console.log(`   📊 Page content length: ${pageLength}`);

    if (pageLength < 10000 || isPropertyGuruCloudflareBlocked(pageText) || isPropertyGuruCloudflareBlocked(pageContent)) {
      console.log('   🛡️  Cloudflare detected after navigation, using Flaresolverr now...');
      try {
        const flaresolverrResult = await solveCloudflareWithFlaresolverr(page.url() || loginUrl, false, undefined, 300000);
        if (flaresolverrResult && flaresolverrResult.cookies.length > 0) {
          await applyFlaresolverrToContext(context, flaresolverrResult, '.propertyguru.com.sg');
          flaresolverrSucceeded = true;

          const storagePath = path.join(process.cwd(), 'storage');
          if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
          }
          const tempStatePath = path.join(storagePath, 'pg.state.temp.json');
          await context.storageState({ path: tempStatePath }).catch(() => {});

          console.log('   🔄 Reloading page with fresh Flaresolverr cookies...');
          await page.goto(loginUrl, { waitUntil: 'load', timeout: 120000 });
          await humanPause(10000, 15000);
          const refreshedText = await page.textContent('body').catch(() => '') || '';
          pageLength = refreshedText.length;
          console.log(`   📊 Page content length after Flaresolverr reload: ${pageLength}`);
        } else {
          console.log('   ⚠️  Flaresolverr returned no usable cookies after navigation');
        }
      } catch (error) {
        console.log(`   ⚠️  Post-navigation Flaresolverr attempt failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // If Flaresolverr failed AND page is blocked, wait for Cloudflare to auto-resolve
    if (!flaresolverrSucceeded && pageLength < 10000) {
      console.log(`   🛡️  Flaresolverr failed AND page is blocked (${pageLength} chars) - waiting for Cloudflare to auto-resolve...`);
      // Wait up to 2 minutes for Cloudflare to auto-resolve
      for (let waitAttempt = 0; waitAttempt < 8; waitAttempt++) {
        await humanPause(15000, 20000);
        const checkPageText = await page.textContent('body').catch(() => '') || '';
        pageLength = checkPageText.length;
        if (pageLength > 10000 && !isPropertyGuruCloudflareBlocked(checkPageText)) {
          console.log('   ✅ Cloudflare resolved after waiting!');
          break;
        }
        console.log(`   ⏳ Still waiting for Cloudflare... (${(waitAttempt + 1) * 17}s, length: ${pageLength})`);
        // Try reloading the page periodically
        if (waitAttempt === 3 || waitAttempt === 6) {
          console.log('   🔄 Reloading page to trigger Cloudflare re-evaluation...');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
          await humanPause(5000, 8000);
        }
      }

      // Final check - if still blocked, try to proceed anyway (Cloudflare may allow login)
      const finalPageText = await page.textContent('body').catch(() => '') || '';
      const finalLength = finalPageText.length;
      if (finalLength < 10000 || isPropertyGuruCloudflareBlocked(finalPageText)) {
        console.log('   🔄 Flaresolverr failed, trying direct browser-based bypass...');
        const directBypassSuccess = await waitForCloudflareAutoResolve(page, 60000); // 1 minute
        if (!directBypassSuccess) {
          console.log('   ⚠️  Cloudflare still blocking, but attempting to proceed with login anyway...');
          console.log('   💡 Sometimes login forms are accessible even when Cloudflare challenge is present');
          // Don't throw - try to proceed with login
        }
      }
    }

    // Check for Cloudflare indicators
    const cloudflareIndicators = [
      'Just a moment...',
      'Pardon Our Interruption',
      'Checking your browser',
      'Just a moment',
      'challenge-platform',
      'cf-browser-verification',
      'cf-im-under-attack',
      'Performing security verification',
      'security service to protect against malicious bots',
      'Enable JavaScript and cookies'
    ];

    const hasCloudflare = isPropertyGuruCloudflareBlocked(pageContent) ||
      isPropertyGuruCloudflareBlocked(pageText) ||
      cloudflareIndicators.some(indicator =>
        pageContent.includes(indicator) || pageText.includes(indicator)
      );

    if (hasCloudflare) {
      console.log('   🛡️  Cloudflare challenge detected after navigation, but continuing...');
      console.log(`   📄 Page content preview: ${pageText.substring(0, 200)}...`);
      console.log('   💡 Will attempt to proceed with login anyway');
      // Don't throw - try to proceed
    }
  }

  // Get page content for final validation (only if not already checked above)
  const finalPageContent = await page.content().catch(() => '') || '';
  const finalPageText = await page.textContent('body').catch(() => '') || '';
  const finalPageLength = finalPageText.length;

  // Check if page is too small (likely blocked or not loaded)
  // Normal PropertyGuru login pages are 15k+ characters. Pages under 10k are likely blocked.
  if (finalPageLength < 10000) {
    console.log(`   ⚠️  Page content is very small (${finalPageLength} chars) - likely blocked or not loaded`);
    console.log(`   📄 Page content preview: ${finalPageText.substring(0, 500)}...`);

    // Wait a bit longer and check again
    await page.waitForTimeout(10000);
    const newPageContent = await page.content().catch(() => '') || '';
    const newPageText = await page.textContent('body').catch(() => '') || '';
    const newPageLength = newPageText.length;

    console.log(`   📊 Page content length after wait: ${newPageLength}`);

    // Check for Cloudflare again
    const cloudflareIndicators = [
      'Just a moment...',
      'Pardon Our Interruption',
      'Checking your browser',
      'Just a moment',
      'challenge-platform',
      'cf-browser-verification',
      'cf-im-under-attack',
      'Performing security verification',
      'security service to protect against malicious bots',
      'Enable JavaScript and cookies'
    ];
    const stillHasCloudflare = isPropertyGuruCloudflareBlocked(newPageContent) ||
      isPropertyGuruCloudflareBlocked(newPageText) ||
      cloudflareIndicators.some(indicator =>
        newPageContent.includes(indicator) || newPageText.includes(indicator)
      );

    if (stillHasCloudflare || newPageLength < 10000) {
      console.log(`   🛡️  Cloudflare challenge still present or page still too small`);
      console.log('   💡 Will attempt to proceed with login anyway - sometimes forms are accessible');
      // Don't throw - try to proceed
    }
  }

  // Check for login form
  const hasLoginForm = await page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').count().catch(() => 0) > 0;
  const hasPropertyContent = finalPageLength > 10000 || finalPageText.includes('Login') || finalPageText.includes('Sign in');

  if (!hasLoginForm && !hasPropertyContent) {
    console.log('⏳ Login form not found, waiting for page to load...');
    await page.waitForTimeout(10000);

    // Final check
    const finalPageText = await page.textContent('body').catch(() => '') || '';
    const finalHasLoginForm = await page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').count().catch(() => 0) > 0;

    if (!finalHasLoginForm && finalPageText.length < 10000) {
      console.log(`   ⚠️  Still no login form and page is small (${finalPageText.length} chars)`);
      console.log('   💡 Will attempt multiple strategies to bypass Cloudflare...');

      // Strategy 1: Wait longer with human behavior
      console.log('   🔄 Strategy 1: Extended wait with human behavior simulation...');
      for (let waitAttempt = 0; waitAttempt < 6; waitAttempt++) {
        await humanPause(10000, 15000);

        // Simulate human behavior
        await page.evaluate(() => {
          // Random mouse movements
          const x = Math.random() * window.innerWidth;
          const y = Math.random() * window.innerHeight;
          window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));

          // Random scrolling
          window.scrollTo(0, Math.random() * 500);
          setTimeout(() => window.scrollTo(0, 0), 1000);
        });

        // Check if form appeared
        const checkForm = await page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').count().catch(() => 0) > 0;
        if (checkForm) {
          console.log(`   ✅ Login form appeared after ${(waitAttempt + 1) * 12}s!`);
          break;
        }

        // Try reloading every 2 attempts
        if (waitAttempt === 1 || waitAttempt === 3) {
          console.log('   🔄 Reloading page...');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
          await humanPause(3000, 5000);
        }
      }

      // Final check
      const retryHasLoginForm = await page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').count().catch(() => 0) > 0;
      if (!retryHasLoginForm) {
        console.log('   ⚠️  Login form still not found, but will attempt to proceed anyway...');
        // Don't throw - let it try to find the form in the next step
      }
    }
  }

  if (isAutomated) {
    console.log('\n🤖 Performing automated login...');

    // Wait for login form to load
    await humanPause(2000, 3000);

    // Final Cloudflare check before attempting login - but try to proceed anyway
    const finalPageContent = await page.content().catch(() => '') || '';
    const finalPageText = await page.textContent('body').catch(() => '') || '';
    const hasCloudflare = isPropertyGuruCloudflareBlocked(finalPageContent) ||
        isPropertyGuruCloudflareBlocked(finalPageText);

    if (hasCloudflare) {
      console.log('   🛡️  Cloudflare challenge detected, but attempting to proceed with login...');
      console.log('   💡 Sometimes login forms are accessible even when Cloudflare challenge is present');
      // Don't throw - try to proceed
    }

    // Step 1: Fill in email with human-like typing
    console.log('   📧 Entering email...');

    // Wait for email input to be visible with longer timeout
    try {
      await page.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="email" i]', {
        timeout: 60000, // 60 seconds - Cloudflare can take time
        state: 'visible'
      });
    } catch (error) {
      console.log('   ⚠️  Email input not found, checking page state...');
      const currentText = await page.textContent('body').catch(() => '') || '';
      const currentUrl = page.url();
      console.log(`   📄 Current URL: ${currentUrl}`);
      console.log(`   📄 Page content length: ${currentText.length}`);
      if (isPropertyGuruCloudflareBlocked(currentText)) {
        throw new Error('Cloudflare challenge blocking login page');
      }
      throw error;
    }

    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    await emailInput.click({ timeout: 30000 });
    await humanPause(200, 400);
    await emailInput.pressSequentially(email, { delay: 50 + Math.random() * 50 }); // Human-like typing speed
    console.log('   ✅ Email entered');
    await humanPause(500, 1000);

    // Click Continue button to go to password page
    console.log('   🔄 Clicking Continue...');
    const continueButton = page.locator('button:has-text("Continue"), button[type="submit"]').first();
    await continueButton.click();
    console.log('   ⏳ Waiting for password page...');

    // Wait for password field with longer timeout and better error handling
    try {
      await page.waitForSelector('input[type="password"], input[name="password"]', {
        timeout: 60000, // Increased from default 30s to 60s
        state: 'visible'
      });
      await page.waitForTimeout(1000); // Small delay after field appears
    } catch (error) {
      console.log('   ⚠️  Password field not found, checking page state...');
      const pageContent = await page.textContent('body').catch(() => '') || '';
      const pageUrl = page.url();
      console.log(`   📄 Current URL: ${pageUrl}`);
      console.log(`   📄 Page content length: ${pageContent.length}`);

      // Check if Cloudflare challenge is present
      if (isPropertyGuruCloudflareBlocked(pageContent)) {
        console.log('   🛡️  Cloudflare challenge detected on password page!');
        throw new Error('Cloudflare challenge detected - page not loading properly');
      }

      throw error; // Re-throw if it's a different error
    }

    // Step 2: Fill in password with human-like typing
    console.log('   🔑 Entering password...');
    const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
    await passwordInput.click();
    await humanPause(200, 400);
    await passwordInput.pressSequentially(password, { delay: 50 + Math.random() * 50 }); // Human-like typing speed
    console.log('   ✅ Password entered');
    await humanPause(500, 1000);

    // Click login/submit button
    console.log('   🔄 Submitting login...');
    const submitButton = page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")').first();
    await submitButton.click();
    console.log('   ⏳ Waiting for login to complete...');

  } else {
    console.log('\n⏳ Please complete login:');
    console.log('   1. Use email/password to login');
    console.log('   2. Wait until you see "My Activities" in top right');
    console.log('   3. Script will auto-detect login and save\n');
  }

  // Wait for login - check for "My Activities" or user menu
  const maxWait = 180000; // 3 minutes
  try {
    await Promise.race([
      page.waitForSelector('text=My Activities', { timeout: maxWait }),
      page.waitForSelector('[href*="/my-"]', { timeout: maxWait }),
      page.waitForFunction(() => !document.body.textContent?.includes('Login'), { timeout: maxWait }),
    ]);
    console.log('✅ Login detected!');
  } catch (_e) {
    console.log('⏱️  Timeout - proceeding anyway...');
  }

  // Extra wait to ensure cookies are set
  console.log('⏳ Waiting 5 seconds for cookies to settle...');
  await page.waitForTimeout(5000);

  console.log('✅ Proceeding to save authentication state...');

  // Ensure storage directory exists
  const storagePath = path.join(process.cwd(), 'storage');
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
    console.log('📁 Created storage directory');
  }

  // Save the storage state
  const stateFilePath = path.join(storagePath, 'pg.state.json');
  await context.storageState({ path: stateFilePath });

  const stateStatus = inspectAuthState('propertyguru');
  if (!stateStatus.isAuthenticated) {
    throw new Error(stateStatus.failureReason || 'Authentication state was saved but is not valid');
  }

  console.log(`💾 Authentication state saved to: ${stateFilePath}`);
  console.log(`🍪 Saved ${stateStatus.cookieCount} cookies`);
  console.log('✨ You can now use this state for automated browsing sessions');

  await browser.close();
  console.log('🔚 Browser closed');
}

// Run the authentication flow
authenticatePropertyGuru().catch((error: unknown) => {
  console.error('❌ Error during authentication:', error);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  // Provide more context about what might have gone wrong
  if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
    console.error('   💡 Possible causes: Cloudflare challenge taking too long, Flaresolverr unavailable, or network issues');
  } else if (errorMessage.includes('not found') || errorMessage.includes('selector')) {
    console.error('   💡 Possible causes: Website structure changed, login form not loading, or Cloudflare blocking');
  } else if (errorMessage.includes('verification failed') || errorMessage.includes('Login check failed')) {
    console.error('   💡 Possible causes: Invalid credentials, session expired, or login flow changed');
  } else if (errorMessage.includes('Cloudflare') || errorMessage.includes('challenge')) {
    console.error('   💡 Possible causes: Flaresolverr not working, Cloudflare too aggressive, or cookies not applied');
  }

  if (errorStack) {
    console.error('   📋 Stack trace:', errorStack.split('\n').slice(0, 5).join('\n'));
  }

  process.exit(1);
});
