const { chromium } = require('playwright');

async function testMCPScraper() {
    console.log('=== FINAL MCP SCRAPER COMPARISON TEST ===\n');
    
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
        // Step 1: Navigate to EdgeProp and find articles using MCP scraper logic
        console.log('Step 1: Finding articles using MCP scraper logic...');
        await page.goto('https://www.edgeprop.sg/property-news', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(3000);
        
        // Use the exact same logic as our MCP scraper
        const articles = await page.$$eval('div', (divs) => {
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
            }).slice(0, 3).map(div => {
                const link = div.querySelector('a[href*="/property-news/"]');
                const img = div.querySelector('img');
                const titleEl = div.querySelector('h1, h2, h3, h4, h5, h6, .title, [class*="title"], [class*="headline"]');
                
                let href = link.getAttribute('href');
                if (!href.startsWith('http')) {
                    href = 'https://www.edgeprop.sg' + (href.startsWith('/') ? '' : '/') + href;
                }
                
                return {
                    href,
                    title: titleEl ? titleEl.textContent.trim() : 'No title found',
                    imgSrc: img ? img.getAttribute('src') : null,
                    imgAlt: img ? img.getAttribute('alt') : null
                };
            });
        });
        
        console.log(`Found ${articles.length} articles using MCP scraper logic`);
        if (articles.length === 0) {
            console.log('No articles found, exiting...');
            return;
        }
        
        const testArticle = articles[0];
        console.log('Testing article:', testArticle.title);
        console.log('URL:', testArticle.href);
        
        // Step 2: Navigate to the article and extract content using MCP scraper logic
        console.log('\\nStep 2: Extracting article content using MCP scraper logic...');
        await page.goto(testArticle.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
        
        const mcpScrapedData = await page.evaluate(() => {
            // This is the exact logic from our MCP scraper
            
            // Extract title
            let title = '';
            const titleSelectors = ['h1', '.article-title', '[class*="title"]', '[class*="headline"]'];
            for (const selector of titleSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim()) {
                    title = el.textContent.trim();
                    break;
                }
            }
            
            // Extract author
            let author = '';
            const authorSelectors = ['.author', '[class*="author"]', '.byline', '[class*="byline"]'];
            for (const selector of authorSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim()) {
                    author = el.textContent.trim();
                    break;
                }
            }
            
            // Extract publish date
            let publishDate = '';
            const dateSelectors = ['time', '.date', '[class*="date"]', '.publish', '[class*="publish"]'];
            for (const selector of dateSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    publishDate = el.getAttribute('datetime') || el.textContent.trim();
                    if (publishDate) break;
                }
            }
            
            // Extract category
            let category = '';
            const categorySelectors = ['.category', '[class*="category"]', '.tag', '[class*="tag"]'];
            for (const selector of categorySelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim()) {
                    category = el.textContent.trim();
                    break;
                }
            }
            
            // Extract content paragraphs
            let content = '';
            const contentSelectors = ['.article-content', '.content', '[class*="content"]', '.article-body', '[class*="body"]'];
            for (const selector of contentSelectors) {
                const container = document.querySelector(selector);
                if (container) {
                    const paragraphs = container.querySelectorAll('p');
                    if (paragraphs.length > 0) {
                        content = Array.from(paragraphs)
                            .map(p => p.textContent.trim())
                            .filter(text => text.length > 0)
                            .join('\\n\\n');
                        break;
                    }
                }
            }
            
            // If no content found, try to get all paragraphs on the page
            if (!content) {
                const allParagraphs = document.querySelectorAll('p');
                content = Array.from(allParagraphs)
                    .map(p => p.textContent.trim())
                    .filter(text => text.length > 20)
                    .join('\\n\\n');
            }
            
            // Extract images
            const images = Array.from(document.querySelectorAll('img')).map(img => ({
                src: img.src,
                alt: img.alt || '',
                width: img.width,
                height: img.height
            })).filter(img => 
                img.src && 
                !img.src.includes('data:') && 
                img.width > 50 && 
                img.height > 50
            );
            
            return {
                title,
                author,
                publishDate,
                category,
                content,
                contentLength: content.length,
                images: images.slice(0, 5),
                url: window.location.href
            };
        });
        
        // Step 3: Get the actual visual content for comparison
        console.log('\\nStep 3: Capturing visual content for comparison...');
        const visualData = await page.evaluate(() => {
            return {
                pageTitle: document.title,
                visibleText: document.body.innerText.substring(0, 2000),
                allImages: Array.from(document.querySelectorAll('img')).length,
                mainHeading: document.querySelector('h1')?.textContent?.trim() || 'No H1 found'
            };
        });
        
        // Take screenshot
        await page.screenshot({ 
            path: 'mcp-scraper-comparison-screenshot.png', 
            fullPage: true 
        });
        
        // Step 4: Display comparison results
        console.log('\\n=== MCP SCRAPER EXTRACTION RESULTS ===');
        console.log('URL:', mcpScrapedData.url);
        console.log('Title:', mcpScrapedData.title);
        console.log('Author:', mcpScrapedData.author);
        console.log('Publish Date:', mcpScrapedData.publishDate);
        console.log('Category:', mcpScrapedData.category);
        console.log('Content Length:', mcpScrapedData.contentLength, 'characters');
        console.log('Images Found:', mcpScrapedData.images.length);
        console.log('\\nContent Preview (first 500 chars):');
        console.log(mcpScrapedData.content.substring(0, 500) + '...');
        
        console.log('\\n=== VISUAL BROWSER DATA ===');
        console.log('Page Title:', visualData.pageTitle);
        console.log('Main Heading:', visualData.mainHeading);
        console.log('Total Images on Page:', visualData.allImages);
        console.log('\\nVisible Text Preview (first 500 chars):');
        console.log(visualData.visibleText.substring(0, 500) + '...');
        
        console.log('\\n=== COMPARISON ANALYSIS ===');
        console.log('✓ Title Match:', mcpScrapedData.title === visualData.mainHeading ? 'YES' : 'PARTIAL');
        console.log('✓ Content Extracted:', mcpScrapedData.contentLength > 0 ? 'YES' : 'NO');
        console.log('✓ Images Extracted:', mcpScrapedData.images.length > 0 ? 'YES' : 'NO');
        console.log('✓ Author Found:', mcpScrapedData.author ? 'YES' : 'NO');
        console.log('✓ Date Found:', mcpScrapedData.publishDate ? 'YES' : 'NO');
        console.log('✓ Category Found:', mcpScrapedData.category ? 'YES' : 'NO');
        
        console.log('\\n=== IMAGES COMPARISON ===');
        if (mcpScrapedData.images.length > 0) {
            mcpScrapedData.images.forEach((img, i) => {
                console.log(`${i + 1}. ${img.src}`);
                console.log(`   Alt: "${img.alt}"`);
                console.log(`   Size: ${img.width}x${img.height}`);
            });
        } else {
            console.log('No images extracted by MCP scraper');
        }
        
        console.log('\\n=== FINAL ASSESSMENT ===');
        const hasTitle = mcpScrapedData.title && mcpScrapedData.title !== 'No title found';
        const hasContent = mcpScrapedData.contentLength > 100;
        const hasImages = mcpScrapedData.images.length > 0;
        
        if (hasTitle && hasContent && hasImages) {
            console.log('🟢 SUCCESS: MCP scraper successfully extracted title, content, and images');
        } else if (hasTitle && hasContent) {
            console.log('🟡 PARTIAL: MCP scraper extracted title and content, but no images');
        } else if (hasTitle) {
            console.log('🟠 LIMITED: MCP scraper only extracted title');
        } else {
            console.log('🔴 FAILED: MCP scraper failed to extract meaningful content');
        }
        
        console.log('\\nScreenshot saved: mcp-scraper-comparison-screenshot.png');
        console.log('Browser will stay open for 30 seconds for manual verification...');
        await page.waitForTimeout(30000);
        
    } catch (error) {
        console.error('Error during test:', error.message);
    } finally {
        await browser.close();
    }
}

testMCPScraper().catch(console.error);