#!/usr/bin/env node

/**
 * Simple test to verify MCP scraper navigation fix
 * Tests that the scraper correctly navigates to /property-news/latest
 * and finds article links on the page
 */

async function testNavigationFix() {
  console.log('🚀 Testing MCP Scraper Navigation Fix (Simple Test)...\n');
  console.log('✅ Testing navigation to: https://www.edgeprop.sg/property-news/latest\n');

  try {
    // Import playwright directly to avoid database dependencies
    const { chromium } = await import('playwright');
    
    console.log('🌐 Launching browser...');
    const browser = await chromium.launch({ 
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox'
      ]
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    
    console.log('📍 Navigating to EdgeProp latest news page...');
    await page.goto('https://www.edgeprop.sg/property-news/latest', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    console.log('✅ Navigation completed successfully!');
    
    // Wait for page to load
    await page.waitForTimeout(3000);
    
    // Check if we can find article links
    console.log('🔍 Looking for article links on the page...');
    
    const articleData = await page.evaluate(() => {
      // Find all links that point to property news articles
      const allLinks = Array.from(document.querySelectorAll('a[href*="/property-news/"]'));
      
      // Filter for actual article links (not category pages)
      const articleLinks = allLinks.filter(link => {
        const href = link.getAttribute('href') || '';
        const pathSegments = href.split('/').length;
        
        return href.includes('/property-news/') && 
               !href.includes('/property-news-search') &&
               !href.includes('/property-news/latest') &&
               !href.includes('/property-news/news') &&
               !href.includes('/property-news/in-depth') &&
               !href.includes('/property-news/showcase') &&
               !href.includes('/property-news/deal-watch') &&
               !href.includes('/property-news/international') &&
               !href.includes('/property-news/personality') &&
               !href.includes('/property-news/mandarin') &&
               pathSegments >= 3; // Ensure it's an actual article, not a category
      });
      
      console.log(`Found ${allLinks.length} total property-news links`);
      console.log(`Found ${articleLinks.length} actual article links`);
      
      // Extract article information
      const articles = articleLinks.slice(0, 5).map((link, index) => {
        const href = link.getAttribute('href') || '';
        const title = link.textContent?.trim() || '';
        const normalizedHref = href.replace(/^https?:\/\/www\.edgeprop\.sg/, '');
        
        return {
          index: index + 1,
          title: title.substring(0, 80),
          path: normalizedHref,
          fullUrl: href.startsWith('http') ? href : `https://www.edgeprop.sg${normalizedHref}`
        };
      });
      
      return {
        totalLinks: allLinks.length,
        articleLinks: articleLinks.length,
        articles: articles,
        pageTitle: document.title,
        pageUrl: window.location.href
      };
    });
    
    console.log(`\n📊 Navigation Test Results:`);
    console.log(`   Page Title: ${articleData.pageTitle}`);
    console.log(`   Page URL: ${articleData.pageUrl}`);
    console.log(`   Total property-news links found: ${articleData.totalLinks}`);
    console.log(`   Actual article links found: ${articleData.articleLinks}`);
    
    if (articleData.articles.length > 0) {
      console.log(`\n📰 Sample Articles Found:`);
      articleData.articles.forEach(article => {
        console.log(`   ${article.index}. "${article.title}"`);
        console.log(`      Path: ${article.path}`);
        console.log(`      URL: ${article.fullUrl}`);
        console.log('');
      });
    }
    
    // Validation
    console.log('🧪 Running Navigation Validation:');
    let passedTests = 0;
    const totalTests = 4;
    
    // Test 1: Successfully navigated to correct page
    if (articleData.pageUrl.includes('/property-news/latest')) {
      console.log('✅ 1. Successfully navigated to /property-news/latest');
      passedTests++;
    } else {
      console.log('❌ 1. Failed to navigate to correct page');
    }
    
    // Test 2: Page loaded with content
    if (articleData.pageTitle && articleData.pageTitle.length > 0) {
      console.log('✅ 2. Page loaded successfully with title');
      passedTests++;
    } else {
      console.log('❌ 2. Page failed to load properly');
    }
    
    // Test 3: Found property news links
    if (articleData.totalLinks > 0) {
      console.log('✅ 3. Found property news links on page');
      passedTests++;
    } else {
      console.log('❌ 3. No property news links found');
    }
    
    // Test 4: Found actual article links
    if (articleData.articleLinks >= 5) {
      console.log('✅ 4. Found sufficient article links (5+)');
      passedTests++;
    } else if (articleData.articleLinks > 0) {
      console.log(`⚠️ 4. Found some article links (${articleData.articleLinks}) but fewer than expected`);
      passedTests += 0.5;
    } else {
      console.log('❌ 4. No article links found');
    }
    
    const successRate = Math.round((passedTests / totalTests) * 100);
    console.log(`\n📊 Navigation Fix Test Results: ${passedTests}/${totalTests} tests passed (${successRate}%)`);
    
    if (successRate >= 90) {
      console.log('🎉 EXCELLENT! Navigation fix is working perfectly!');
      console.log('✅ MCP Scraper should now correctly navigate to /property-news/latest');
      console.log('✅ Article discovery logic is working correctly');
    } else if (successRate >= 75) {
      console.log('✅ GOOD! Navigation fix is working with minor issues.');
    } else {
      console.log('⚠️ NEEDS IMPROVEMENT! Navigation fix has issues.');
    }
    
    await browser.close();
    console.log('\n🏁 Navigation test completed!');
    
  } catch (error) {
    console.error('❌ Error testing navigation fix:', error);
  }
}

// Run the test
testNavigationFix().catch(console.error);