const { chromium } = require('playwright');

async function testScraper() {
    console.log('Starting EdgeProp scraper test...');
    
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        ]
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'en-US',
        timezoneId: 'Asia/Singapore',
        geolocation: { longitude: 103.8198, latitude: 1.3521 },
        permissions: ['geolocation']
    });
    
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
    });
    
    const page = await context.newPage();
    
    try {
        console.log('Navigating to EdgeProp latest news...');
        await page.goto('https://www.edgeprop.sg/property-news/latest', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });
        
        console.log('Page loaded successfully');
        
        // Find article containers using the same logic as the MCP scraper
        const containers = await page.$$eval('div', (divs) => {
            return divs.filter(div => {
                const link = div.querySelector('a[href*="/property-news/"]');
                const img = div.querySelector('img');
                
                if (!link || !img) return false;
                
                const href = link.getAttribute('href');
                if (!href) return false;
                
                // Check if it's a category or search page (exclude these)
                if (href.includes('/category/') || href.includes('/search/')) return false;
                
                // Check path segments based on whether URL is relative or absolute
                const isRelative = !href.startsWith('http');
                const pathSegments = isRelative ? href.split('/').length : href.split('/').length;
                const minSegments = isRelative ? 3 : 5;
                
                return pathSegments >= minSegments;
            }).slice(0, 1).map(div => {
                const link = div.querySelector('a[href*="/property-news/"]');
                const img = div.querySelector('img');
                const titleEl = div.querySelector('h1, h2, h3, h4, h5, h6, .title, [class*="title"], [class*="headline"]');
                
                return {
                    href: link.getAttribute('href'),
                    title: titleEl ? titleEl.textContent.trim() : 'No title found',
                    imgSrc: img ? img.getAttribute('src') : null,
                    imgAlt: img ? img.getAttribute('alt') : null
                };
            });
        });
        
        if (containers.length === 0) {
            console.log('No article containers found');
            return;
        }
        
        const firstArticle = containers[0];
        console.log('Found first article:', firstArticle);
        
        // Navigate to the article
        let articleUrl = firstArticle.href;
        if (!articleUrl.startsWith('http')) {
            articleUrl = 'https://www.edgeprop.sg' + (articleUrl.startsWith('/') ? '' : '/') + articleUrl;
        }
        
        console.log('Navigating to article:', articleUrl);
        await page.goto(articleUrl, { waitUntil: 'networkidle', timeout: 60000 });
        
        // Extract article content
        const articleData = await page.evaluate(() => {
            // Extract title
            const titleSelectors = ['h1', '.article-title', '[class*="title"]', '[class*="headline"]'];
            let title = '';
            for (const selector of titleSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim()) {
                    title = el.textContent.trim();
                    break;
                }
            }
            
            // Extract author
            const authorSelectors = ['.author', '[class*="author"]', '.byline', '[class*="byline"]'];
            let author = '';
            for (const selector of authorSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim()) {
                    author = el.textContent.trim();
                    break;
                }
            }
            
            // Extract publish date
            const dateSelectors = ['time', '.date', '[class*="date"]', '.publish', '[class*="publish"]'];
            let publishDate = '';
            for (const selector of dateSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    publishDate = el.getAttribute('datetime') || el.textContent.trim();
                    if (publishDate) break;
                }
            }
            
            // Extract content paragraphs
            const contentSelectors = ['.article-content', '.content', '[class*="content"]', '.article-body', '[class*="body"]'];
            let content = '';
            for (const selector of contentSelectors) {
                const container = document.querySelector(selector);
                if (container) {
                    const paragraphs = container.querySelectorAll('p');
                    if (paragraphs.length > 0) {
                        content = Array.from(paragraphs).map(p => p.textContent.trim()).filter(text => text.length > 0).join('\n\n');
                        break;
                    }
                }
            }
            
            // If no content found, try to get all paragraphs on the page
            if (!content) {
                const allParagraphs = document.querySelectorAll('p');
                content = Array.from(allParagraphs).map(p => p.textContent.trim()).filter(text => text.length > 20).join('\n\n');
            }
            
            // Extract images
            const images = Array.from(document.querySelectorAll('img')).map(img => ({
                src: img.src,
                alt: img.alt || '',
                width: img.width,
                height: img.height
            })).filter(img => img.src && !img.src.includes('data:') && img.width > 50 && img.height > 50);
            
            return {
                title,
                author,
                publishDate,
                content: content.substring(0, 2000) + (content.length > 2000 ? '...' : ''),
                images: images.slice(0, 3), // First 3 images
                url: window.location.href
            };
        });
        
        console.log('\n=== SCRAPED ARTICLE DATA ===');
        console.log('URL:', articleData.url);
        console.log('Title:', articleData.title);
        console.log('Author:', articleData.author);
        console.log('Publish Date:', articleData.publishDate);
        console.log('Content Preview:', articleData.content.substring(0, 500) + '...');
        console.log('Images Found:', articleData.images.length);
        if (articleData.images.length > 0) {
            console.log('First Image:', articleData.images[0]);
        }
        
        // Take a screenshot
        await page.screenshot({ path: 'original-article-screenshot.png', fullPage: true });
        console.log('\nScreenshot saved as: original-article-screenshot.png');
        
        console.log('\n=== MANUAL COMPARISON INSTRUCTIONS ===');
        console.log('1. The browser window should be showing the original article');
        console.log('2. Compare the scraped data above with what you see in the browser');
        console.log('3. Check if the title, author, date, content, and images match');
        console.log('4. The screenshot has been saved for reference');
        
        // Keep browser open for manual inspection
        console.log('\nBrowser will stay open for 30 seconds for manual inspection...');
        await page.waitForTimeout(30000);
        
    } catch (error) {
        console.error('Error during scraping:', error);
    } finally {
        await browser.close();
    }
}

testScraper().catch(console.error);