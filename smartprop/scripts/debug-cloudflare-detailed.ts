#!/usr/bin/env tsx

/**
 * Detailed Cloudflare and page structure analysis
 */

async function debugCloudflareDetailed() {
  console.log('🔍 Detailed Cloudflare and page analysis...\n');
  
  try {
    const { chromium } = await import('playwright');
    
    const browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();
    
    console.log('📄 Navigating to EdgeProp property news...');
    await page.goto('https://www.edgeprop.sg/property-news', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    // Wait a bit for any dynamic content
    await page.waitForTimeout(3000);
    
    console.log('\n🔍 Page Analysis:');
    
    const pageInfo = await page.evaluate(() => {
      const title = document.title;
      const url = window.location.href;
      const bodyText = document.body.textContent || '';
      
      // Check for Cloudflare indicators
      const cloudflareIndicators = {
        titleContainsCloudflare: title.toLowerCase().includes('cloudflare'),
        bodyContainsCloudflare: bodyText.toLowerCase().includes('cloudflare'),
        bodyContainsChallenge: bodyText.toLowerCase().includes('challenge'),
        bodyContainsVerifying: bodyText.toLowerCase().includes('verifying'),
        bodyContainsChecking: bodyText.toLowerCase().includes('checking'),
        bodyContainsJustMoment: bodyText.toLowerCase().includes('just a moment'),
        bodyContainsHuman: bodyText.toLowerCase().includes('human'),
        hasCloudflareScript: !!document.querySelector('script[src*="cloudflare"]'),
        hasCloudflareDiv: !!document.querySelector('div[class*="cloudflare"]'),
        hasChallengeForm: !!document.querySelector('form[action*="challenge"]')
      };
      
      // Look for iframes
      const iframes = Array.from(document.querySelectorAll('iframe')).map(iframe => ({
        src: iframe.src,
        id: iframe.id,
        className: iframe.className,
        title: iframe.title
      }));
      
      // Look for checkboxes
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).map(cb => {
        const checkbox = cb as HTMLInputElement;
        return {
          id: checkbox.id,
          className: checkbox.className,
          name: checkbox.name,
          checked: checkbox.checked,
          visible: checkbox.offsetParent !== null,
          enabled: !checkbox.disabled
        };
      });
      
      // Look for article links
      const articleLinks = Array.from(document.querySelectorAll('a[href*="/property-news/"]')).map(link => ({
        href: link.getAttribute('href'),
        text: link.textContent?.trim().substring(0, 50),
        hasImage: !!link.querySelector('img')
      }));
      
      // Look for any links that might be articles
      const allLinks = Array.from(document.querySelectorAll('a[href]')).filter(link => {
        const href = link.getAttribute('href') || '';
        const text = link.textContent?.trim() || '';
        return text.length > 15 && !text.toLowerCase().includes('search');
      }).slice(0, 10).map(link => ({
        href: link.getAttribute('href'),
        text: link.textContent?.trim().substring(0, 50)
      }));
      
      return {
        title,
        url,
        bodyTextLength: bodyText.length,
        bodyTextPreview: bodyText.substring(0, 200),
        cloudflareIndicators,
        iframes,
        checkboxes,
        articleLinks,
        allLinks
      };
    });
    
    console.log(`   Title: ${pageInfo.title}`);
    console.log(`   URL: ${pageInfo.url}`);
    console.log(`   Body text length: ${pageInfo.bodyTextLength}`);
    console.log(`   Body preview: "${pageInfo.bodyTextPreview}"`);
    
    console.log('\n🔒 Cloudflare Indicators:');
    Object.entries(pageInfo.cloudflareIndicators).forEach(([key, value]) => {
      console.log(`   ${key}: ${value ? '✅' : '❌'}`);
    });
    
    console.log(`\n🖼️ Iframes found: ${pageInfo.iframes.length}`);
    pageInfo.iframes.forEach((iframe, index) => {
      console.log(`   ${index + 1}. src: ${iframe.src}`);
      console.log(`      id: ${iframe.id}, class: ${iframe.className}`);
    });
    
    console.log(`\n☑️ Checkboxes found: ${pageInfo.checkboxes.length}`);
    pageInfo.checkboxes.forEach((cb, index) => {
      console.log(`   ${index + 1}. id: ${cb.id}, visible: ${cb.visible}, enabled: ${cb.enabled}`);
    });
    
    console.log(`\n📰 Article links (/property-news/): ${pageInfo.articleLinks.length}`);
    pageInfo.articleLinks.forEach((link, index) => {
      console.log(`   ${index + 1}. "${link.text}"`);
      console.log(`      ${link.href}`);
    });
    
    console.log(`\n🔗 All potential links: ${pageInfo.allLinks.length}`);
    pageInfo.allLinks.forEach((link, index) => {
      console.log(`   ${index + 1}. "${link.text}"`);
      console.log(`      ${link.href}`);
    });
    
    // Take a screenshot
    await page.screenshot({ path: 'cloudflare-debug.png', fullPage: true });
    console.log('\n📸 Screenshot saved: cloudflare-debug.png');
    
    // If there's a Cloudflare challenge, try to handle it
    if (Object.values(pageInfo.cloudflareIndicators).some(v => v)) {
      console.log('\n🚫 Cloudflare challenge detected! Attempting detailed bypass...');
      
      // Look for checkboxes in iframes
      for (const iframe of pageInfo.iframes) {
        if (iframe.src) {
          console.log(`\n🔍 Checking iframe: ${iframe.src}`);
          
          try {
            const iframeElement = await page.frameLocator(`iframe[src="${iframe.src}"]`);
            
            // Look for checkboxes in this iframe
            const checkboxSelectors = [
              'input[type="checkbox"]',
              '[role="checkbox"]',
              '.cf-turnstile',
              '#cf-challenge-running',
              '.challenge-form input'
            ];
            
            for (const selector of checkboxSelectors) {
              try {
                const checkbox = iframeElement.locator(selector);
                const count = await checkbox.count();
                if (count > 0) {
                  console.log(`   Found ${count} elements with selector: ${selector}`);
                  
                  // Try to click the first one
                  await checkbox.first().click();
                  console.log(`   ✅ Clicked checkbox in iframe`);
                  
                  // Wait a bit
                  await page.waitForTimeout(2000);
                  break;
                }
              } catch (error) {
                // Continue to next selector
              }
            }
          } catch (error) {
            console.log(`   ❌ Could not access iframe: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      
      // Wait for potential redirect or content load
      await page.waitForTimeout(5000);
      
      // Check if we're still on the same page or redirected
      const finalUrl = page.url();
      console.log(`\n🔄 Final URL: ${finalUrl}`);
      
      // Take another screenshot
      await page.screenshot({ path: 'after-cloudflare-bypass.png', fullPage: true });
      console.log('📸 After-bypass screenshot saved: after-cloudflare-bypass.png');
    }
    
    await browser.close();
    
  } catch (error) {
    console.error('\n❌ Debug failed:', error);
  }
}

// Run the debug
debugCloudflareDetailed().catch(console.error);