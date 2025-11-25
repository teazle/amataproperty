import { chromium } from 'playwright-ghost';
import * as path from 'path';
import * as fs from 'fs';
import plugins from 'playwright-ghost/plugins';

async function openNopeCHASetup() {
  const extensionsDir = path.resolve(process.cwd(), 'extensions');
  const nopechaDir = path.resolve(extensionsDir, 'nopecha');

  // Check if extension exists
  if (!fs.existsSync(path.join(nopechaDir, 'manifest.json'))) {
    console.log('📥 Downloading NopeCHA extension...');
    const response = await fetch('https://github.com/NopeCHALLC/nopecha-extension/releases/latest/download/chromium.zip');
    const buffer = await response.arrayBuffer();
    const zipPath = path.join(extensionsDir, 'nopecha.zip');
    fs.writeFileSync(zipPath, Buffer.from(buffer));
    
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(nopechaDir, true);
    fs.unlinkSync(zipPath);
    console.log('✅ Extension downloaded');
  } else {
    console.log('✅ Extension already exists');
  }

  // Verify manifest
  const manifestPath = path.join(nopechaDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`   📋 Extension: ${manifest.name} v${manifest.version}`);

  // Get dynamic user agent (same as LinkedIn automation)
  const getUserAgent = async () => {
    try {
      const chromeVersion = '131.0.0.0';
      const osInfo = process.platform === 'darwin' 
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
      
      return `Mozilla/5.0 (${osInfo}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    } catch (e) {
      return undefined;
    }
  };

  const dynamicUserAgent = await getUserAgent();
  console.log(`🔒 Using enhanced stealth mode${dynamicUserAgent ? ' with dynamic user agent' : ''}`);
  
  // Build plugins array (same as LinkedIn automation)
  const pluginList: any[] = [
    ...plugins.recommended({
      humanize: {
        click: { delay: { min: 200, max: 600 } },
        cursor: false,
        dialog: { delay: { min: 800, max: 2000 } }
      }
    })
  ];
  
  // Add dynamic user agent plugin if available
  if (dynamicUserAgent) {
    try {
      pluginList.push(plugins.polyfill.userAgent({ userAgent: dynamicUserAgent }));
      console.log('   ✅ Dynamic user agent plugin enabled');
    } catch (e: any) {
      console.warn(`   ⚠️  Could not add user agent plugin: ${e.message}`);
    }
  }
  
  // Add fingerprint plugin to avoid detection (same as LinkedIn automation)
  try {
    pluginList.push(plugins.utils.fingerprint({
      fingerprintOptions: {
        devices: ['desktop'],
        operatingSystems: ['windows', 'macos', 'linux'],
        browsers: ['chrome']
      }
    }));
    console.log('   ✅ Fingerprint plugin enabled');
  } catch (e: any) {
    console.warn(`   ⚠️  Fingerprint plugin not available: ${e.message}`);
  }

  // Use persistent context which handles extensions better
  const userDataDir = path.join(process.cwd(), 'browser-data-nopecha');
  const absNopechaDir = path.resolve(nopechaDir);
  
  console.log('🚀 Launching browser with NopeCHA extension...');
  console.log(`   📁 Extension path: ${absNopechaDir}`);
  console.log(`   📁 User data dir: ${userDataDir}`);
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    plugins: pluginList,
    timeout: 120000,
    viewport: { width: 1920, height: 1080 },
    userAgent: dynamicUserAgent,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      // CRITICAL: Load extension with absolute path
      `--load-extension=${absNopechaDir}`,
      `--disable-extensions-except=${absNopechaDir}`,
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });
  
  // Wait for extension to load
  console.log('   ⏳ Waiting for extension to initialize (10 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  const page = context.pages()[0] || await context.newPage();

  // Check if extension is loaded
  console.log('🔍 Verifying extension is loaded...');
  try {
    const extensionsPage = await context.newPage();
    await extensionsPage.goto('chrome://extensions/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Enable developer mode
    try {
      const devModeToggle = extensionsPage.locator('#devMode').first();
      const isChecked = await devModeToggle.isChecked().catch(() => false);
      if (!isChecked) {
        await devModeToggle.check().catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (e) {
      // Ignore if can't toggle
    }
    
    const pageText = await extensionsPage.textContent('body').catch(() => '') || '';
    if (pageText.toLowerCase().includes('nopecha') || pageText.toLowerCase().includes('captcha solver')) {
      console.log('   ✅ NopeCHA extension is loaded!');
    } else {
      console.log('   ⚠️  Extension may not be loaded');
      console.log('   💡 Please check chrome://extensions/ manually');
      console.log('   💡 Look for "NopeCHA: CAPTCHA Solver" in the list');
    }
    await extensionsPage.close();
  } catch (e: any) {
    console.warn(`   ⚠️  Could not verify extension: ${e.message}`);
  }
  
  // Get API key from environment if available
  const nopechaApiKey = process.env.NOPECHA_API_KEY;
  
  console.log('🌐 Navigating to NopeCHA setup page...');
  
  // Always navigate with hash - use API key if available, or "free" for free tier
  const hashValue = nopechaApiKey || 'free';
  const setupUrl = `https://nopecha.com/setup#${hashValue}`;
  
  if (nopechaApiKey) {
    console.log('   🔑 Using API key from NOPECHA_API_KEY environment variable');
  } else {
    console.log('   💡 No API key set - using free tier (100 CAPTCHAs/day)');
    console.log('   💡 Navigating with #free hash for free tier setup');
  }
  
  await page.goto(setupUrl, { waitUntil: 'networkidle', timeout: 30000 });
  
  // Wait a moment for page to process the hash
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Check if page still shows error
  const pageText = await page.textContent('body').catch(() => '') || '';
  if (pageText.includes('Invalid URL') || pageText.includes('Please set the URL hash')) {
    console.log('');
    console.log('   ⚠️  Setup page still requires a valid hash');
    console.log('   📝 To fix this:');
    console.log('      1. Look at the browser address bar');
    if (nopechaApiKey) {
      console.log(`      2. The URL should be: https://nopecha.com/setup#${nopechaApiKey}`);
      console.log('      3. If it\'s different, manually update it and press Enter');
    } else {
      console.log('      2. Add your API key after # in the URL');
      console.log('      3. Example: https://nopecha.com/setup#YOUR_API_KEY');
      console.log('      4. Or for free tier, try: https://nopecha.com/setup#FREE');
      console.log('      5. Press Enter to reload the page');
    }
    console.log('');
  } else {
    console.log('   ✅ Setup page loaded successfully!');
  }

  console.log('');
  console.log('✅ Setup page loaded!');
  console.log('');
  if (nopechaApiKey) {
    console.log('✅ API key configured from environment variable');
  } else {
    console.log('You can now:');
    console.log('1. Enter your API key in the URL hash (e.g., https://nopecha.com/setup#YOUR_KEY)');
    console.log('2. Or set NOPECHA_API_KEY in your .env file and restart');
    console.log('3. Configure the extension settings');
  }
  console.log('4. The browser will stay open for 5 minutes');
  console.log('');
  console.log('Press Ctrl+C to close the browser when done...');

  // Keep browser open for 5 minutes
  await new Promise(resolve => setTimeout(resolve, 300000));
  await context.close();
}

openNopeCHASetup().catch(console.error);
