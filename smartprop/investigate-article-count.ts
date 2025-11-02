/**
 * Investigate EdgeProp article count discrepancy using Playwright
 */

import { chromium } from 'playwright';

async function investigateArticleCount() {
  console.log('🔍 Investigating EdgeProp Article Count Discrepancy...\n');
  
  const browser = await chromium.launch({ headless: false }); // Use headless: false to see what's happening
  const page = await browser.newPage();
  
  try {
    console.log('📍 Navigating to EdgeProp latest news page...');
    await page.goto('https://www.edgeprop.sg/property-news/latest', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    // Wait for content to load
    console.log('⏳ Waiting for page content to load...');
    await page.waitForTimeout(3000);
    
    // Take a screenshot to see the page
    await page.screenshot({ path: 'edgeprop-investigation.png', fullPage: true });
    console.log('📸 Screenshot saved as edgeprop-investigation.png');
    
    // Analyze the page structure
    const analysis = await page.evaluate(() => {
      console.log('🔍 Starting page analysis...');
      
      // Find all potential article links
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      console.log(`Found ${allLinks.length} total links on page`);
      
      // Filter for article links (same logic as MCP scraper)
      const articleLinks = allLinks.filter(link => {
        const href = link.getAttribute('href') || '';
        
        // Must contain property-news and not be excluded patterns
        const isPropertyNews = href.includes('/property-news/');
        const isNotExcluded = !href.includes('/property-news/latest') && 
                             !href.includes('/property-news-search') && 
                             !href.includes('/property-news/news') && 
                             !href.includes('/property-news/in-depth');
        
        // Must not be category or search pages
        const isNotCategory = !href.includes('/category/') && 
                             !href.includes('/search') && 
                             !href.includes('/tag/');
        
        return isPropertyNews && isNotExcluded && isNotCategory;
      });
      
      console.log(`Found ${articleLinks.length} potential article links`);
      
      // Extract article information
      const articles = articleLinks.map((link, index) => {
        const href = link.getAttribute('href') || '';
        const fullUrl = href.startsWith('http') ? href : `https://www.edgeprop.sg${href}`;
        
        // Try to find title from various sources
        let title = '';
        const titleSelectors = [
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          '.title', '[class*="title"]', '[class*="headline"]'
        ];
        
        for (const selector of titleSelectors) {
          const titleEl = link.querySelector(selector) || 
                          link.closest('div, article, section')?.querySelector(selector);
          if (titleEl && titleEl.textContent?.trim()) {
            title = titleEl.textContent.trim();
            break;
          }
        }
        
        if (!title) {
          title = link.textContent?.trim() || 'No title found';
        }
        
        // Find associated image
        let imgSrc = '';
        const img = link.querySelector('img') || 
                   link.closest('div, article, section')?.querySelector('img');
        if (img) {
          imgSrc = img.getAttribute('src') || '';
        }
        
        return {
          index: index + 1,
          href: fullUrl,
          path: href,
          title: title.substring(0, 100),
          hasImage: !!imgSrc,
          linkText: link.textContent?.trim().substring(0, 50) || ''
        };
      });
      
      // Remove duplicates based on path
      const uniqueArticles = [];
      const seenPaths = new Set();
      
      for (const article of articles) {
        if (!seenPaths.has(article.path)) {
          seenPaths.add(article.path);
          uniqueArticles.push(article);
        }
      }
      
      console.log(`After deduplication: ${uniqueArticles.length} unique articles`);
      
      // Check for pagination or load more buttons
      const paginationSelectors = [
        '.pagination',
        '[class*="pagination"]',
        '[class*="load-more"]',
        '[class*="show-more"]',
        'button[class*="more"]',
        'a[class*="more"]'
      ];
      const paginationElements = document.querySelectorAll(paginationSelectors.join(', '));
      
      const hasInfiniteScroll = document.querySelector('[class*="infinite"]') || 
                               document.querySelector('[data-infinite]') ||
                               window.getComputedStyle(document.body).overflowY === 'auto';
      
      return {
        totalLinks: allLinks.length,
        articleLinks: articleLinks.length,
        uniqueArticles: uniqueArticles.length,
        articles: uniqueArticles.slice(0, 25), // Show first 25 for analysis
        paginationElements: paginationElements.length,
        hasInfiniteScroll,
        pageHeight: document.body.scrollHeight,
        viewportHeight: window.innerHeight
      };
    });
    
    // Display results
    console.log('\n📊 Page Analysis Results:');
    console.log(`   Total links found: ${analysis.totalLinks}`);
    console.log(`   Article links found: ${analysis.articleLinks}`);
    console.log(`   Unique articles: ${analysis.uniqueArticles}`);
    console.log(`   Expected: 20 articles`);
    console.log(`   Discrepancy: ${analysis.uniqueArticles > 20 ? '+' : ''}${analysis.uniqueArticles - 20} articles`);
    
    console.log(`\n🔧 Page Structure:`);
    console.log(`   Pagination elements: ${analysis.paginationElements}`);
    console.log(`   Has infinite scroll: ${analysis.hasInfiniteScroll}`);
    console.log(`   Page height: ${analysis.pageHeight}px`);
    console.log(`   Viewport height: ${analysis.viewportHeight}px`);
    
    if (analysis.uniqueArticles !== 20) {
      console.log(`\n⚠️ ISSUE IDENTIFIED:`);
      if (analysis.uniqueArticles > 20) {
        console.log(`   The page is showing ${analysis.uniqueArticles - 20} extra articles beyond the expected 20.`);
        console.log(`   This could be due to:`);
        console.log(`   - Infinite scroll loading more content`);
        console.log(`   - Featured/sticky articles at the top`);
        console.log(`   - Different article types mixed in`);
      } else {
        console.log(`   The page is showing ${20 - analysis.uniqueArticles} fewer articles than expected.`);
      }
    }
    
    console.log(`\n📋 First 10 Articles Found:`);
    analysis.articles.slice(0, 10).forEach((article, index) => {
      console.log(`   ${index + 1}. ${article.title}`);
      console.log(`      Path: ${article.path}`);
      console.log(`      Has Image: ${article.hasImage ? 'Yes' : 'No'}`);
      console.log('');
    });
    
    if (analysis.articles.length > 10) {
      console.log(`   ... and ${analysis.articles.length - 10} more articles`);
    }
    
    // Scroll down to see if more content loads
    console.log('\n🔄 Testing for dynamic content loading...');
    const initialCount = analysis.uniqueArticles;
    
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    
    await page.waitForTimeout(3000); // Wait for potential lazy loading
    
    const afterScrollAnalysis = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      const articleLinks = allLinks.filter(link => {
        const href = link.getAttribute('href') || '';
        const isPropertyNews = href.includes('/property-news/');
        const isNotExcluded = !href.includes('/property-news/latest') && 
                             !href.includes('/property-news-search') && 
                             !href.includes('/property-news/news') && 
                             !href.includes('/property-news/in-depth');
        const isNotCategory = !href.includes('/category/') && 
                             !href.includes('/search') && 
                             !href.includes('/tag/');
        return isPropertyNews && isNotExcluded && isNotCategory;
      });
      
      const uniquePaths = new Set();
      articleLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        uniquePaths.add(href);
      });
      
      return uniquePaths.size;
    });
    
    console.log(`   Articles before scroll: ${initialCount}`);
    console.log(`   Articles after scroll: ${afterScrollAnalysis}`);
    
    if (afterScrollAnalysis > initialCount) {
      console.log(`   ✅ CONFIRMED: Page has dynamic loading (+${afterScrollAnalysis - initialCount} articles)`);
      console.log(`   📝 SOLUTION: MCP scraper should limit to first 20 articles before any scrolling`);
    } else {
      console.log(`   ❌ No additional content loaded on scroll`);
    }
    
    // Final recommendation
    console.log(`\n💡 Recommendations:`);
    if (analysis.uniqueArticles > 20) {
      console.log(`   1. The MCP scraper's limit of 20 articles is correct`);
      console.log(`   2. The page naturally shows ${analysis.uniqueArticles} articles`);
      console.log(`   3. The scraper should slice to exactly 20: articles.slice(0, 20)`);
      console.log(`   4. This is working as intended - no fix needed`);
    } else {
      console.log(`   1. Investigate why fewer than 20 articles are found`);
      console.log(`   2. Check article filtering logic`);
      console.log(`   3. Verify page loading is complete`);
    }
    
  } catch (error) {
    console.error('❌ Investigation failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the investigation
investigateArticleCount().catch(console.error);