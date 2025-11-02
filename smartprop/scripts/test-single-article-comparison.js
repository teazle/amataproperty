const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function testSingleArticleComparison() {
    console.log('🧪 Testing single article scraping and comparison...');
    
    const browser = await chromium.launch({
        headless: false,
        channel: 'chromium',
        args: [
            '--disable-extensions-except=/path/to/extension',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-preconnect',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-hang-monitor',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-sync',
            '--disable-domain-reliability',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--no-sandbox',
            '--no-first-run',
            '--no-default-browser-check'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'Asia/Singapore',
        geolocation: { longitude: 103.8198, latitude: 1.3521 },
        permissions: ['geolocation'],
        extraHTTPHeaders: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9',
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

    await context.addInitScript(() => {
        // Remove webdriver property
        delete navigator.__proto__.webdriver;
        
        // Mock chrome object
        window.chrome = {
            runtime: {},
            loadTimes: function() {},
            csi: function() {},
            app: {}
        };
        
        // Mock other navigator properties
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
        
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
        
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });
        
        // Mock permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Cypress.env('NOTIFICATION_PERMISSION') || 'granted' }) :
                originalQuery(parameters)
        );
    });

    const page = await context.newPage();

    try {
        // Step 1: Navigate to EdgeProp latest news and get first article
        console.log('📍 Navigating to EdgeProp Singapore latest news...');
        await page.goto('https://www.edgeprop.sg/property-news/latest', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });

        console.log('⏳ Waiting for dynamic content to load...');
        await page.waitForTimeout(5000);

        // Find the first article container
        console.log('🔍 Finding first article...');
        const firstArticle = await page.evaluate(() => {
            // Look for jsx containers first
            const jsxContainers = document.querySelectorAll('[class*="jsx-"]');
            
            for (const container of jsxContainers) {
                const link = container.querySelector('a[href*="/property-news/"]');
                const img = container.querySelector('img');
                
                if (link && img && link.href && !link.href.includes('/property-news-search') && !link.href.includes('/category/')) {
                    const href = link.href.replace(/^https?:\/\/www\.edgeprop\.sg/, '').replace(/^([^/])/, '/$1');
                    
                    // Check if it's a proper article (not category/search page)
                    if (href.split('/').length >= 3) {
                        return {
                            href: href,
                            fullUrl: link.href,
                            title: link.textContent?.trim() || 'No title',
                            imgSrc: img.src,
                            imgAlt: img.alt || ''
                        };
                    }
                }
            }
            
            return null;
        });

        if (!firstArticle) {
            throw new Error('No article found on the page');
        }

        console.log('✅ Found first article:', firstArticle.title);
        console.log('🔗 Article URL:', firstArticle.fullUrl);

        // Step 2: Navigate to the article and scrape its content
        console.log('📖 Navigating to article page...');
        await page.goto(firstArticle.fullUrl, { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });

        await page.waitForTimeout(3000);

        // Take screenshot of original article
        console.log('📸 Taking screenshot of original article...');
        await page.screenshot({ 
            path: '/Users/vincent/propertydemo/smartprop/scripts/original-article.png',
            fullPage: true 
        });

        // Extract article content from the page
        console.log('📝 Extracting article content...');
        const originalContent = await page.evaluate(() => {
            const result = {
                title: '',
                author: '',
                publishDate: '',
                content: '',
                images: [],
                category: '',
                url: window.location.href
            };

            // Extract title
            const titleSelectors = [
                'h1',
                '[class*="title"]',
                '.article-title',
                '.post-title'
            ];
            
            for (const selector of titleSelectors) {
                const titleEl = document.querySelector(selector);
                if (titleEl && titleEl.textContent.trim()) {
                    result.title = titleEl.textContent.trim();
                    break;
                }
            }

            // Extract author
            const authorSelectors = [
                '[class*="author"]',
                '[class*="byline"]',
                '.writer',
                '.journalist'
            ];
            
            for (const selector of authorSelectors) {
                const authorEl = document.querySelector(selector);
                if (authorEl && authorEl.textContent.trim()) {
                    result.author = authorEl.textContent.trim();
                    break;
                }
            }

            // Extract publish date
            const dateSelectors = [
                '[class*="date"]',
                '[class*="time"]',
                'time',
                '.publish-date'
            ];
            
            for (const selector of dateSelectors) {
                const dateEl = document.querySelector(selector);
                if (dateEl && dateEl.textContent.trim()) {
                    result.publishDate = dateEl.textContent.trim();
                    break;
                }
            }

            // Extract main content
            const contentSelectors = [
                '[class*="content"]',
                '[class*="article"]',
                '[class*="body"]',
                '.post-content',
                'main'
            ];
            
            for (const selector of contentSelectors) {
                const contentEl = document.querySelector(selector);
                if (contentEl) {
                    // Get text content but preserve some structure
                    const paragraphs = contentEl.querySelectorAll('p');
                    if (paragraphs.length > 0) {
                        result.content = Array.from(paragraphs)
                            .map(p => p.textContent.trim())
                            .filter(text => text.length > 0)
                            .join('\n\n');
                        break;
                    } else {
                        result.content = contentEl.textContent.trim();
                        break;
                    }
                }
            }

            // Extract images
            const images = document.querySelectorAll('img');
            images.forEach(img => {
                if (img.src && !img.src.includes('data:') && img.width > 100 && img.height > 100) {
                    result.images.push({
                        src: img.src,
                        alt: img.alt || '',
                        width: img.width,
                        height: img.height
                    });
                }
            });

            // Extract category
            const categorySelectors = [
                '[class*="category"]',
                '[class*="tag"]',
                '.breadcrumb'
            ];
            
            for (const selector of categorySelectors) {
                const categoryEl = document.querySelector(selector);
                if (categoryEl && categoryEl.textContent.trim()) {
                    result.category = categoryEl.textContent.trim();
                    break;
                }
            }

            return result;
        });

        console.log('✅ Original content extracted');

        // Step 3: Now use the MCP scraper logic to scrape the same article
        console.log('🤖 Using MCP scraper logic to extract the same article...');
        
        // Import and use the actual MCP scraper
        const { scrapeEdgePropMCP } = require('../src/lib/scraper/edgeprop-mcp-scraper.ts');
        
        console.log('🔄 Running MCP scraper...');
        const scrapedResult = await scrapeEdgePropMCP(1); // Scrape just 1 article
        
        if (!scrapedResult.articles || scrapedResult.articles.length === 0) {
            throw new Error('MCP scraper returned no articles');
        }

        const scrapedArticle = scrapedResult.articles[0];
        console.log('✅ MCP scraper completed');

        // Step 4: Compare the results
        console.log('\n🔍 COMPARISON RESULTS:');
        console.log('=' .repeat(80));
        
        console.log('\n📰 TITLE COMPARISON:');
        console.log('Original:', originalContent.title);
        console.log('Scraped: ', scrapedArticle.title);
        console.log('Match:   ', originalContent.title === scrapedArticle.title ? '✅' : '❌');
        
        console.log('\n👤 AUTHOR COMPARISON:');
        console.log('Original:', originalContent.author);
        console.log('Scraped: ', scrapedArticle.author || 'Not extracted');
        console.log('Match:   ', originalContent.author === scrapedArticle.author ? '✅' : '❌');
        
        console.log('\n📅 DATE COMPARISON:');
        console.log('Original:', originalContent.publishDate);
        console.log('Scraped: ', scrapedArticle.publishDate || 'Not extracted');
        console.log('Match:   ', originalContent.publishDate === scrapedArticle.publishDate ? '✅' : '❌');
        
        console.log('\n🏷️ CATEGORY COMPARISON:');
        console.log('Original:', originalContent.category);
        console.log('Scraped: ', scrapedArticle.category || 'Not extracted');
        console.log('Match:   ', originalContent.category === scrapedArticle.category ? '✅' : '❌');
        
        console.log('\n📝 CONTENT COMPARISON:');
        console.log('Original length:', originalContent.content.length, 'characters');
        console.log('Scraped length: ', scrapedArticle.content?.length || 0, 'characters');
        
        if (originalContent.content && scrapedArticle.content) {
            const similarity = calculateSimilarity(originalContent.content, scrapedArticle.content);
            console.log('Similarity:     ', `${similarity.toFixed(1)}%`);
            console.log('Match:          ', similarity > 80 ? '✅' : '❌');
        } else {
            console.log('Match:          ', '❌ (Missing content)');
        }
        
        console.log('\n🖼️ IMAGE COMPARISON:');
        console.log('Original images:', originalContent.images.length);
        console.log('Scraped images: ', scrapedArticle.images?.length || 0);
        console.log('Match:          ', originalContent.images.length === (scrapedArticle.images?.length || 0) ? '✅' : '❌');
        
        if (originalContent.images.length > 0 && scrapedArticle.images && scrapedArticle.images.length > 0) {
            console.log('\nFirst image comparison:');
            console.log('Original:', originalContent.images[0].src);
            console.log('Scraped: ', scrapedArticle.images[0]);
        }

        console.log('\n🔗 URL COMPARISON:');
        console.log('Original:', originalContent.url);
        console.log('Scraped: ', scrapedArticle.url || 'Not extracted');
        console.log('Match:   ', originalContent.url === scrapedArticle.url ? '✅' : '❌');

        // Save detailed comparison to file
        const comparisonData = {
            timestamp: new Date().toISOString(),
            original: originalContent,
            scraped: scrapedArticle,
            comparison: {
                titleMatch: originalContent.title === scrapedArticle.title,
                authorMatch: originalContent.author === scrapedArticle.author,
                dateMatch: originalContent.publishDate === scrapedArticle.publishDate,
                categoryMatch: originalContent.category === scrapedArticle.category,
                contentSimilarity: originalContent.content && scrapedArticle.content ? 
                    calculateSimilarity(originalContent.content, scrapedArticle.content) : 0,
                imageCountMatch: originalContent.images.length === (scrapedArticle.images?.length || 0),
                urlMatch: originalContent.url === scrapedArticle.url
            }
        };

        fs.writeFileSync(
            '/Users/vincent/propertydemo/smartprop/scripts/article-comparison.json',
            JSON.stringify(comparisonData, null, 2)
        );

        console.log('\n💾 Detailed comparison saved to article-comparison.json');
        console.log('📸 Original article screenshot saved to original-article.png');

    } catch (error) {
        console.error('❌ Error during comparison:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

function calculateSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    // Simple similarity calculation based on common words
    const words1 = text1.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const words2 = text2.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return (intersection.size / union.size) * 100;
}

// Run the test
testSingleArticleComparison().catch(console.error);