import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function authenticateEdgeProp() {
  console.log('🚀 Launching Chromium browser for manual login...');
  
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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

  // Navigate to EdgeProp login page
  await page.goto('https://www.edgeprop.sg/user/login');
  console.log('📄 Navigated to EdgeProp login page');
  console.log('⏳ Please complete the login manually...');

  // Wait for either 2 minutes or until user avatar/My Account is visible
  const timeout = 2 * 60 * 1000; // 2 minutes
  
  try {
    // Wait for potential selectors that indicate successful login
    // Common selectors for user account/avatar - adjust if needed
    await Promise.race([
      page.waitForSelector('[data-testid="user-menu"]', { timeout }),
      page.waitForSelector('.user-avatar', { timeout }),
      page.waitForSelector('text=My Account', { timeout }),
      page.waitForSelector('[aria-label*="account" i]', { timeout }),
      page.waitForSelector('.logged-in', { timeout }),
      new Promise((resolve) => setTimeout(resolve, timeout))
    ]);

    console.log('✅ Login detected (or timeout reached)');
  } catch (_error) {
    console.log('⏱️ Timeout reached - proceeding to save state...');
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

