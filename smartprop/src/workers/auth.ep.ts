import { config } from 'dotenv';
import path from 'path';

// Load environment variables - try .env first, then .env.local
// CRITICAL: override: false ensures job-specific env vars (from queue worker) take precedence
config({ path: path.resolve(process.cwd(), '.env'), override: false });
config({ path: path.resolve(process.cwd(), '.env.local'), override: false });

import { chromium } from 'playwright-ghost';
import plugins from 'playwright-ghost/plugins';
import fs from 'fs';
import { CHROME_UA, humanPause } from './stealth';
import { solveCloudflareWithFlaresolverr, applyFlaresolverrToContext, resetFlaresolverrSession } from './flaresolverr';
import { waitForCloudflareAutoResolve } from './cloudflare-bypass-alternative';
import { checkFlaresolverr, getBrowserRuntimeStatus, inspectAuthState, resolveChromiumExecutablePath } from '../lib/scraper/runtime-health';

async function ensureEdgePropAuthRuntimeReady() {
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

async function authenticateEdgeProp() {
  await ensureEdgePropAuthRuntimeReady();

  // Get credentials from environment variables
  const email = process.env.EP_EMAIL;
  const password = process.env.EP_PASSWORD;

  if (!email || !password) {
    throw new Error('EP_EMAIL and EP_PASSWORD must be set in .env.local');
  }

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

  console.log(`🚀 Launching Chromium browser for automated login (${isHeadless ? 'headless' : 'headed'} mode)...`);
  console.log(`📧 Logging in as: ${email}`);

  if (isHeadless && !hasDisplay) {
    console.log('⚠️  DISPLAY not set - using headless mode. Set DISPLAY=:99 if Xvfb is running.');
  }

  // Use playwright-ghost with recommended plugins for best stealth (same as main scraper)
  const browser = await chromium.launch({
    executablePath: resolveChromiumExecutablePath(
      typeof chromium.executablePath === 'function' ? chromium.executablePath() : undefined
    ) || undefined,
    headless: isHeadless,
    plugins: plugins.recommended({
      humanize: {
        click: { delay: { min: 200, max: 600 } },
        cursor: false,
        dialog: { delay: { min: 800, max: 2000 } }
      }
    }),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      // macOS headless mode requires --disable-gpu
      ...(isHeadless ? ['--disable-gpu'] : []),
    ]
  });

  const context = await browser.newContext({
    // Don't set userAgent - let playwright-ghost handle it for better stealth
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 }, // Singapore coordinates
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': 'en-SG,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    }
  });

  // playwright-ghost handles most stealth automatically via plugins
  // Just add a minimal script to ensure webdriver is undefined (plugins handle the rest)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();

  try {
    // Use Flaresolverr to solve Cloudflare before navigating
    // Use useSession: false to prevent Chrome connection issues and OOM kills
    const homepageUrl = 'https://www.edgeprop.sg/';
    // Try without session first (more stable), with longer timeout
    let flaresolverrResult = await solveCloudflareWithFlaresolverr(homepageUrl, false, undefined, 120000);

    // If that fails, try with a session but expect it might fail
    if (!flaresolverrResult || flaresolverrResult.cookies.length === 0) {
      console.log('   🔄 Retrying Flaresolverr with session...');
      resetFlaresolverrSession();
      flaresolverrResult = await solveCloudflareWithFlaresolverr(homepageUrl, true, undefined, 120000);
    }

    if (flaresolverrResult && flaresolverrResult.cookies.length > 0) {
      await applyFlaresolverrToContext(context, flaresolverrResult, '.edgeprop.sg');

      // Save Cloudflare cookies immediately (will be overwritten with full auth state after login)
      const storagePath = path.join(process.cwd(), 'storage');
      if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
      }
      const tempStatePath = path.join(storagePath, 'ep.state.temp.json');
      try {
        await context.storageState({ path: tempStatePath });
        console.log('   💾 Saved Cloudflare cookies temporarily');
      } catch (saveError) {
        console.log(`   ⚠️  Failed to save temp cookies: ${saveError}`);
      }

      await humanPause(500, 1000);
    }

    // Navigate to EdgeProp homepage
    console.log('📄 Navigating to EdgeProp homepage...');
    try {
      await page.goto(homepageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait longer for Cloudflare to resolve if present
      await humanPause(5000, 8000); // Increased wait for Cloudflare

      // Check if page is blocked by Cloudflare
      const pageText = await page.textContent('body').catch(() => '') || '';
      const isCloudflareBlocked = pageText.includes('Pardon Our Interruption') ||
                                   pageText.includes('Verify you are human') ||
                                   pageText.includes('challenge-platform') ||
                                   pageText.includes('cf-browser-verification') ||
                                   pageText.includes('Checking your browser') ||
                                   pageText.includes('Just a moment') ||
                                   pageText.length < 10000;

      if (isCloudflareBlocked) {
        console.log('⚠️  Cloudflare challenge detected, waiting for it to resolve...');
        // Use the alternative bypass method for better reliability
        const resolved = await waitForCloudflareAutoResolve(page, 120000); // 2 minutes
        if (!resolved) {
          console.log('   ⚠️  Cloudflare did not auto-resolve, but continuing anyway...');
        } else {
          console.log('✅ Cloudflare challenge resolved!');
        }
      }

      // Wait for page to be interactive - check for body or main content
      await Promise.race([
        page.waitForSelector('body', { state: 'visible', timeout: 10000 }).catch(() => null),
        page.waitForSelector('main, [role="main"], header', { timeout: 10000 }).catch(() => null),
        new Promise(resolve => setTimeout(resolve, 5000)) // Fallback timeout
      ]);

      await humanPause(2000, 3000); // Give page time to fully render
    } catch (error) {
      console.error(`⚠️  Navigation timeout, but continuing... Error: ${error instanceof Error ? error.message : String(error)}`);
      // Try to check if page loaded anyway
      const currentUrl = page.url();
      if (currentUrl.includes('edgeprop.sg')) {
        console.log('✅ Page appears to have loaded (URL check passed)');
        await humanPause(2000, 3000);
      } else {
        throw error;
      }
    }

      // Check if already logged in
    const bookmarksLink = page.locator('[href="/bookmarks"]');
    const alreadyLoggedIn = await bookmarksLink.isVisible({ timeout: 3000 }).catch(() => false);

    if (alreadyLoggedIn) {
      console.log('✅ Already logged in! Saving existing auth state...');
    } else {
      // Close any fullscreen ads that might be blocking the page
      console.log('🔍 Checking for ads to close...');
      try {
        const closeAdSelectors = [
          () => page.locator('[class*="close"], [class*="Close"], button:has-text("Close"), [id*="close"]').first(),
          () => page.locator('text=/Close Ad/i').first(),
          () => page.locator('[class*="fullscreen-ads"] [class*="close"]').first(),
        ];

        for (const selector of closeAdSelectors) {
          try {
            const closeButton = selector();
            const isVisible = await closeButton.isVisible({ timeout: 2000 }).catch(() => false);
            if (isVisible) {
              await closeButton.click({ timeout: 5000 });
              console.log('   ✅ Closed ad overlay');
              await humanPause(1000, 2000);
              break;
            }
          } catch (e) {
            // Try next selector
            continue;
          }
        }
      } catch (e) {
        // No ads to close, continue
        console.log('   ℹ️  No ads detected or already closed');
      }

      // Click on Login button in header
      console.log('🔍 Clicking Login button...');

      // Try multiple selectors for the Login button
      let loginClicked = false;
      const loginSelectors = [
        () => page.locator('a[href*="/user/login"]').first(),
        () => page.locator('a[href*="login"]').first(),
        () => page.getByRole('link', { name: /Login/i }).first(),
        () => page.getByRole('button', { name: /Login/i }).first(),
        () => page.locator('button:has-text("Login")').first(),
        () => page.locator('div').filter({ hasText: /^Login$/ }).nth(1),
        () => page.getByText('Login', { exact: true }).first(),
        () => page.locator('[class*="login"]:has-text("Login")').first(),
        () => page.locator('text=/^Login$/i').first(),
        () => page.locator('*:has-text("Login")').filter({ hasText: /^Login$/i }).first(),
      ];

      for (let i = 0; i < loginSelectors.length; i++) {
        try {
          const loginButton = loginSelectors[i]();
          // Wait longer for element to appear (Cloudflare might delay page load)
          await loginButton.waitFor({ state: 'visible', timeout: 20000 });
          // Wait for element to be stable and clickable
          await loginButton.waitFor({ state: 'attached', timeout: 5000 });
          await humanPause(1000, 1500); // Longer pause before clicking

          // Try normal click first, then force click if it fails (for elements behind overlays)
          try {
            await loginButton.click({ timeout: 30000, force: false });
          } catch (clickError) {
            // If normal click fails due to overlay, try force click
            if (clickError instanceof Error && clickError.message.includes('intercepts pointer')) {
              console.log(`   ⚠️  Element blocked by overlay, trying force click...`);
              await loginButton.click({ timeout: 30000, force: true });
            } else {
              throw clickError;
            }
          }
          console.log(`   ✅ Clicked Login button using selector ${i + 1}`);
          loginClicked = true;
          break;
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.log(`   ⚠️  Selector ${i + 1} failed: ${errorMsg}`);
          // If it's a timeout and we're on selector 1-3, the page might still be loading
          if (i < 3 && errorMsg.includes('timeout')) {
            console.log(`   ⏳ Page might still be loading, waiting a bit longer...`);
            await humanPause(3000, 5000);
          }
          continue;
        }
      }

      if (!loginClicked) {
        // Debug: Take a screenshot and log page info
        const currentUrl = page.url();
        const pageTitle = await page.title().catch(() => 'Unknown');
        const pageText = await page.textContent('body').catch(() => '') || '';
        console.error('   ❌ All login selectors failed!');
        console.error(`   📄 Current URL: ${currentUrl}`);
        console.error(`   📄 Page title: ${pageTitle}`);
        console.error(`   📄 Page text preview: ${pageText.substring(0, 500)}...`);

        // Try to find any clickable element with "login" text
        const allLoginElements = await page.locator('*:has-text("login")').all();
        console.error(`   🔍 Found ${allLoginElements.length} elements containing "login" text`);

        throw new Error('Failed to click Login button - all selectors failed. Login is required to access phone numbers.');
      }

      await humanPause(1500, 2000);

      // Click on "User" option
      console.log('👤 Selecting User login...');
      await page.getByText('User').first().click();
      await humanPause(1500, 2000);

      // Fill in email and password
      console.log('📝 Filling in credentials...');
      await page.evaluate(({ email, pwd }: { email: string; pwd: string }) => {
        const emailInput = document.getElementById('username') as HTMLInputElement;
        const passwordInput = document.getElementById('password') as HTMLInputElement;

        if (emailInput) {
          emailInput.value = email;
          emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        if (passwordInput) {
          passwordInput.value = pwd;
          passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, { email, pwd: password });

      await humanPause(800, 1200);

      // Click the Login button - use more robust selector
      console.log('🔑 Submitting login form...');
      let loginSubmitted = false;
      const submitSelectors = [
        () => page.locator('button[type="submit"]').filter({ hasText: /Login/i }).first(),
        () => page.locator('button').filter({ hasText: /^Login$/i }).first(),
        () => page.getByRole('button', { name: /Login/i }).first(),
        () => page.locator('form button[type="submit"]').first(),
        () => page.getByText('Login').filter({ hasText: /^Login$/i }).first(),
      ];

      for (let i = 0; i < submitSelectors.length; i++) {
        try {
          const submitButton = submitSelectors[i]();
          await submitButton.waitFor({ state: 'visible', timeout: 5000 });
          // Try force click if normal click fails (for elements behind overlays)
          try {
            await submitButton.click({ timeout: 10000 });
          } catch (clickError) {
            // If normal click fails, try force click
            console.log(`   ⚠️  Normal click failed, trying force click...`);
            await submitButton.click({ timeout: 10000, force: true });
          }
          console.log(`   ✅ Clicked submit button using selector ${i + 1}`);
          loginSubmitted = true;
          break;
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.log(`   ⚠️  Submit selector ${i + 1} failed: ${errorMsg}`);
          continue;
        }
      }

      if (!loginSubmitted) {
        throw new Error('Failed to click Login submit button - all selectors failed');
      }

      // Wait for login to complete - check for bookmark link which appears when logged in
      console.log('⏳ Waiting for login to complete...');
      await humanPause(3000, 4000);

      // Check for any popup/dialog about logging out from other device
      // Wait a bit longer for the popup to appear after clicking login
      await humanPause(3000, 5000);

      // Variables to track dialog state (declared outside try-catch for access later)
      let dialogVisible = false;
      let buttonClicked = false;

      try {
        // Look for the popup text - it appears after login button is clicked
        // Use multiple methods to detect the dialog
        const dialogTextPattern = /signed out elsewhere|simultaneous sessions|logged out|maximum number of simultaneous|will be logged out|other device|another device|existing session|continue.*login|proceed.*login/i;

        // Wait longer for dialog to appear
        await humanPause(2000, 3000);

        // Try multiple detection methods

        // Method 1: Check page text content first (most reliable)
        try {
          const pageText = await page.textContent('body').catch(() => '') || '';
          dialogVisible = dialogTextPattern.test(pageText);
          if (dialogVisible) {
            console.log('⚠️  Detected multi-session dialog in page text');
          }
        } catch (e) {
          // Continue to other methods
        }

        // Method 2: Look for text with regex pattern
        if (!dialogVisible) {
          try {
            const logoutDialog = page.locator('text=/signed out elsewhere|simultaneous sessions|logged out|maximum number of simultaneous|will be logged out|other device|another device|existing session/i');
            dialogVisible = await logoutDialog.isVisible({ timeout: 3000 }).catch(() => false);
            if (dialogVisible) {
              console.log('⚠️  Detected multi-session dialog via text locator');
            }
          } catch (e) {
            // Continue
          }
        }

        // Method 3: Look for modal/dialog elements
        if (!dialogVisible) {
          try {
            const modalElements = await page.locator('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="popup"], [class*="overlay"]').all();
            for (const modal of modalElements) {
              const modalText = await modal.textContent().catch(() => '') || '';
              const isVisible = await modal.isVisible().catch(() => false);
              if (isVisible && dialogTextPattern.test(modalText)) {
                dialogVisible = true;
                console.log('⚠️  Detected multi-session dialog via modal element');
                break;
              }
            }
          } catch (e3) {
            // All methods failed
          }
        }

        if (dialogVisible) {
          console.log('⚠️  Detected multi-session warning dialog, clicking LOGIN button...');

          // Wait longer for the dialog to fully render and be interactive
          await humanPause(3000, 4000);

          // Click the LOGIN button using the exact selector
          buttonClicked = false;

          try {
            console.log('🔍 Looking for LOGIN button in dialog...');
            // The dialog button is uppercase "LOGIN", so we need to match it exactly
            // First try to find it within the dialog context
            const dialog = page.locator('text=/signed out elsewhere|simultaneous sessions/i').locator('xpath=ancestor::*[contains(@class, "modal") or contains(@class, "dialog") or @role="dialog"]').first();
            const dialogLoginButton = dialog.locator('text=/^LOGIN$/i').first();

            try {
              await dialogLoginButton.waitFor({ state: 'visible', timeout: 5000 });
              await dialogLoginButton.click();
              console.log('✅ Clicked LOGIN button in multi-session dialog (via dialog context)!');
              buttonClicked = true;
            } catch (e) {
              // Fallback: Use getByText with uppercase LOGIN
              console.log('⚠️  Dialog context method failed, trying direct LOGIN text...');
              await page.getByText('LOGIN', { exact: true }).click();
              console.log('✅ Clicked LOGIN button in multi-session dialog (via direct text)!');
              buttonClicked = true;
            }

            // Wait for login to complete after clicking - use smart detection instead of long waits
            console.log('⏳ Waiting for login to complete...');

            // Wait for bookmarks link to appear (indicates successful login)
            try {
              await page.locator('[href*="bookmarks"]').waitFor({ state: 'visible', timeout: 10000 });
              console.log('✅ Login successful! Bookmarks link detected.');
            } catch (e) {
              // If bookmarks not found, wait a bit and check URL
              await humanPause(2000, 3000);
              const currentUrl = page.url();
              if (currentUrl.includes('/user/login')) {
                // Still on login page, navigate to homepage
                console.log('⚠️  Still on login page, navigating to homepage...');
                await page.goto('https://www.edgeprop.sg', { waitUntil: 'domcontentloaded', timeout: 30000 });
                await humanPause(2000, 3000);
              }
            }
          } catch (e) {
            console.log(`⚠️  Could not click LOGIN button: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          console.log('ℹ️  No multi-session dialog detected');
        }
      } catch (e) {
        // No dialog, continue
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.log(`ℹ️  Error checking for multi-session dialog: ${errorMsg}`);
      }

      // Final check for successful login - verify with bookmarks link
      let loginSuccess = false;

      // Check if we're still on login page - if so, navigate to homepage
      const currentUrlAfterWait = page.url();
      if (currentUrlAfterWait.includes('/user/login')) {
        console.log('⚠️  Still on login page, navigating to homepage...');
        await page.goto('https://www.edgeprop.sg', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await humanPause(2000, 3000);
      }

      try {
        // Try multiple selectors for bookmark link
        const bookmarkSelectors = [
          '[href="/bookmarks"]',
          'a[href*="/bookmarks"]',
          '[href="/bookmarks"]',
          'a:has-text("Bookmarks")',
          'a:has-text("Bookmark")'
        ];

        let bookmarkFound = false;
        for (const selector of bookmarkSelectors) {
          try {
            const bookmarkLink = page.locator(selector);
            const isVisible = await bookmarkLink.isVisible({ timeout: 5000 }).catch(() => false);
            if (isVisible) {
              console.log(`✅ Login successful! Bookmark link found with selector: ${selector}`);
              loginSuccess = true;
              bookmarkFound = true;
              break;
            }
          } catch (e) {
            // Try next selector
            continue;
          }
        }

        if (!bookmarkFound) {
          // Check if we're on a logged-in page (URL might have changed)
          const currentUrl = page.url();
          if (currentUrl.includes('/user/') || currentUrl.includes('/bookmarks') || !currentUrl.includes('/user/login')) {
            console.log('✅ Login appears successful (URL indicates logged-in state)');
            loginSuccess = true;
          }
        }
      } catch (e) {
        // Continue to cookie check
      }

      if (!loginSuccess) {
        // Try alternative check - look for any session cookie or user profile indicator
        const cookies = await context.cookies();
        const hasSessionCookie = cookies.some(c =>
          c.name.includes('session') ||
          c.name.includes('auth') ||
          c.name.includes('token') ||
          c.name.includes('user') ||
          c.name.includes('edgeprop')
        );

        if (hasSessionCookie) {
          console.log('✅ Login appears successful (session cookie found)');
          loginSuccess = true;
        } else {
          // Check if page has any user-specific content
          const pageText = await page.textContent('body').catch(() => '') || '';
          if (pageText.includes('Bookmarks') || pageText.includes('Logout') || pageText.includes('Profile')) {
            console.log('✅ Login appears successful (user-specific content found on page)');
            loginSuccess = true;
          } else {
            console.error('❌ Login check failed - no bookmark link, no session cookies, and no user content found!');
            console.error('   This usually means the login credentials are incorrect or the login flow has changed.');
            throw new Error('Login verification failed - cannot proceed without valid authentication');
          }
        }
      }

      if (!loginSuccess) {
        throw new Error('Login verification failed');
      }

      await humanPause(1000, 1500);
    }

  } catch (error) {
    console.error('❌ Error during login:', error);
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

    throw error;
  }

  // Ensure storage directory exists
  const storagePath = path.join(process.cwd(), 'storage');
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
    console.log('📁 Created storage directory');
  }

  // Save the storage state - navigate to homepage first to ensure all cookies are set
  console.log('💾 Saving authentication state...');

  // Check if we're already on the homepage - if so, skip navigation
  const checkUrl = page.url();
  if (!checkUrl.includes('edgeprop.sg') || checkUrl.includes('/user/login')) {
    // Navigate to homepage to ensure all cookies are properly set
    // Use 'domcontentloaded' instead of 'networkidle' to avoid timeout issues
    // EdgeProp may have long-running connections that never finish
    try {
      await page.goto('https://www.edgeprop.sg', { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Wait for page to be interactive
      await Promise.race([
        page.waitForSelector('body', { state: 'visible', timeout: 10000 }).catch(() => null),
        page.waitForSelector('main, [role="main"], header', { timeout: 10000 }).catch(() => null),
        new Promise(resolve => setTimeout(resolve, 5000)) // Fallback timeout
      ]);

      await humanPause(2000, 3000);
    } catch (error) {
      console.error(`⚠️  Final navigation timeout, but continuing to save state... Error: ${error instanceof Error ? error.message : String(error)}`);
      // Check if we're on a valid page anyway
      const finalUrl = page.url();
      if (finalUrl.includes('edgeprop.sg') && !finalUrl.includes('/user/login')) {
        console.log('✅ Page appears to have loaded (URL check passed)');
        await humanPause(2000, 3000);
      } else {
        // If navigation failed but we're logged in, still try to save state
        console.log('⚠️  Navigation failed, but attempting to save state anyway...');
      }
    }
  } else {
    console.log('✅ Already on homepage, skipping navigation');
    await humanPause(1000, 2000);
  }

  // Verify we're still logged in before saving - check multiple indicators
  console.log('🔍 Verifying login status before saving state...');

  // Wait a bit for cookies to be set after login
  await humanPause(3000, 5000);

  // Check for logged-in indicators
  const loginIndicators = [
    () => page.locator('[href*="/bookmarks"], a:has-text("Bookmarks")').first(),
    () => page.locator('[href*="/user/logout"]').first(),
    () => page.locator('a[href*="/user/"]:not([href*="/user/login"]):not([href*="/user/register"])').first(),
    () => page.locator('text=/Logout/i').first(),
    () => page.locator('text=/Sign Out/i').first(),
  ];

  let stillLoggedIn = false;
  for (const indicator of loginIndicators) {
    try {
      const element = indicator();
      const isVisible = await element.isVisible({ timeout: 3000 }).catch(() => false);
      if (isVisible) {
        console.log(`   ✅ Found login indicator: ${element.toString()}`);
        stillLoggedIn = true;
        break;
      }
    } catch (e) {
      continue;
    }
  }

  // Also check for session cookies
  const allCookies = await context.cookies();
  const sessionCookieNames = allCookies.filter(c =>
    c.name.includes('session') ||
    c.name.includes('auth') ||
    c.name.includes('token') ||
    c.name.includes('user') ||
    (c.name.includes('edgeprop') && !c.name.startsWith('_') && !c.name.startsWith('__')) // Exclude analytics cookies
  );

  console.log(`🍪 Found ${allCookies.length} total cookies`);
  console.log(`   Session cookies: ${sessionCookieNames.length} (${sessionCookieNames.map(c => c.name).join(', ') || 'none'})`);

  // Check URL - if we're not on login page, might be logged in
  const pageUrl = page.url();
  const isOnLoginPage = pageUrl.includes('/user/login');
  const mightBeLoggedIn = !isOnLoginPage && (pageUrl.includes('/user/') || pageUrl.includes('edgeprop.sg'));

  if (!stillLoggedIn && sessionCookieNames.length === 0 && !mightBeLoggedIn) {
    console.error('⚠️  Warning: Login verification unclear!');
    console.error('   No bookmark link, no session cookies, and on login page.');
    console.error('   Attempting to navigate to homepage to verify...');

    // Try navigating to homepage to see if we're logged in
    try {
      await page.goto('https://www.edgeprop.sg', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanPause(3000, 5000);

      // Check again after navigation
      const bookmarkAfterNav = await page.locator('[href*="/bookmarks"]').first().isVisible({ timeout: 5000 }).catch(() => false);
      if (bookmarkAfterNav) {
        console.log('   ✅ Login verified after navigation!');
        stillLoggedIn = true;
      } else {
        throw new Error('Authentication failed - no login indicators found even after navigation');
      }
    } catch (navError) {
      throw new Error('Authentication failed - could not verify login status');
    }
  } else if (stillLoggedIn || sessionCookieNames.length > 0 || mightBeLoggedIn) {
    console.log('✅ Login appears successful - proceeding to save state');
  }

  const stateFilePath = path.join(storagePath, 'ep.state.json');
  await context.storageState({ path: stateFilePath });

  const stateStatus = inspectAuthState('edgeprop');
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
authenticateEdgeProp().catch((error: unknown) => {
  console.error('❌ Error during authentication:', error);
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (errorMessage.includes('Flaresolverr')) {
    console.error('   💡 Start FlareSolverr locally before retrying authentication.');
  } else if (errorMessage.includes('playwright install')) {
    console.error('   💡 Install browser binaries before retrying authentication.');
  }
  process.exit(1);
});
