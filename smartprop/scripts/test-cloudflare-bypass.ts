import { chromium } from 'playwright';

async function testCloudflareBypass() {
  console.log('🚀 Testing Enhanced Cloudflare Bypass and Article Count...\n');
  
  const browser = await chromium.launch({
    headless: false, // Show browser for debugging
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-default-apps',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-field-trial-config',
      '--disable-back-forward-cache',
      '--disable-ipc-flooding-protection'
    ],
    channel: 'chromium'
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: { longitude: -74.0060, latitude: 40.7128 },
    permissions: ['geolocation']
  });

  const page = await context.newPage();

  try {
    console.log('📍 Navigating to EdgeProp latest news page...');
    await page.goto('https://www.edgeprop.sg/news/latest', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Enhanced Cloudflare detection and bypass
    let cloudflareResolved = false;
    for (let cfAttempt = 0; cfAttempt < 10 && !cloudflareResolved; cfAttempt++) {
      await page.waitForTimeout(Math.min(2000 + (cfAttempt * 1000), 8000));
      
      const pageContent = await page.content().catch(() => '');
      const pageTitle = await page.title().catch(() => '');
      
      // Enhanced Cloudflare detection patterns
      const isCloudflare = (pageContent.includes('cf-browser-verification') && pageContent.includes('cloudflare')) ||
        (pageContent.includes('checking-your-browser') && pageContent.includes('cloudflare')) ||
        (pageTitle.includes('Just a moment') && pageTitle.includes('Cloudflare')) ||
        pageContent.includes('cf-challenge-running') ||
        pageContent.includes('Verifying you are human') ||
        pageContent.includes('Please enable JavaScript') ||
        page.url().includes('challenge-platform.cloudflare.com');

      if (!isCloudflare) {
        // Verify actual EdgeProp content is loaded
        const hasContent = await page.evaluate(() => {
          const contentIndicators = [
            document.querySelector('.jsx-4217446631.article-detail.left-section'),
            document.querySelector('.jsx-2128998887.detail-content'),
            document.querySelector('main article'),
            document.querySelector('[class*="article"]'),
            document.querySelector('[class*="content"]'),
            document.querySelector('h1'),
            document.querySelector('p')
          ];
          
          const hasValidContent = contentIndicators.some(el => el && el.textContent && el.textContent.trim().length > 50);
          const bodyText = document.body?.textContent || '';
          const hasSubstantialText = bodyText.length > 500;
          
          return hasValidContent && hasSubstantialText;
        });
        
        if (hasContent) {
          cloudflareResolved = true;
          console.log(`✅ Cloudflare resolved, content loaded (attempt ${cfAttempt + 1})`);
          break;
        }
      }

      if (isCloudflare) {
        console.log(`⚠️ Cloudflare detected (attempt ${cfAttempt + 1}/10), implementing comprehensive bypass...`);
        
        // Wait for Cloudflare challenge iframe to load
        await page.waitForTimeout(3000);
        
        try {
          // Handle Cloudflare iframes with enhanced detection
          const iframes = await page.$$('iframe');
          console.log(`   🔍 Checking ${iframes.length} iframe(s) for Cloudflare checkbox...`);
          
          let iframeSuccess = false;
          for (const iframe of iframes) {
            const src = await iframe.getAttribute('src').catch(() => '');
            const id = await iframe.getAttribute('id').catch(() => '');
            const className = await iframe.getAttribute('class').catch(() => '');
            
            // Enhanced Cloudflare iframe detection
            const isCloudflareIframe = src && (
              src.includes('challenges.cloudflare.com') ||
              src.includes('cf-challenge') ||
              src.includes('cloudflare')
            ) || (id && (
              id.includes('cf-chl') || 
              id.includes('cf-challenge') ||
              id.includes('challenge')
            )) || (className && (
              className.includes('cf-challenge') || 
              className.includes('cf-chl') ||
              className.includes('challenge')
            ));

            if (isCloudflareIframe || iframes.length === 1) {
              console.log(`   🎯 Processing potential Cloudflare iframe: ${(src || '').substring(0, 50)}...`);
              
              try {
                const frame = await iframe.contentFrame();
                if (frame) {
                  // Wait for Cloudflare content to fully load
                  console.log(`   ⏳ Waiting for Cloudflare challenge content to load...`);
                  await page.waitForTimeout(4000);
                  
                  // Enhanced checkbox detection and clicking
                  const checkboxSelectors = [
                    'input[type="checkbox"]',
                    'input[type="checkbox"]#challenge-form',
                    'input[id*="challenge"]',
                    'input[name*="challenge"]',
                    'input[class*="checkbox"]',
                    '#cf-challenge-checkbox',
                    '.cb-lb input[type="checkbox"]',
                    'label[for*="challenge"] input',
                    'label[for*="challenge"]',
                    '[role="checkbox"]',
                    '.checkbox',
                    '.challenge-checkbox'
                  ];

                  for (const selector of checkboxSelectors) {
                    try {
                      await frame.waitForSelector(selector, { timeout: 2000 });
                      const checkbox = await frame.$(selector);
                      if (checkbox) {
                        const isVisible = await checkbox.isVisible().catch(() => false);
                        const isEnabled = await checkbox.isEnabled().catch(() => true);
                        const boundingBox = await checkbox.boundingBox().catch(() => null);
                        
                        console.log(`   🎯 Found element: ${selector}, visible: ${isVisible}, enabled: ${isEnabled}, box: ${!!boundingBox}`);
                        
                        if (isVisible && isEnabled && boundingBox) {
                          await checkbox.scrollIntoViewIfNeeded().catch(() => null);
                          await page.waitForTimeout(1000);
                          
                          console.log(`   ✅ Found checkbox in iframe with selector: ${selector}`);
                          await checkbox.click({ timeout: 5000, force: false });
                          await page.waitForTimeout(2000);
                          console.log(`   ✅ Clicked checkbox in iframe`);
                          iframeSuccess = true;
                          break;
                        }
                      }
                    } catch (selectorError) {
                      // Continue to next selector
                    }
                  }
                  
                  if (iframeSuccess) break;
                }
              } catch (frameError) {
                console.log(`   ⚠️ Error accessing iframe: ${frameError}`);
              }
            }
          }
          
          // Try direct page Cloudflare elements if iframe approach failed
          if (!iframeSuccess) {
            console.log(`   🔄 Trying direct page Cloudflare elements...`);
            const cloudflareSelectors = [
              'input[type="checkbox"]',
              'label[for*="challenge"]',
              'button[id*="challenge"]',
              '#challenge-form input[type="checkbox"]',
              '.cf-turnstile input[type="checkbox"]',
              '.ctp-checkbox-label',
              'button[class*="challenge"]',
              'label[class*="checkbox"]',
              '[data-callback*="challenge"]',
              '.challenge-form input',
              '.cloudflare-challenge input'
            ];

            for (const selector of cloudflareSelectors) {
              try {
                const element = await page.$(selector);
                if (element) {
                  const isVisible = await element.isVisible().catch(() => false);
                  if (isVisible) {
                    console.log(`   ✅ Found Cloudflare element: ${selector}`);
                    await element.scrollIntoViewIfNeeded().catch(() => null);
                    await element.click({ timeout: 3000 });
                    console.log(`   ✅ Clicked Cloudflare verification`);
                    await page.waitForTimeout(3000);
                    break;
                  }
                }
              } catch (directError) {
                // Continue to next selector
              }
            }
          }
          
          // Human-like behavior simulation
          console.log(`   🤖 Simulating human-like behavior...`);
          await page.mouse.move(Math.random() * 800 + 100, Math.random() * 600 + 100);
          await page.waitForTimeout(500);
          await page.evaluate(() => {
            window.scrollTo(0, Math.random() * 500);
          });
          await page.waitForTimeout(1000);
          
        } catch (clickError) {
          console.log(`   ⚠️ Error in Cloudflare bypass: ${clickError}`);
        }
      }
    }
    
    if (!cloudflareResolved) {
      console.log('⚠️ Cloudflare challenge may persist after 10 attempts, but continuing...');
    }

    // Test article discovery and count
    console.log('\n📊 Testing article discovery...');
    
    const articles = await page.evaluate(() => {
      // Multiple strategies to find article containers
      const strategies = [
        () => Array.from(document.querySelectorAll('.jsx-4217446631.article-detail.left-section')),
        () => Array.from(document.querySelectorAll('.jsx-2128998887.detail-content')),
        () => Array.from(document.querySelectorAll('a[href*="/news/"]')).filter(link => {
          const anchorLink = link as HTMLAnchorElement;
          const img = link.querySelector('img');
          return img && anchorLink.href.includes('/news/') && !anchorLink.href.includes('#');
        })
      ];

      let containers: Element[] = [];
      for (const strategy of strategies) {
        containers = strategy();
        if (containers.length > 0) break;
      }

      console.log(`Found ${containers.length} article containers`);

      const uniqueHrefs = new Set<string>();
      const articles: Array<{href: string, title: string}> = [];

      containers.forEach((container) => {
          const link = container.tagName === 'A' ? container as HTMLAnchorElement : 
                      container.querySelector('a[href*="/news/"]') as HTMLAnchorElement;
          
          if (link && link.href) {
            const href = link.href;
          const normalizedHref = href.split('?')[0].split('#')[0];
          
          if (!uniqueHrefs.has(normalizedHref) && normalizedHref.includes('/news/')) {
            uniqueHrefs.add(normalizedHref);
            
            // Enhanced title extraction
            let title = '';
            
            // Try link text first
            if (link.textContent && link.textContent.trim().length > 10) {
              title = link.textContent.trim();
            }
            
            // Try heading elements
            if (!title || title.length < 10) {
              const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="headline"]');
              for (const heading of headings) {
                if (heading.textContent && heading.textContent.trim().length > 5) {
                  title = heading.textContent.trim();
                  break;
                }
              }
            }
            
            // Fallback: extract from URL slug
            if (!title || title.length < 5) {
              const urlParts = normalizedHref.split('/');
              const slug = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];
              if (slug) {
                title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              }
            }
            
            if (title) {
              articles.push({ href: normalizedHref, title });
            }
          }
        }
      });

      return articles;
    });

    console.log(`\n📈 Article Discovery Results:`);
    console.log(`   Total unique articles found: ${articles.length}`);
    console.log(`   Expected: exactly 20 articles`);
    console.log(`   Status: ${articles.length === 20 ? '✅ CORRECT' : articles.length > 20 ? '⚠️ TOO MANY' : '❌ TOO FEW'}`);
    
    console.log(`\n📋 Article List:`);
    articles.slice(0, 25).forEach((article, index) => {
      console.log(`   ${index + 1}. ${article.title.substring(0, 80)}${article.title.length > 80 ? '...' : ''}`);
    });

    if (articles.length > 20) {
      console.log(`\n⚠️ Found ${articles.length} articles instead of exactly 20. This suggests the scraper needs to limit results.`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

testCloudflareBypass().catch(console.error);