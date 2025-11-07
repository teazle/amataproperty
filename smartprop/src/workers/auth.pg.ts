import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { solveCloudflareWithFlaresolverr, applyFlaresolverrToContext, FLARESOLVERR_UA } from './flaresolverr.js';
import { humanPause } from './stealth.js';

async function authenticatePropertyGuru() {
  const email = process.env.PG_EMAIL;
  const password = process.env.PG_PASSWORD;
  const isAutomated = email && password;

  if (isAutomated) {
    console.log('🚀 Launching Chromium browser for automated login...');
    console.log(`📧 Email: ${email}`);
  } else {
    console.log('🚀 Launching Chromium browser for manual login...');
  }
  
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ]
  });

  const context = await browser.newContext({
    userAgent: FLARESOLVERR_UA, // Match Flaresolverr's user-agent
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

  // Enhanced stealth script matching EdgeProp scraper (works on EC2)
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
      (parameters as PermissionDescriptor & { name: string }).name === 'notifications' ?
        Promise.resolve({ state: Notification.permission } as PermissionStatus) :
        originalQuery(parameters)
    );
    
    // Mock plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Mock mimeTypes
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Override getBattery
    if ('getBattery' in navigator && typeof (navigator as any).getBattery === 'function') {
      (navigator as any).getBattery = () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1
      });
    }
  });

  const page = await context.newPage();

  const loginUrl = 'https://www.propertyguru.com.sg/login';
  
  try {
    // Use Flaresolverr to solve Cloudflare before navigating
    const flaresolverrResult = await solveCloudflareWithFlaresolverr(loginUrl, true);
    
    if (flaresolverrResult && flaresolverrResult.cookies.length > 0) {
      await applyFlaresolverrToContext(context, flaresolverrResult);
      await humanPause(500, 1000);
    }
  } catch (error) {
    console.log('   ⚠️  Flaresolverr failed, continuing without it...');
  }

  // Navigate to PropertyGuru login page
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('📄 Navigated to PropertyGuru login page');
  
  // Wait for Cloudflare to auto-resolve (datacenter IPs need more time)
  await humanPause(3000, 5000);
  const pageText = await page.textContent('body').catch(() => '') || '';
  const hasLoginForm = await page.locator('input[type="email"], input[name="email"]').count().catch(() => 0) > 0;
  const hasPropertyContent = pageText.length > 10000 || pageText.includes('Login') || pageText.includes('Sign in');
  
  if (!hasLoginForm && !hasPropertyContent) {
    // Might be Cloudflare challenge - wait longer
    console.log('⏳ Waiting for Cloudflare to resolve...');
    await page.waitForTimeout(15000);
  }

  if (isAutomated) {
    console.log('\n🤖 Performing automated login...');
    
    // Wait for login form to load
    await page.waitForTimeout(2000);
    
    // Step 1: Fill in email
    console.log('   📧 Entering email...');
    await page.fill('input[type="email"], input[name="email"], input[placeholder*="email" i]', email);
    console.log('   ✅ Email entered');
    await page.waitForTimeout(800);
    
    // Click Continue button to go to password page
    console.log('   🔄 Clicking Continue...');
    await page.click('button:has-text("Continue"), button[type="submit"]');
    console.log('   ⏳ Waiting for password page...');
    await page.waitForTimeout(3000);
    
    // Step 2: Fill in password
    console.log('   🔑 Entering password...');
    await page.fill('input[type="password"], input[name="password"]', password);
    console.log('   ✅ Password entered');
    await page.waitForTimeout(800);
    
    // Click login/submit button
    console.log('   🔄 Submitting login...');
    await page.click('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")');
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

