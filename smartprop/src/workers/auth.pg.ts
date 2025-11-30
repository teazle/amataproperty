import { chromium } from 'playwright-ghost';
import plugins from 'playwright-ghost/plugins';
import path from 'path';
import fs from 'fs';
import { solveCloudflareWithFlaresolverr, applyFlaresolverrToContext, FLARESOLVERR_UA } from './flaresolverr.js';
import { humanPause } from './stealth.js';

async function authenticatePropertyGuru() {
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
  
  // Use playwright-ghost with recommended plugins for best stealth (same as main scraper)
  const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-site-isolation-trials',
    '--disable-extensions',
    '--disable-breakpad', // avoid crashpad traps on low-memory hosts
    '--no-zygote',
    '--disable-component-update',
    // macOS headless mode requires --disable-gpu
    ...(isHeadless ? ['--disable-gpu'] : []),
  ];

  async function launchBrowserWithFallback() {
    // Try with plugins first (best stealth)
    try {
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
        args: launchArgs,
        timeout: 30000 // 30 second timeout
      });
      // Verify browser is actually usable
      await browser.version();
      return browser;
    } catch (err) {
      console.log('⚠️  Primary browser launch (ghost plugins) failed, retrying without plugins...', err instanceof Error ? err.message : String(err));
      
      // Retry without plugins and with single-process to reduce crash risk
      try {
        const browser = await chromium.launch({
          headless: isHeadless,
          chromiumSandbox: false,
          args: [...launchArgs, '--single-process', '--disable-software-rasterizer'],
          timeout: 30000
        });
        // Verify browser is actually usable
        await browser.version();
        return browser;
      } catch (err2) {
        console.log('⚠️  Fallback browser launch also failed, trying minimal config...', err2 instanceof Error ? err2.message : String(err2));
        // Last resort: minimal config
        return await chromium.launch({
          headless: isHeadless,
          chromiumSandbox: false,
    args: [
            '--no-sandbox',
      '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--disable-software-rasterizer',
            '--disable-breakpad',
            '--no-zygote',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            `--user-data-dir=${customTempDir}/pg-auth-browser-${Date.now()}`, // Use custom temp dir
          ],
          timeout: 30000
        });
      }
    }
  }

  const browser = await launchBrowserWithFallback();

  const context = await browser.newContext({
    // Don't set userAgent explicitly - let playwright-ghost handle it for better stealth
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 }, // Singapore coordinates
    colorScheme: 'light',
    // Enhanced HTTP headers matching Flaresolverr's browser
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

  const loginUrl = 'https://www.propertyguru.com.sg/login';
  
  // Try navigating first to see the actual Cloudflare challenge
  console.log('📄 Navigating to PropertyGuru login page to check Cloudflare status...');
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await humanPause(2000, 3000);
  
  // Check if page is blocked by Cloudflare
  const initialPageText = await page.textContent('body').catch(() => '') || '';
  const isBlocked = initialPageText.includes('Just a moment') || 
                    initialPageText.includes('Pardon Our Interruption') ||
                    initialPageText.includes('Verify you are human') ||
                    initialPageText.length < 10000;
  
  let flaresolverrSucceeded = false;
  if (isBlocked) {
    console.log('   🛡️  Cloudflare detected, using Flaresolverr to solve...');
    try {
      // Use Flaresolverr to solve Cloudflare on the current page
      // Navigate to the current URL to get fresh cookies
      const flaresolverrResult = await solveCloudflareWithFlaresolverr(page.url(), false);
    
    if (flaresolverrResult && flaresolverrResult.cookies.length > 0) {
      await applyFlaresolverrToContext(context, flaresolverrResult);
        flaresolverrSucceeded = true;
      
      // Save Cloudflare cookies immediately (will be overwritten with full auth state after login)
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
      
        // Reload the page with the new cookies
        console.log('   🔄 Reloading page with Flaresolverr cookies...');
        await page.reload({ waitUntil: 'load', timeout: 60000 });
        await humanPause(3000, 5000);
      } else {
        console.log('   ⚠️  Flaresolverr returned no cookies - page may be blocked');
    }
  } catch (error) {
      console.log('   ⚠️  Flaresolverr failed, will check if page is blocked...', error instanceof Error ? error.message : String(error));
    }
  } else {
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
        'Verification successful'
      ];
      
      const hasCloudflare = cloudflareIndicators.some(indicator => 
        pageContent.includes(indicator) || pageText.includes(indicator)
      );
      
      if (hasCloudflare || pageLength < 10000) {
        console.log('   🛡️  Cloudflare challenge still present after waiting 60+ seconds!');
        console.log(`   📄 Page content preview: ${pageText.substring(0, 200)}...`);
        if (cfCookiesAfterNav.length === 0) {
          throw new Error('Cloudflare challenge still present after Flaresolverr bypass. No Cloudflare cookies found in context - cookies may not have been applied correctly.');
        } else {
          throw new Error('Cloudflare challenge still present after Flaresolverr bypass and 60+ second wait. Cookies are present but page is still blocked - Flaresolverr cookies may be invalid or expired.');
        }
      }
      
      throw new Error('Login form not found after 60+ seconds of waiting, but page does not appear to be blocked by Cloudflare.');
    }
    
    // Verify cookies are still present after navigation
    const cookiesAfterNav = await context.cookies();
    const cfCookiesAfterNav = cookiesAfterNav.filter((c: any) => 
      ['__cf_bm', 'cf_clearance', '__cfduid'].some(cfName => c.name.toLowerCase().includes(cfName.toLowerCase()))
    );
    console.log(`   📊 Cloudflare cookies after navigation: ${cfCookiesAfterNav.length}`);
  } else {
    // Flaresolverr failed - check immediately
    const pageContent = await page.content().catch(() => '') || '';
  const pageText = await page.textContent('body').catch(() => '') || '';
    const pageLength = pageText.length;
    
    console.log(`   📊 Page content length: ${pageLength}`);
    
    // CRITICAL: If Flaresolverr failed AND page is blocked, fail immediately
    if (pageLength < 10000) {
      console.log(`   🛡️  Flaresolverr failed AND page is blocked (${pageLength} chars) - cannot proceed`);
      throw new Error(`Flaresolverr failed and page is blocked (${pageLength} chars). Cannot proceed without Cloudflare bypass.`);
    }
    
    // Check for Cloudflare indicators
    const cloudflareIndicators = [
      'Just a moment...',
      'Pardon Our Interruption',
      'Checking your browser',
      'Just a moment',
      'challenge-platform',
      'cf-browser-verification',
      'cf-im-under-attack'
    ];
    
    const hasCloudflare = cloudflareIndicators.some(indicator => 
      pageContent.includes(indicator) || pageText.includes(indicator)
    );
    
    if (hasCloudflare) {
      console.log('   🛡️  Cloudflare challenge detected after navigation!');
      console.log(`   📄 Page content preview: ${pageText.substring(0, 200)}...`);
      throw new Error('Cloudflare detected after navigation. Flaresolverr failed or page is still blocked.');
    }
  }
  
  // Check if page is too small (likely blocked or not loaded)
  // Normal PropertyGuru login pages are 15k+ characters. Pages under 10k are likely blocked.
  if (pageLength < 10000) {
    console.log(`   ⚠️  Page content is very small (${pageLength} chars) - likely blocked or not loaded`);
    console.log(`   📄 Page content preview: ${pageText.substring(0, 500)}...`);
    
    // Wait a bit longer and check again
    await page.waitForTimeout(10000);
    const newPageContent = await page.content().catch(() => '') || '';
    const newPageText = await page.textContent('body').catch(() => '') || '';
    const newPageLength = newPageText.length;
    
    console.log(`   📊 Page content length after wait: ${newPageLength}`);
    
    // Check for Cloudflare again
    const stillHasCloudflare = cloudflareIndicators.some(indicator => 
      newPageContent.includes(indicator) || newPageText.includes(indicator)
    );
    
    if (stillHasCloudflare || newPageLength < 10000) {
      console.log(`   🛡️  Cloudflare challenge still present or page still too small`);
      throw new Error('Cloudflare challenge still present after wait. Page is blocked.');
    }
  }
  
  // Check for login form
  const hasLoginForm = await page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').count().catch(() => 0) > 0;
  const hasPropertyContent = pageLength > 10000 || pageText.includes('Login') || pageText.includes('Sign in');
  
  if (!hasLoginForm && !hasPropertyContent) {
    console.log('⏳ Login form not found, waiting for page to load...');
    await page.waitForTimeout(10000);
    
    // Final check
    const finalPageText = await page.textContent('body').catch(() => '') || '';
    const finalHasLoginForm = await page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').count().catch(() => 0) > 0;
    
    if (!finalHasLoginForm && finalPageText.length < 10000) {
      console.log(`   ⚠️  Still no login form and page is small (${finalPageText.length} chars)`);
      throw new Error('Login form not found and page appears to be blocked or not loaded properly.');
    }
  }

  if (isAutomated) {
    console.log('\n🤖 Performing automated login...');
    
    // Wait for login form to load
    await humanPause(2000, 3000);
    
    // Final Cloudflare check before attempting login
    const finalPageContent = await page.content().catch(() => '') || '';
    const finalPageText = await page.textContent('body').catch(() => '') || '';
    if (finalPageContent.includes('Just a moment...') || 
        finalPageContent.includes('Pardon Our Interruption') ||
        finalPageText.includes('Checking your browser') ||
        finalPageText.includes('Just a moment')) {
      console.log('   🛡️  Cloudflare challenge detected before login!');
      throw new Error('Cloudflare challenge detected - page not loading properly');
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
      if (currentText.includes('Pardon Our Interruption') || currentText.includes('Checking your browser')) {
        throw new Error('Cloudflare challenge blocking login page');
      }
      throw error;
    }
    
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    await emailInput.click({ timeout: 30000 });
    await humanPause(200, 400);
    await emailInput.fill(email, { delay: 50 + Math.random() * 50 }); // Human-like typing speed
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
      if (pageContent.includes('Checking your browser') || pageContent.includes('Just a moment')) {
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
    await passwordInput.fill(password, { delay: 50 + Math.random() * 50 }); // Human-like typing speed
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
  
  console.log(`💾 Authentication state saved to: ${stateFilePath}`);
  console.log('✨ You can now use this state for automated browsing sessions');

  await browser.close();
  console.log('🔚 Browser closed');
}

// Run the authentication flow
authenticatePropertyGuru().catch((error: unknown) => {
  console.error('❌ Error during authentication:', error);
  process.exit(1);
});

