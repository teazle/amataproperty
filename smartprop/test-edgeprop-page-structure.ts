import { chromium } from 'playwright';

async function testEdgePropPageStructure() {
    console.log('🔍 Testing EdgeProp page structure...');
    
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    
    try {
        // Navigate to the latest news page
        console.log('📍 Navigating to https://www.edgeprop.sg/property-news/latest');
        await page.goto('https://www.edgeprop.sg/property-news/latest', { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });
        
        // Wait for content to load
        await page.waitForTimeout(3000);
        
        // Take a screenshot for reference
        await page.screenshot({ path: 'edgeprop-page-structure.png', fullPage: true });
        console.log('📸 Screenshot saved as edgeprop-page-structure.png');
        
        // Analyze the page structure
        const pageAnalysis = await page.evaluate(() => {
            // Find all article links
            const allLinks = Array.from(document.querySelectorAll('a[href*="/property-news/"]'));
            console.log('Total links found:', allLinks.length);
            
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
            
            console.log('Article links found:', articleLinks.length);
            
            // Get article details
            const articles = articleLinks.slice(0, 25).map((link, index) => {
                const href = link.getAttribute('href') || '';
                const title = link.textContent?.trim() || 'No title';
                const parent = link.closest('div, article, section');
                
                return {
                    index: index + 1,
                    href,
                    title: title.substring(0, 100) + (title.length > 100 ? '...' : ''),
                    hasImage: !!parent?.querySelector('img'),
                    parentTag: parent?.tagName || 'unknown'
                };
            });
            
            // Check for pagination elements
            const paginationElements = document.querySelectorAll('[class*="page"], [class*="pagination"], button[class*="next"], button[class*="more"], a[class*="next"]');
            const hasPagination = paginationElements.length > 0;
            
            // Check for "Load More" or similar buttons
            const loadMoreButtons = document.querySelectorAll('button:contains("Load"), button:contains("More"), button:contains("Next"), [class*="load-more"]');
            const hasLoadMore = loadMoreButtons.length > 0;
            
            return {
                totalLinks: allLinks.length,
                articleCount: articleLinks.length,
                articles,
                hasPagination,
                hasLoadMore,
                paginationCount: paginationElements.length,
                loadMoreCount: loadMoreButtons.length,
                pageTitle: document.title,
                url: window.location.href
            };
        });
        
        // Display results
        console.log('\n📊 PAGE ANALYSIS RESULTS:');
        console.log('='.repeat(50));
        console.log(`Page Title: ${pageAnalysis.pageTitle}`);
        console.log(`Current URL: ${pageAnalysis.url}`);
        console.log(`Total Links Found: ${pageAnalysis.totalLinks}`);
        console.log(`Article Links Found: ${pageAnalysis.articleCount}`);
        console.log(`Has Pagination: ${pageAnalysis.hasPagination} (${pageAnalysis.paginationCount} elements)`);
        console.log(`Has Load More: ${pageAnalysis.hasLoadMore} (${pageAnalysis.loadMoreCount} elements)`);
        
        console.log('\n📰 FIRST 20 ARTICLES:');
        console.log('-'.repeat(50));
        pageAnalysis.articles.slice(0, 20).forEach(article => {
            console.log(`${article.index}. ${article.title}`);
            console.log(`   URL: ${article.href}`);
            console.log(`   Has Image: ${article.hasImage}, Parent: ${article.parentTag}`);
            console.log('');
        });
        
        // Check if there are exactly 20 articles visible
        const expectedCount = 20;
        const actualCount = pageAnalysis.articleCount;
        
        console.log('\n🎯 VALIDATION:');
        console.log('-'.repeat(30));
        if (actualCount === expectedCount) {
            console.log(`✅ CORRECT: Found exactly ${expectedCount} articles as expected`);
        } else if (actualCount > expectedCount) {
            console.log(`⚠️  WARNING: Found ${actualCount} articles, expected ${expectedCount}`);
            console.log(`   This suggests the scraper might be finding more than one page worth of articles`);
        } else {
            console.log(`❌ ERROR: Found only ${actualCount} articles, expected ${expectedCount}`);
        }
        
        // Keep browser open for manual inspection
        console.log('\n🔍 Browser kept open for manual inspection...');
        console.log('Press Ctrl+C to close when done examining the page');
        
        // Wait indefinitely until user closes
        await new Promise(() => {});
        
    } catch (error) {
        console.error('❌ Error during page analysis:', error);
    } finally {
        await browser.close();
    }
}

testEdgePropPageStructure().catch(console.error);