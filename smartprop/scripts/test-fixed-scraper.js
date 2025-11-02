const { chromium } = require('playwright');

async function testFixedScraper() {
    console.log('🧪 Testing fixed MCP scraper logic...');
    
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
        
        // Wait for dynamic content to load
        console.log('⏳ Waiting for dynamic content to load...');
        await page.waitForTimeout(8000);
        
        console.log('🧪 Testing fixed scraper logic...');
        
        // Simulate the fixed scraper logic
        const result = await page.evaluate(() => {
            // Find article containers
            let articleContainers = Array.from(document.querySelectorAll('div[class*="jsx-2211414346"]'));
            console.log(`✅ Found ${articleContainers.length} article containers with jsx-2211414346`);
            
            // If on /latest page, also look for article items in the list
            if (window.location.pathname.includes('/latest') || articleContainers.length < 18) {
                // Try alternative selector for article list items
                const altContainers = Array.from(document.querySelectorAll('div')).filter(div => {
                    // Look for divs that contain an article link and an image, likely article cards
                    const hasArticleLink = div.querySelector('a[href*="/property-news/"]:not([href*="/property-news-search"]):not([href*="/property-news/latest"]):not([href*="/property-news/news"]):not([href*="/property-news/in-depth"])');
                    const hasImage = div.querySelector('img');
                    const href = hasArticleLink?.getAttribute('href');
                    // Only count if it's a proper article URL (not a category page)
                    // Handle both relative and absolute URLs
                    if (hasArticleLink && hasImage && href && href.includes('/property-news/')) {
                        const isRelativeUrl = href.startsWith('/property-news/');
                        const isAbsoluteUrl = href.includes('edgeprop.sg/property-news/');
                        const pathSegments = href.split('/').length;
                        return (isRelativeUrl && pathSegments >= 3) || (isAbsoluteUrl && pathSegments >= 5);
                    }
                    return false;
                });
                
                if (altContainers.length > articleContainers.length) {
                    console.log(`✅ Found ${altContainers.length} alternative article containers`);
                    articleContainers = altContainers;
                }
            }
            
            // Extract unique article hrefs from the containers (limit to 20 per page)
            const uniqueHrefs = new Map();
            
            // Process all containers but only take first 20
            for (let index = 0; index < articleContainers.length && uniqueHrefs.size < 20; index++) {
                const container = articleContainers[index];
                
                // Find all article links in this container
                const allLinks = Array.from(container.querySelectorAll('a[href*="/property-news/"]'));
                const articleLinks = allLinks.filter(link => {
                    const href = link.getAttribute('href') || '';
                    // Filter out category pages, search pages, and non-article links
                    // Handle both relative (/property-news/...) and absolute (https://www.edgeprop.sg/property-news/...) URLs
                    const isRelativeUrl = href.startsWith('/property-news/');
                    const isAbsoluteUrl = href.includes('edgeprop.sg/property-news/');
                    const pathSegments = href.split('/').length;
                    
                    return (isRelativeUrl || isAbsoluteUrl) && 
                           !href.includes('/property-news-search') &&
                           !href.includes('/property-news/latest') &&
                           !href.includes('/property-news/news') &&
                           !href.includes('/property-news/in-depth') &&
                           !href.includes('/property-news/showcase') &&
                           !href.includes('/property-news/deal-watch') &&
                           !href.includes('/property-news/international') &&
                           !href.includes('/property-news/personality') &&
                           !href.includes('/property-news/mandarin') &&
                           // For relative URLs: ['', 'property-news', 'article-slug'] = 3 segments minimum
                           // For absolute URLs: ['https:', '', 'www.edgeprop.sg', 'property-news', 'article-slug'] = 5 segments minimum
                           ((isRelativeUrl && pathSegments >= 3) || (isAbsoluteUrl && pathSegments >= 5));
                });
                
                // Find the article href (prefer links with longer text content - those are usually the title links)
                let articleHref = '';
                let title = '';
                let category = '';
                let imgSrc = '';
                
                // Sort links by text length to prefer title links over category links
                const sortedLinks = articleLinks.sort((a, b) => (b.textContent?.trim().length || 0) - (a.textContent?.trim().length || 0));
                
                sortedLinks.forEach(link => {
                    const href = link.getAttribute('href') || '';
                    const text = link.textContent?.trim() || '';
                    
                    // Get the article href (first valid article link)
                    if (href && !articleHref) {
                        articleHref = href;
                    }
                    
                    // Get category (short uppercase text like "PROPERTY NEWS", "PERSONALITY", etc.)
                    if (['PROPERTY NEWS', 'DEAL WATCH', 'PERSONALITY', 'SPECIAL FEATURE', 'NEWS / IN DEPTH', 'NEWS / INTERNATIONAL'].includes(text)) {
                        category = text;
                    }
                    
                    // Get title (long text, not category, not "EDGEPROP SINGAPORE")
                    if (text && text.length > 50 && !text.includes('EDGEPROP SINGAPORE') && !text.includes('PROPERTY NEWS') && !text.includes('PERSONALITY') && !text.includes('SPECIAL FEATURE')) {
                        if (!title || text.length > title.length) {
                            title = text;
                        }
                    }
                });
                
                // Fallback: if no title found from links, try to get it from h2, h3, or heading tags
                if (!title || title.length < 20) {
                    const heading = container.querySelector('h2, h3, h4, [class*="title"], [class*="heading"]');
                    if (heading) {
                        const headingText = heading.textContent?.trim() || '';
                        if (headingText && headingText.length > 20 && !headingText.includes('EDGEPROP SINGAPORE')) {
                            title = headingText;
                        }
                    }
                }
                
                // Get image - try multiple sources
                const img = container.querySelector('img');
                if (img) {
                    imgSrc = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
                    // Make sure it's not a logo or icon
                    if (imgSrc && (imgSrc.includes('logo') || imgSrc.includes('icon') || imgSrc.includes('avatar'))) {
                        imgSrc = '';
                    }
                }
                
                // Normalize href (remove domain if present, ensure leading slash)
                const normalizedHref = articleHref.replace(/^https?:\/\/www\.edgeprop\.sg/, '').replace(/^([^/])/, '/$1');
                
                if (normalizedHref && normalizedHref.includes('/property-news/') && !uniqueHrefs.has(normalizedHref)) {
                    uniqueHrefs.set(normalizedHref, {
                        href: normalizedHref,
                        title: title,
                        category: category,
                        imgSrc: imgSrc,
                        index: index
                    });
                }
            }
            
            return {
                totalContainers: articleContainers.length,
                uniqueArticles: uniqueHrefs.size,
                articles: Array.from(uniqueHrefs.values()).slice(0, 10) // First 10 for debugging
            };
        });
        
        console.log('\\n📊 Test Results:');
        console.log(`Total containers found: ${result.totalContainers}`);
        console.log(`Unique articles extracted: ${result.uniqueArticles}`);
        
        if (result.articles.length > 0) {
            console.log('\\n📋 Sample articles:');
            result.articles.forEach((article, i) => {
                console.log(`\\nArticle ${i + 1}:`);
                console.log(`  href: ${article.href}`);
                console.log(`  title: ${article.title || 'No title'}`);
                console.log(`  category: ${article.category || 'No category'}`);
                console.log(`  imgSrc: ${article.imgSrc ? 'Yes' : 'No'}`);
            });
        }
        
        console.log('\\n✅ Test complete!');
        
        if (result.uniqueArticles > 0) {
            console.log('🎉 SUCCESS: The fixed scraper can now extract articles!');
        } else {
            console.log('❌ FAILURE: The scraper still cannot extract articles.');
        }
        
    } catch (error) {
        console.error('❌ Error during test:', error);
    } finally {
        await browser.close();
    }
}

testFixedScraper().catch(console.error);