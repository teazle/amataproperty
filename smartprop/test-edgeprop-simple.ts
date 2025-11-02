import { chromium } from 'playwright';

async function testEdgePropPageStructure() {
    console.log('🔍 Testing EdgeProp page structure...');
    
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        // Navigate to the latest news page
        console.log('📍 Navigating to https://www.edgeprop.sg/property-news/latest');
        await page.goto('https://www.edgeprop.sg/property-news/latest', { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });
        
        // Wait for content to load
        await page.waitForTimeout(5000);
        
        // Analyze the page structure
        const pageAnalysis = await page.evaluate(() => {
            // Find all article links
            const allLinks = Array.from(document.querySelectorAll('a[href*="/property-news/"]'));
            
            // Filter for actual article links (not category/search pages)
            const articleLinks = allLinks.filter(link => {
                const href = link.getAttribute('href') || '';
                const isArticle = href.includes('/property-news/') && 
                               !href.includes('/property-news/latest') &&
                               !href.includes('/property-news-search') &&
                               !href.includes('/property-news/news') &&
                               !href.includes('/property-news/in-depth') &&
                               !href.includes('/property-news/category') &&
                               !href.match(/\/property-news\/?$/);
                return isArticle;
            });
            
            // Get unique article URLs
            const uniqueArticles = Array.from(new Set(articleLinks.map(link => link.getAttribute('href'))));
            
            // Get article details
            const articles = uniqueArticles.slice(0, 25).map((href, index) => {
                const link = articleLinks.find(l => l.getAttribute('href') === href);
                const title = link?.textContent?.trim() || 'No title';
                
                return {
                    index: index + 1,
                    href,
                    title: title.substring(0, 80) + (title.length > 80 ? '...' : '')
                };
            });
            
            // Check for pagination or load more elements
            const paginationSelectors = [
                '[class*="page"]',
                '[class*="pagination"]', 
                'button[class*="next"]',
                'button[class*="more"]',
                'a[class*="next"]',
                '[class*="load-more"]',
                'button:contains("Load")',
                'button:contains("More")',
                'button:contains("Next")'
            ];
            
            let paginationElements = [];
            paginationSelectors.forEach(selector => {
                try {
                    const elements = document.querySelectorAll(selector);
                    paginationElements.push(...Array.from(elements));
                } catch (e) {
                    // Ignore selector errors
                }
            });
            
            return {
                totalLinks: allLinks.length,
                articleCount: uniqueArticles.length,
                articles,
                hasPagination: paginationElements.length > 0,
                paginationCount: paginationElements.length,
                pageTitle: document.title,
                url: window.location.href
            };
        });
        
        // Display results
        console.log('\n📊 PAGE ANALYSIS RESULTS:');
        console.log('='.repeat(60));
        console.log(`Page Title: ${pageAnalysis.pageTitle}`);
        console.log(`Current URL: ${pageAnalysis.url}`);
        console.log(`Total Links Found: ${pageAnalysis.totalLinks}`);
        console.log(`Unique Article Links: ${pageAnalysis.articleCount}`);
        console.log(`Has Pagination Elements: ${pageAnalysis.hasPagination} (${pageAnalysis.paginationCount} elements)`);
        
        console.log('\n📰 ARTICLES FOUND:');
        console.log('-'.repeat(60));
        pageAnalysis.articles.forEach(article => {
            console.log(`${article.index}. ${article.title}`);
            console.log(`   URL: ${article.href}`);
        });
        
        // Validation
        const expectedCount = 20;
        const actualCount = pageAnalysis.articleCount;
        
        console.log('\n🎯 VALIDATION RESULTS:');
        console.log('='.repeat(60));
        if (actualCount === expectedCount) {
            console.log(`✅ PERFECT: Found exactly ${expectedCount} articles as expected`);
        } else if (actualCount > expectedCount) {
            console.log(`⚠️  ISSUE FOUND: Found ${actualCount} articles, expected ${expectedCount}`);
            console.log(`   The scraper is finding ${actualCount - expectedCount} extra articles`);
            console.log(`   This suggests pagination or infinite scroll is loading more content`);
        } else {
            console.log(`❌ PROBLEM: Found only ${actualCount} articles, expected ${expectedCount}`);
            console.log(`   The page might not be fully loaded or has fewer articles`);
        }
        
        console.log('\n🔧 SCRAPER IMPLICATIONS:');
        console.log('-'.repeat(60));
        if (actualCount > expectedCount) {
            console.log('• The MCP scraper needs to limit results to first 20 articles');
            console.log('• Current scraper logic may be processing multiple pages worth of content');
            console.log('• Need to implement proper pagination handling');
        } else if (actualCount === expectedCount) {
            console.log('• Current article count is correct');
            console.log('• Scraper logic should work as expected');
        }
        
    } catch (error) {
        console.error('❌ Error during page analysis:', error);
    } finally {
        await browser.close();
        console.log('\n✅ Analysis complete - browser closed');
    }
}

testEdgePropPageStructure().catch(console.error);