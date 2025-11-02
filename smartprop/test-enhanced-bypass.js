const { chromium } = require('playwright');

/**
 * Test script for enhanced Cloudflare bypass
 */
async function testEnhancedCloudflareBypass() {
  console.log('🧪 Testing Enhanced Cloudflare Bypass...');
  
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--exclude-switches=enable-automation',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
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
      '--disable-ipc-flooding-protection'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 },
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-SG,en;q=0.9,en-US;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"'
    }
  });
  
  // Enhanced stealth script
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    window.chrome = {
      runtime: {
        onConnect: undefined,
        onMessage: undefined,
      },
      app: {
        isInstalled: false,
      }
    };
    
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-SG', 'en', 'en-US'],
    });
    
    Object.defineProperty(navigator, 'platform', {
      get: () => 'MacIntel',
    });
    
    // Remove automation indicators
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    delete window.__webdriver_evaluate;
    delete window.__webdriver_script_function;
    
    // Mock __name function for EdgeProp
    if (typeof window.__name === 'undefined') {
      window.__name = function() { return ''; };
    }
  });
  
  const page = await context.newPage();
  
  // Test URLs - start with listing page, then try article pages
  const testUrls = [
    'https://www.edgeprop.sg/property-news/latest',
    'https://www.edgeprop.sg/property-news/singapore-property-market-outlook-2025-what-expect',
    'https://www.edgeprop.sg/property-news/singapore-private-home-prices-rise-09-3q2024'
  ];
  
  for (const url of testUrls) {
    console.log(`\n🌐 Testing URL: ${url}`);
    
    try {
      console.log('📍 Navigating to URL...');
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 
      });
      
      console.log('⏳ Waiting for page to stabilize...');
      await page.waitForTimeout(5000);
      
      // Enhanced Cloudflare detection
      const pageAnalysis = await page.evaluate(() => {
        const content = document.documentElement.innerHTML;
        const text = document.body.textContent || '';
        const title = document.title;
        
        const cloudflareIndicators = [
          content.includes('cf-browser-verification'),
          content.includes('checking-your-browser'),
          content.includes('Just a moment'),
          content.includes('DDoS protection by Cloudflare'),
          content.includes('cf-challenge'),
          text.includes('Verifying you are human'),
          text.includes('Checking if the site connection is secure'),
          title.includes('Just a moment'),
          title.includes('Checking your browser')
        ];
        
        const hasCloudflare = cloudflareIndicators.some(indicator => indicator);
        
        // Check for actual EdgeProp content
        const hasRealContent = [
          document.querySelector('article'),
          document.querySelector('main'),
          document.querySelector('[class*="content"]'),
          document.querySelector('.jsx-4217446631'),
          document.querySelector('.jsx-2128998887')
        ].some(el => el !== null);
        
        const textLength = text.length;
        const hasEdgePropBranding = content.includes('edgeprop') || content.includes('EdgeProp');
        
        return {
          hasCloudflare,
          hasRealContent,
          textLength,
          hasEdgePropBranding,
          title: title.substring(0, 100),
          firstParagraph: text.substring(0, 200)
        };
      });
      
      console.log(`📊 Page Analysis:`);
      console.log(`   - Cloudflare detected: ${pageAnalysis.hasCloudflare}`);
      console.log(`   - Real content: ${pageAnalysis.hasRealContent}`);
      console.log(`   - Text length: ${pageAnalysis.textLength}`);
      console.log(`   - EdgeProp branding: ${pageAnalysis.hasEdgePropBranding}`);
      console.log(`   - Title: "${pageAnalysis.title}"`);
      console.log(`   - First text: "${pageAnalysis.firstParagraph}"`);
      
      if (pageAnalysis.hasCloudflare) {
        console.log('🛡️ Cloudflare challenge detected, attempting bypass...');
        
        // Enhanced iframe detection
        const iframes = await page.$$('iframe');
        console.log(`🔍 Found ${iframes.length} iframe(s)`);
        
        for (let i = 0; i < iframes.length; i++) {
          const iframe = iframes[i];
          
          try {
            const iframeInfo = await iframe.evaluate((el, index) => {
              const rect = el.getBoundingClientRect();
              return {
                index,
                src: el.src || '',
                id: el.id || '',
                className: el.className || '',
                width: rect.width,
                height: rect.height,
                isVisible: rect.width > 0 && rect.height > 0
              };
            }, i);
            
            console.log(`   ${i + 1}. src="${iframeInfo.src.substring(0, 60)}", visible=${iframeInfo.isVisible}, size=${iframeInfo.width}x${iframeInfo.height}`);
            
            if (iframeInfo.isVisible && iframeInfo.width > 200 && iframeInfo.height > 100) {
              console.log(`   🎯 Attempting to interact with iframe ${i + 1}...`);
              
              const frame = await iframe.contentFrame();
              if (frame) {
                await frame.waitForTimeout(3000);
                
                // Try to find and click challenge elements
                const challengeSelectors = [
                  'input[type="checkbox"]',
                  'button[type="submit"]',
                  '[role="button"]',
                  'label',
                  '.cb-lb'
                ];
                
                for (const selector of challengeSelectors) {
                  try {
                    const element = await frame.$(selector);
                    if (element) {
                      const isVisible = await element.isVisible();
                      if (isVisible) {
                        console.log(`   ✅ Found and clicking: ${selector}`);
                        await element.click();
                        await page.waitForTimeout(8000);
                        break;
                      }
                    }
                  } catch (e) {
                    // Continue to next selector
                  }
                }
              }
            }
          } catch (e) {
            console.log(`   ⚠️ Error analyzing iframe ${i + 1}: ${e.message}`);
          }
        }
        
        // Wait and re-check
        console.log('⏳ Waiting for challenge resolution...');
        await page.waitForTimeout(10000);
        
        const finalCheck = await page.evaluate(() => {
          const content = document.documentElement.innerHTML;
          const text = document.body.textContent || '';
          
          const stillHasCloudflare = [
            content.includes('cf-browser-verification'),
            content.includes('checking-your-browser'),
            text.includes('Verifying you are human'),
            text.includes('Just a moment')
          ].some(indicator => indicator);
          
          const hasContent = [
            document.querySelector('article'),
            document.querySelector('main'),
            document.querySelector('[class*="content"]')
          ].some(el => el !== null);
          
          return {
            stillHasCloudflare,
            hasContent,
            textLength: text.length
          };
        });
        
        if (finalCheck.stillHasCloudflare) {
          console.log('❌ Cloudflare bypass failed');
        } else if (finalCheck.hasContent && finalCheck.textLength > 1000) {
          console.log('✅ Cloudflare bypass successful!');
        } else {
          console.log('⚠️ Cloudflare bypassed but content may not be fully loaded');
        }
        
      } else if (pageAnalysis.hasRealContent && pageAnalysis.textLength > 1000) {
        console.log('✅ Page loaded successfully without Cloudflare challenge');
      } else {
        console.log('⚠️ Page loaded but content appears incomplete');
      }
      
      // Take a screenshot for visual verification
      const screenshotPath = `/Users/vincent/propertydemo/test-screenshot-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
      
    } catch (error) {
      console.error(`❌ Error testing ${url}:`, error.message);
    }
    
    console.log('⏳ Waiting before next test...');
    await page.waitForTimeout(5000);
  }
  
  await browser.close();
  console.log('🏁 Test completed');
}

// Run the test
testEnhancedCloudflareBypass().catch(console.error);