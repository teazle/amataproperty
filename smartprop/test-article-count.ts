import { chromium } from 'playwright';

async function testArticleCount() {
  console.log('🚀 Testing article count on EdgeProp latest page...');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://www.edgeprop.sg/property-news/latest', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    const results = await page.evaluate(() => {
      // Count all links that contain /property-news/
      const allPropertyNewsLinks = Array.from(document.querySelectorAll('a[href*="/property-news/"]'));
      console.log(`Total property-news links: ${allPropertyNewsLinks.length}`);
      
      // Filter out category pages and other non-article links
      const articleLinks = allPropertyNewsLinks.filter(link => {
        const href = link.getAttribute('href') || '';
        return href.includes('/property-news/') &&
               !href.includes('/property-news-search') &&
               !href.includes('/property-news/latest') &&
               !href.includes('/property-news/news') &&
               !href.includes('/property-news/in-depth') &&
               !href.includes('/property-news/showcase') &&
               !href.includes('/property-news/deal-watch') &&
               !href.includes('/property-news/international') &&
               !href.includes('/property-news/personality') &&
               !href.includes('/property-news/mandarin');
      });
      
      // Get unique article URLs
      const uniqueUrls = new Set();
      const articleData: any[] = [];
      
      articleLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        const text = link.textContent?.trim() || '';
        const normalizedHref = href.replace(/^https?:\/\/www\.edgeprop\.sg/, '').replace(/^([^/])/, '/$1');
        
        if (!uniqueUrls.has(normalizedHref)) {
          uniqueUrls.add(normalizedHref);
          articleData.push({
            href: normalizedHref,
            text: text,
            textLength: text.length
          });
        }
      });
      
      return {
        totalPropertyNewsLinks: allPropertyNewsLinks.length,
        filteredArticleLinks: articleLinks.length,
        uniqueArticles: articleData.length,
        articles: articleData.slice(0, 25) // Show first 25
      };
    });
    
    console.log(`📊 Results:`);
    console.log(`- Total property-news links: ${results.totalPropertyNewsLinks}`);
    console.log(`- After filtering: ${results.filteredArticleLinks}`);
    console.log(`- Unique articles: ${results.uniqueArticles}`);
    console.log(`\n📝 First ${Math.min(25, results.articles.length)} articles:`);
    
    results.articles.forEach((article, index) => {
      console.log(`${index + 1}. ${article.href}`);
      console.log(`   Text: "${article.text}" (${article.textLength} chars)`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

testArticleCount().catch((error) => console.error(error));