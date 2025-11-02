/**
 * Analyze EdgeProp page structure to understand the correct scraping approach
 */

const { chromium } = require('playwright');

async function analyzeEdgePropStructure() {
  console.log('🔍 Analyzing EdgeProp page structure...');
  
  const browser = await chromium.launch({ 
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--disable-dev-shm-usage'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  try {
    // Navigate to EdgeProp property news
    console.log('📍 Navigating to EdgeProp property news...');
    await page.goto('https://www.edgeprop.sg/property-news', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    await page.waitForTimeout(3000);
    
    // Take initial screenshot
    await page.screenshot({ 
      path: 'edgeprop-initial-page.png', 
      fullPage: true 
    });
    console.log('📷 Saved initial page screenshot');
    
    // Analyze the page structure
    const pageAnalysis = await page.evaluate(() => {
      console.log('🔍 Starting page analysis...');
      
      // Look for "View All" or similar buttons
      const viewAllButtons = [];
      const buttonSelectors = [
        'button:has-text("View All")',
        'a:has-text("View All")',
        'button:has-text("Show All")',
        'a:has-text("Show All")',
        'button:has-text("Load More")',
        'a:has-text("Load More")',
        '[class*="view-all"]',
        '[class*="show-all"]',
        '[class*="load-more"]'
      ];
      
      buttonSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            viewAllButtons.push({
              selector: selector,
              text: el.textContent?.trim(),
              href: el.getAttribute('href'),
              className: el.className,
              tagName: el.tagName
            });
          });
        } catch (e) {
          console.log(`Selector failed: ${selector}`);
        }
      });
      
      // Count current articles visible
      const articleLinks = document.querySelectorAll('a[href*="/property-news/"]');
      const articleCount = articleLinks.length;
      
      // Look for pagination or navigation elements
      const paginationElements = [];
      const paginationSelectors = [
        '.pagination',
        '[class*="pagination"]',
        '[class*="pager"]',
        'nav[aria-label*="pagination"]',
        '.pager',
        '.page-numbers'
      ];
      
      paginationSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            paginationElements.push({
              selector: selector,
              text: el.textContent?.trim(),
              className: el.className,
              innerHTML: el.innerHTML.substring(0, 200)
            });
          });
        } catch (e) {
          console.log(`Pagination selector failed: ${selector}`);
        }
      });
      
      // Get page title and URL
      const pageTitle = document.title;
      const currentUrl = window.location.href;
      
      // Look for any text that mentions article counts
      const bodyText = document.body.textContent || '';
      const countMatches = bodyText.match(/(\d+)\s*(articles?|news|stories)/gi) || [];
      
      return {
        pageTitle,
        currentUrl,
        articleCount,
        viewAllButtons,
        paginationElements,
        countMatches,
        hasLoadMoreButton: viewAllButtons.length > 0,
        bodyTextLength: bodyText.length
      };
    });
    
    console.log('📊 Page Analysis Results:');
    console.log(`   Title: ${pageAnalysis.pageTitle}`);
    console.log(`   URL: ${pageAnalysis.currentUrl}`);
    console.log(`   Articles found: ${pageAnalysis.articleCount}`);
    console.log(`   View All buttons: ${pageAnalysis.viewAllButtons.length}`);
    console.log(`   Pagination elements: ${pageAnalysis.paginationElements.length}`);
    console.log(`   Count matches: ${JSON.stringify(pageAnalysis.countMatches)}`);
    
    if (pageAnalysis.viewAllButtons.length > 0) {
      console.log('\n🔘 View All buttons found:');
      pageAnalysis.viewAllButtons.forEach((btn, i) => {
        console.log(`   ${i + 1}. Text: "${btn.text}", Tag: ${btn.tagName}, Href: ${btn.href}`);
      });
    }
    
    if (pageAnalysis.paginationElements.length > 0) {
      console.log('\n📄 Pagination elements found:');
      pageAnalysis.paginationElements.forEach((elem, i) => {
        console.log(`   ${i + 1}. Text: "${elem.text?.substring(0, 100)}..."`);
      });
    }
    
    // Now try to navigate to the "latest" page which should show more articles
    console.log('\n📍 Navigating to /property-news/latest...');
    await page.goto('https://www.edgeprop.sg/property-news/latest', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    await page.waitForTimeout(3000);
    
    // Take screenshot of latest page
    await page.screenshot({ 
      path: 'edgeprop-latest-page.png', 
      fullPage: true 
    });
    console.log('📷 Saved latest page screenshot');
    
    // Analyze the latest page
    const latestPageAnalysis = await page.evaluate(() => {
      const articleLinks = document.querySelectorAll('a[href*="/property-news/"]');
      const articleCount = articleLinks.length;
      
      // Get first few article titles and URLs
      const articles = [];
      for (let i = 0; i < Math.min(5, articleLinks.length); i++) {
        const link = articleLinks[i];
        articles.push({
          title: link.textContent?.trim(),
          href: link.getAttribute('href'),
          fullUrl: link.href
        });
      }
      
      return {
        pageTitle: document.title,
        currentUrl: window.location.href,
        articleCount,
        sampleArticles: articles
      };
    });
    
    console.log('\n📊 Latest Page Analysis:');
    console.log(`   Title: ${latestPageAnalysis.pageTitle}`);
    console.log(`   URL: ${latestPageAnalysis.currentUrl}`);
    console.log(`   Articles found: ${latestPageAnalysis.articleCount}`);
    
    if (latestPageAnalysis.sampleArticles.length > 0) {
      console.log('\n📰 Sample articles:');
      latestPageAnalysis.sampleArticles.forEach((article, i) => {
        console.log(`   ${i + 1}. "${article.title?.substring(0, 60)}..." -> ${article.href}`);
      });
    }
    
    // Keep browser open for manual inspection
    console.log('\n⏳ Keeping browser open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);
    
  } catch (error) {
    console.error('❌ Error during analysis:', error);
  } finally {
    await browser.close();
  }
}

analyzeEdgePropStructure().catch((error) => console.error(error));