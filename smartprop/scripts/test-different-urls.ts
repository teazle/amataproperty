#!/usr/bin/env tsx

/**
 * Test different EdgeProp URLs to find where articles are
 */

async function testDifferentUrls() {
  console.log('🔍 Testing different EdgeProp URLs...\n');
  
  try {
    const { chromium } = await import('playwright');
    
    const browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();
    
    const urlsToTest = [
      'https://www.edgeprop.sg/property-news',
      'https://www.edgeprop.sg/property-news/latest',
      'https://www.edgeprop.sg/news/latest',
      'https://www.edgeprop.sg/news',
      'https://www.edgeprop.sg/'
    ];
    
    for (const url of urlsToTest) {
      console.log(`\n📄 Testing URL: ${url}`);
      
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded', 
          timeout: 30000 
        });
        
        await page.waitForTimeout(3000);
        
        const pageInfo = await page.evaluate(() => {
          const title = document.title;
          const currentUrl = window.location.href;
          
          // Count different types of links
          const allLinks = Array.from(document.querySelectorAll('a[href]'));
          const propertyNewsLinks = allLinks.filter(link => 
            link.getAttribute('href')?.includes('/property-news/') && 
            link.textContent?.trim() && 
            link.textContent.trim().length > 10
          );
          
          const newsLinks = allLinks.filter(link => 
            link.getAttribute('href')?.includes('/news/') && 
            link.textContent?.trim() && 
            link.textContent.trim().length > 10
          );
          
          const articleLinks = allLinks.filter(link => 
            link.getAttribute('href')?.includes('/article/') && 
            link.textContent?.trim() && 
            link.textContent.trim().length > 10
          );
          
          // Look for any links that might be articles (with images)
          const potentialArticles = allLinks.filter(link => {
            const href = link.getAttribute('href') || '';
            const text = link.textContent?.trim() || '';
            const hasImage = link.querySelector('img') !== null;
            const parentHasImage = link.parentElement?.querySelector('img') !== null;
            
            return (
              text.length > 15 &&
              (hasImage || parentHasImage) &&
              (href.includes('edgeprop.sg') || href.startsWith('/')) &&
              !text.toLowerCase().includes('search') &&
              !text.toLowerCase().includes('subscribe') &&
              !text.toLowerCase().includes('follow') &&
              !text.toLowerCase().includes('latest') &&
              !text.toLowerCase().includes('category')
            );
          });
          
          // Get sample article links
          const sampleArticles = potentialArticles.slice(0, 5).map(link => ({
            text: link.textContent?.trim().substring(0, 80),
            href: link.getAttribute('href'),
            hasImage: link.querySelector('img') !== null
          }));
          
          return {
            title,
            currentUrl,
            totalLinks: allLinks.length,
            propertyNewsLinks: propertyNewsLinks.length,
            newsLinks: newsLinks.length,
            articleLinks: articleLinks.length,
            potentialArticles: potentialArticles.length,
            sampleArticles
          };
        });
        
        console.log(`   Title: ${pageInfo.title}`);
        console.log(`   Final URL: ${pageInfo.currentUrl}`);
        console.log(`   Total links: ${pageInfo.totalLinks}`);
        console.log(`   Property news links: ${pageInfo.propertyNewsLinks}`);
        console.log(`   News links: ${pageInfo.newsLinks}`);
        console.log(`   Article links: ${pageInfo.articleLinks}`);
        console.log(`   Potential articles: ${pageInfo.potentialArticles}`);
        
        if (pageInfo.sampleArticles.length > 0) {
          console.log(`   Sample articles:`);
          pageInfo.sampleArticles.forEach((article, index) => {
            console.log(`      ${index + 1}. "${article.text}"`);
            console.log(`         ${article.href}`);
          });
        }
        
        // Take a screenshot if this looks promising
        if (pageInfo.potentialArticles > 5) {
          const filename = `edgeprop-${url.replace(/[^a-zA-Z0-9]/g, '-')}.png`;
          await page.screenshot({ path: filename, fullPage: false });
          console.log(`   📸 Screenshot saved: ${filename}`);
        }
        
      } catch (error) {
        console.log(`   ❌ Failed to load: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    await browser.close();
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
  }
}

// Run the test
testDifferentUrls().catch(console.error);