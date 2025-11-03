import { config } from 'dotenv';
import path from 'path';

// Load environment variables - try .env first, then .env.local
config({ path: path.resolve(process.cwd(), '.env') });
config({ path: path.resolve(process.cwd(), '.env.local') });

import { chromium } from 'playwright';
import fs from 'fs';
import { CHROME_UA, humanPause } from './stealth';

async function authenticateEdgeProp() {
  // Get credentials from environment variables
  const email = process.env.EP_EMAIL;
  const password = process.env.EP_PASSWORD;
  
  if (!email || !password) {
    throw new Error('EP_EMAIL and EP_PASSWORD must be set in .env.local');
  }
  
  console.log('🚀 Launching Chromium browser for automated login...');
  console.log(`📧 Logging in as: ${email}`);
  
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ]
  });

  const context = await browser.newContext({
    userAgent: CHROME_UA,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 }, // Singapore coordinates
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': 'en-SG,en;q=0.9',
    }
  });

  // Remove automation indicators
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
  });

  const page = await context.newPage();

  try {
    // Navigate to EdgeProp homepage
    console.log('📄 Navigating to EdgeProp homepage...');
    await page.goto('https://www.edgeprop.sg/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanPause(3000, 5000);

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
      await humanPause(2000, 3000);
      
      // Check for any popup/dialog about logging out from other device
      try {
        const logoutDialog = page.locator('text=/signed out elsewhere|simultaneous sessions/i');
        const dialogVisible = await logoutDialog.isVisible({ timeout: 3000 }).catch(() => false);
        
        if (dialogVisible) {
          console.log('⚠️  Detected multi-session warning dialog, clicking LOGIN...');
          
          // Try to find and click the LOGIN button (uppercase)
          const confirmButton = page.locator('text=LOGIN').first();
          const buttonVisible = await confirmButton.isVisible({ timeout: 2000 }).catch(() => false);
          
          if (buttonVisible) {
            await confirmButton.click();
            await humanPause(2000, 3000);
          } else {
            console.log('⚠️  Could not find LOGIN button, trying to press Enter...');
            await page.keyboard.press('Enter');
            await humanPause(1500, 2000);
          }
        }
      } catch (e) {
        // No dialog, continue
      }
      
      // Final check for successful login
      try {
        await page.locator('[href="/bookmarks"]').waitFor({ state: 'visible', timeout: 10000 });
        console.log('✅ Login successful!');
      } catch (e) {
        console.log('⚠️  Login check timed out, proceeding anyway...');
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

  // Save the storage state
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

