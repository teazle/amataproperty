import { config } from 'dotenv';
import path from 'path';

// Load environment variables - try .env first, then .env.local
config({ path: path.resolve(process.cwd(), '.env') });
config({ path: path.resolve(process.cwd(), '.env.local') });

import { chromium } from 'playwright-ghost';
import plugins from 'playwright-ghost/plugins';
import fs from 'fs';
import { CHROME_UA, humanPause } from './stealth';
import { solveCloudflareWithFlaresolverr, applyFlaresolverrToContext } from './flaresolverr';

async function authenticateEdgeProp() {
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
    const flaresolverrResult = await solveCloudflareWithFlaresolverr(homepageUrl, false);
    
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
      await page.goto(homepageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Wait for page to be interactive - check for body or main content
      await Promise.race([
        page.waitForSelector('body', { state: 'visible', timeout: 10000 }).catch(() => null),
        page.waitForSelector('main, [role="main"], header', { timeout: 10000 }).catch(() => null),
        new Promise(resolve => setTimeout(resolve, 5000)) // Fallback timeout
      ]);
      
      await humanPause(2000, 3000);
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
      // Click on Login button in header
      console.log('🔍 Clicking Login button...');
      await page.locator('div').filter({ hasText: /^Login$/ }).nth(1).click();
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

      // Click the Login button
      console.log('🔑 Submitting login form...');
      await page.getByText('Login').nth(2).click();
      
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
  const currentUrl = page.url();
  if (!currentUrl.includes('edgeprop.sg') || currentUrl.includes('/user/login')) {
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
  const finalBookmarkCheck = page.locator('[href*="/bookmarks"], a:has-text("Bookmarks")').first();
  const stillLoggedIn = await finalBookmarkCheck.isVisible({ timeout: 5000 }).catch(() => false);
  
  // Also check for session cookies
  const allCookies = await context.cookies();
  const hasSessionCookie = allCookies.some(c => 
    c.name.includes('session') || 
    c.name.includes('auth') || 
    c.name.includes('token') ||
    c.name.includes('user') ||
    (c.name.includes('edgeprop') && !c.name.startsWith('_')) // Exclude analytics cookies
  );
  
  console.log(`🍪 Found ${allCookies.length} cookies`);
  console.log('   Cookie names:', allCookies.map(c => c.name).join(', '));
  
  if (!stillLoggedIn && !hasSessionCookie) {
    console.error('⚠️  Warning: Not logged in when trying to save state!');
    console.error('   No bookmark link found and no session cookies detected.');
    console.error('   Only analytics cookies found - authentication may have failed.');
    
    // Try one more time - wait a bit and check again
    await humanPause(5000, 6000);
    const finalCheck = page.locator('[href*="/bookmarks"], a:has-text("Bookmarks")').first();
    const finalLoggedIn = await finalCheck.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!finalLoggedIn) {
      throw new Error('Authentication failed - no session cookies or login indicators found after dialog click');
    }
  }
  
  const stateFilePath = path.join(storagePath, 'ep.state.json');
  await context.storageState({ path: stateFilePath });
  
  console.log(`💾 Authentication state saved to: ${stateFilePath}`);
  console.log('✨ You can now use this state for automated browsing sessions');

  await browser.close();
  console.log('🔚 Browser closed');
}

// Run the authentication flow
authenticateEdgeProp().catch((error: unknown) => {
  console.error('❌ Error during authentication:', error);
  process.exit(1);
});

