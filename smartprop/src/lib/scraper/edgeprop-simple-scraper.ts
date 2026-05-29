/**
 * Simple EdgeProp Scraper - Just find articles, no content extraction
 */

export interface SimpleArticle {
  nid: string;
  title: string;
  path: string;
  thumbnail: string;
  author: string;
  created: string;
  category: string[];
  description: string;
  created_on: string;
  keywords?: string[];
  
  scraped_at: Date;
}

export interface SimpleProgress {
  currentPage: number;
  totalPages: number;
  currentArticle: number;
  articlesDiscovered: number;
  articlesScraped: number;
  articlesFailed: number;
  status: 'running' | 'completed' | 'stopped' | 'error';
  message: string;
}

export type SimpleProgressCallback = (progress: SimpleProgress) => void;

/**
 * Simple EdgeProp scraper - just find articles
 */
export async function scrapeEdgePropSimple(
  maxPages: number,
  onProgress: SimpleProgressCallback,
  _sessionId?: string
): Promise<SimpleArticle[]> {
  console.log('Starting simple EdgeProp scraper...');
  
  const { chromium } = await import('playwright');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  
  const page = await context.newPage();
  
  const allArticles: SimpleArticle[] = [];
  const seenIds = new Set<string>();
  const articlesFailed = 0;
  
  try {
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: 0,
      articlesScraped: 0,
      articlesFailed: 0,
      status: 'running',
      message: 'Starting simple EdgeProp scraper...'
    });
    
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`Simple scraper: Starting page ${pageNum} of ${maxPages}`);
      
      onProgress({
        currentPage: pageNum,
        totalPages: maxPages,
        currentArticle: 0,
        articlesDiscovered: seenIds.size,
        articlesScraped: allArticles.length,
        articlesFailed,
        status: 'running',
        message: `Scraping page ${pageNum} of ${maxPages}...`
      });
      
      // Navigate to the page
      const url = `https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=${pageNum}&page_size=20&sort_by=posted_desc&category=`;
      console.log(`Simple scraper: Navigating to: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      console.log(`Simple scraper: Navigation completed for page ${pageNum}`);
      
      // Wait for dynamic content to load
      await page.waitForTimeout(10000);
      console.log(`Simple scraper: Wait completed for page ${pageNum}`);
      
      // Extract articles from the page
      console.log('Simple scraper: Starting article extraction...');
      const articles = await page.evaluate(() => {
        console.log('Simple scraper: Inside page.evaluate()');
        
        const propertyNewsLinks = document.querySelectorAll('a[href*="/property-news/"]');
        console.log(`Simple scraper: Found ${propertyNewsLinks.length} property news links`);
        
        const extracted: SimpleArticle[] = [];
        
        propertyNewsLinks.forEach((link, index) => {
          const href = link.getAttribute('href');
          const title = link.textContent?.trim();
          
          if (href && title && href.includes('/property-news/')) {
            // Only skip obvious navigation/category links, not actual articles
            const skipTitles = [
              'Latest News', 'In-Depth', 'Showcase', 'Deal Watch', 'International',
              'Special Feature', 'PROPERTY NEWS', 'NEWS / INTERNATIONAL', 'PERSONALITY'
            ];
            
            // Skip if it's just a category label or navigation
            if (!skipTitles.some(skipTitle => title === skipTitle) && title.length > 10) {
              extracted.push({
                nid: `simple-${index}-${Date.now()}`,
                title: title,
                path: href.replace('https://www.edgeprop.sg/', ''),
                thumbnail: '',
                author: 'Unknown',
                created: new Date().toISOString(),
                category: ['Property News'],
                description: title.substring(0, 200),
                created_on: new Date().toISOString(),
                scraped_at: new Date()
              });
              console.log(`Simple scraper: Added article: ${title}`);
            }
          }
        });
        
        console.log(`Simple scraper: Total articles extracted: ${extracted.length}`);
        return extracted;
      });
      
      console.log(`Simple scraper: Found ${articles.length} articles on page ${pageNum}`);
      
      if (articles.length > 0) {
        onProgress({
          currentPage: pageNum,
          totalPages: maxPages,
          currentArticle: 0,
          articlesDiscovered: seenIds.size + articles.length,
          articlesScraped: allArticles.length,
          articlesFailed,
          status: 'running',
          message: `Found ${articles.length} articles on page ${pageNum}, processing...`
        });
        
        // Add articles to our collection
        articles.forEach(article => {
          if (!seenIds.has(article.nid)) {
            seenIds.add(article.nid);
            allArticles.push(article);
          }
        });
        
        console.log(`Simple scraper: Total articles so far: ${allArticles.length}`);
      } else {
        console.log(`Simple scraper: No articles found on page ${pageNum}`);
      }
    }
    
    onProgress({
      currentPage: maxPages,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: seenIds.size,
      articlesScraped: allArticles.length,
      articlesFailed,
      status: 'completed',
      message: `Simple scraping completed! Found ${allArticles.length} articles, ${articlesFailed} failed.`
    });
    
    console.log(`Simple scraper: Final result - ${allArticles.length} articles found`);
    return allArticles;
    
  } finally {
    await browser.close();
  }
}
