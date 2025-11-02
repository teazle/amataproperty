const { chromium } = require('playwright');

async function investigateEdgePropStealth() {
    console.log('🔍 Starting EdgeProp stealth investigation...');
    
    const launchOptions = {
        headless: false,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--mute-audio',
            '--no-default-browser-check',
            '--disable-ipc-flooding-protection',
            '--disable-hang-monitor',
            '--disable-prompt-on-repost',
            '--disable-domain-reliability',
            '--disable-component-extensions-with-background-pages',
            '--disable-background-networking',
            '--disable-breakpad'
        ]
    };
    
    let browser;
    try {
        browser = await chromium.launch({ 
            ...launchOptions,
            channel: 'chromium'
        });
        console.log('✅ Using Chromium channel for better Cloudflare bypass');
    } catch (e) {
        console.log('⚠️ Chromium channel not available, using default browser');
        browser = await chromium.launch(launchOptions);
    }
    
    const context = await browser.newContext({
        javaScriptEnabled: true,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-SG',
        timezoneId: 'Asia/Singapore',
        permissions: ['geolocation'],
        geolocation: { latitude: 1.3521, longitude: 103.8198 },
        colorScheme: 'light',
        extraHTTPHeaders: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-SG,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        }
    });
    
    // Add stealth scripts
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
        
        window.chrome = {
            runtime: {},
        };
        
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
        
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-SG', 'en', 'en-US'],
        });
        
        Object.defineProperty(navigator, 'platform', {
            get: () => 'MacIntel',
        });
        
        Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => 8,
        });
        
        Object.defineProperty(navigator, 'deviceMemory', {
            get: () => 8,
        });
        
        Object.defineProperty(screen, 'width', {
            get: () => 1920,
        });
        
        Object.defineProperty(screen, 'height', {
            get: () => 1080,
        });
    });
    
    const page = await context.newPage();
    
    try {
        console.log('📍 Navigating to EdgeProp Singapore latest news...');
        await page.goto('https://www.edgeprop.sg/property-news/latest', { 
            waitUntil: 'domcontentloaded',
            timeout: 45000 
        });
        
        // Check page title and URL
        const title = await page.title();
        const url = page.url();
        console.log(`Page title: ${title}`);
        console.log(`Current URL: ${url}`);
        
        // Check for Cloudflare protection
        const bodyText = await page.textContent('body');
        if (bodyText.includes('Cloudflare') || bodyText.includes('Just a moment')) {
            console.log('⚠️ Cloudflare protection detected, waiting longer...');
            await page.waitForTimeout(15000);
        }
        
        // Wait for dynamic content to load
        console.log('⏳ Waiting for dynamic content to load...');
        await page.waitForTimeout(8000);
        
        // Take a screenshot for debugging
        await page.screenshot({ path: 'edgeprop-sg-debug.png', fullPage: true });
        console.log('📸 Screenshot saved as edgeprop-sg-debug.png');
        
        console.log('🔍 Investigating JSX containers...');
        
        // Check for jsx-2211414346 elements
        const jsxContainers = await page.$$('div[class*="jsx-2211414346"]');
        console.log(`Found ${jsxContainers.length} JSX containers`);
        
        if (jsxContainers.length > 0) {
            console.log('\\n📋 Analyzing first few JSX containers:');
            
            for (let i = 0; i < Math.min(5, jsxContainers.length); i++) {
                console.log(`\\n--- Container ${i + 1} ---`);
                
                const containerHtml = await jsxContainers[i].innerHTML();
                console.log('Container HTML length:', containerHtml.length);
                
                // Look for links within this container
                const links = await jsxContainers[i].$$('a');
                console.log(`Links in container: ${links.length}`);
                
                for (let j = 0; j < links.length; j++) {
                    const href = await links[j].getAttribute('href');
                    const text = await links[j].textContent();
                    console.log(`  Link ${j + 1}: href="${href}", text="${text?.trim().substring(0, 50)}..."`);
                }
                
                // Look for images
                const images = await jsxContainers[i].$$('img');
                console.log(`Images in container: ${images.length}`);
                
                for (let k = 0; k < images.length; k++) {
                    const src = await images[k].getAttribute('src');
                    const alt = await images[k].getAttribute('alt');
                    console.log(`  Image ${k + 1}: src="${src}", alt="${alt}"`);
                }
            }
        }
        
        console.log('\\n🔍 Looking for alternative article containers...');
        
        // Look for alternative selectors
        const articleLinks = await page.$$('a[href*="/property-news/"]');
        console.log(`Found ${articleLinks.length} links containing "/property-news/"`);
        
        if (articleLinks.length > 0) {
            console.log('\\n📋 Analyzing property news links:');
            
            for (let i = 0; i < Math.min(10, articleLinks.length); i++) {
                const href = await articleLinks[i].getAttribute('href');
                const text = await articleLinks[i].textContent();
                const pathSegments = href ? href.split('/').length : 0;
                
                console.log(`Link ${i + 1}: href="${href}" (${pathSegments} segments), text="${text?.trim().substring(0, 50)}..."`);
            }
        }
        
        console.log('\\n🔍 Looking for article containers with images...');
        
        // Look for divs that contain both article links and images
        const divsWithArticleLinks = await page.$$eval('div', (divs) => {
            return divs.map((div, index) => {
                const articleLink = div.querySelector('a[href*="/property-news/"]');
                const image = div.querySelector('img');
                
                if (articleLink && image) {
                    return {
                        index,
                        href: articleLink.href,
                        text: articleLink.textContent?.trim(),
                        imgSrc: image.src,
                        imgAlt: image.alt,
                        pathSegments: articleLink.href.split('/').length
                    };
                }
                return null;
            }).filter(Boolean);
        });
        
        console.log(`Found ${divsWithArticleLinks.length} divs with both article links and images`);
        
        if (divsWithArticleLinks.length > 0) {
            console.log('\\n📋 Article containers with images:');
            
            for (let i = 0; i < Math.min(10, divsWithArticleLinks.length); i++) {
                const container = divsWithArticleLinks[i];
                console.log(`Container ${i + 1}:`);
                console.log(`  href: ${container.href} (${container.pathSegments} segments)`);
                console.log(`  text: ${container.text?.substring(0, 50)}...`);
                console.log(`  imgSrc: ${container.imgSrc}`);
                console.log(`  imgAlt: ${container.imgAlt}`);
            }
        }
        
        console.log('\\n✅ Investigation complete!');
        
    } catch (error) {
        console.error('❌ Error during investigation:', error);
    } finally {
        await browser.close();
    }
}

investigateEdgePropStealth().catch(console.error);