const { chromium } = require('playwright');

async function testDirectArticle() {
    console.log('Testing direct article access...');
    
    // Use a known EdgeProp article URL
    const articleUrl = 'https://www.edgeprop.sg/property-news/singapore-property-market-outlook-2024';
    
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });
    
    const page = await context.newPage();
    
    try {
        console.log('Navigating to article:', articleUrl);
        await page.goto(articleUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        console.log('Page loaded, extracting content...');
        
        // Wait a bit for dynamic content
        await page.waitForTimeout(3000);
        
        // Extract article data
        const articleData = await page.evaluate(() => {
            // Get page title
            const title = document.title || document.querySelector('h1')?.textContent?.trim() || 'No title found';
            
            // Get all text content
            const allText = document.body.innerText || '';
            
            // Get all images
            const images = Array.from(document.querySelectorAll('img')).map(img => ({
                src: img.src,
                alt: img.alt || '',
                width: img.width || 0,
                height: img.height || 0
            })).filter(img => img.src && !img.src.includes('data:') && img.width > 50);
            
            // Get meta information
            const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
            const metaKeywords = document.querySelector('meta[name="keywords"]')?.content || '';
            
            return {
                url: window.location.href,
                title,
                metaDescription,
                metaKeywords,
                textLength: allText.length,
                textPreview: allText.substring(0, 1000),
                imageCount: images.length,
                images: images.slice(0, 3)
            };
        });
        
        console.log('\n=== EXTRACTED ARTICLE DATA ===');
        console.log('URL:', articleData.url);
        console.log('Title:', articleData.title);
        console.log('Meta Description:', articleData.metaDescription);
        console.log('Text Length:', articleData.textLength, 'characters');
        console.log('Image Count:', articleData.imageCount);
        console.log('\nText Preview:');
        console.log(articleData.textPreview);
        console.log('\nFirst few images:');
        articleData.images.forEach((img, i) => {
            console.log(`${i + 1}. ${img.src} (${img.width}x${img.height}) - Alt: "${img.alt}"`);
        });
        
        // Take screenshot
        await page.screenshot({ 
            path: 'edgeprop-article-screenshot.png', 
            fullPage: true 
        });
        console.log('\nScreenshot saved: edgeprop-article-screenshot.png');
        
        // Now simulate what our MCP scraper would extract
        console.log('\n=== SIMULATING MCP SCRAPER EXTRACTION ===');
        
        const scrapedData = await page.evaluate(() => {
            // This mimics the logic in our MCP scraper
            let title = '';
            const titleSelectors = ['h1', '.article-title', '[class*="title"]', '[class*="headline"]'];
            for (const selector of titleSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim()) {
                    title = el.textContent.trim();
                    break;
                }
            }
            
            let author = '';
            const authorSelectors = ['.author', '[class*="author"]', '.byline', '[class*="byline"]'];
            for (const selector of authorSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim()) {
                    author = el.textContent.trim();
                    break;
                }
            }
            
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
                            .join('\n\n');
                        break;
                    }
                }
            }
            
            if (!content) {
                const allParagraphs = document.querySelectorAll('p');
                content = Array.from(allParagraphs)
                    .map(p => p.textContent.trim())
                    .filter(text => text.length > 20)
                    .join('\n\n');
            }
            
            return {
                title,
                author,
                content: content.substring(0, 1500),
                contentLength: content.length
            };
        });
        
        console.log('MCP Scraper would extract:');
        console.log('Title:', scrapedData.title);
        console.log('Author:', scrapedData.author);
        console.log('Content Length:', scrapedData.contentLength, 'characters');
        console.log('Content Preview:', scrapedData.content);
        
        console.log('\n=== COMPARISON SUMMARY ===');
        console.log('✓ Browser is open showing the original article');
        console.log('✓ Screenshot saved for reference');
        console.log('✓ Extracted data shows what our scraper would capture');
        console.log('✓ You can now manually compare the scraped data with the browser view');
        
        // Keep browser open for manual inspection
        console.log('\nBrowser will stay open for 60 seconds for manual comparison...');
        await page.waitForTimeout(60000);
        
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await browser.close();
    }
}

testDirectArticle().catch(console.error);