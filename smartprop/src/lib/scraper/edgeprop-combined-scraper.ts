/**
 * Combined EdgeProp Scraper
 * Combines Simple scraper's reliable article discovery with MCP scraper's content extraction
 * This gives us the best of both worlds: reliable metadata + full content
 */

export interface CombinedArticle {
  nid: string;
  title: string;
  path: string;
  thumbnail: string;
  author: string;
  created: string;
  category: string | string[];
  description: string;
  created_on: string;
  keywords?: string[];
  
  // Full content from MCP scraper
  text_content: string;
  paragraphs: string[];
  links: Array<{text: string; url: string; type: 'internal' | 'external'}>;
  images: Array<{url: string; alt?: string; caption?: string}>;
  main_image_url?: string;
  main_image_caption?: string;
  word_count: number;
  reading_time_minutes: number;
  
  scraped_at: Date;
}

export interface CombinedProgress {
  currentPage: number;
  totalPages: number;
  currentArticle: number;
  articlesDiscovered: number;
  articlesScraped: number;
  articlesFailed: number;
  status: 'running' | 'completed' | 'stopped' | 'error';
  message: string;
}

export type CombinedProgressCallback = (progress: CombinedProgress) => void;

/**
 * Combined EdgeProp scraper - Simple discovery + MCP content extraction
 */
export async function scrapeEdgePropCombined(
  maxPages: number,
  onProgress: CombinedProgressCallback,
  sessionId?: string
): Promise<CombinedArticle[]> {
  console.log('Starting combined EdgeProp scraper (Simple discovery + MCP content)...');
  
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
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });
  
  // Create context with realistic user agent and settings
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    }
  });
  
  const page = await context.newPage();
  
  const allArticles: CombinedArticle[] = [];
  const seenIds = new Set<string>();
  let articlesFailed = 0;
  
  try {
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: 0,
      articlesScraped: 0,
      articlesFailed: 0,
      status: 'running',
      message: 'Starting combined EdgeProp scraper...'
    });
    
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`Combined scraper: Starting page ${pageNum} of ${maxPages}`);
      
      onProgress({
        currentPage: pageNum,
        totalPages: maxPages,
        currentArticle: 0,
        articlesDiscovered: seenIds.size,
        articlesScraped: allArticles.length,
        articlesFailed,
        status: 'running',
        message: `Page ${pageNum}: Discovering articles...`
      });
      
      // STEP 1: Use Simple scraper's reliable article discovery
      const url = `https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=${pageNum}&page_size=20&sort_by=posted_desc&category=`;
      console.log(`Combined scraper: Navigating to: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      console.log(`Combined scraper: Navigation completed for page ${pageNum}`);
      
      // Wait for dynamic content to load
      await page.waitForTimeout(10000);
      console.log(`Combined scraper: Wait completed for page ${pageNum}`);
      
      // Extract articles using Simple scraper's reliable method
      console.log('Combined scraper: Starting article discovery (Simple method)...');
      const discoveredArticles = await page.evaluate(() => {
        console.log('Combined scraper: Inside page.evaluate() for discovery');
        
        const propertyNewsLinks = document.querySelectorAll('a[href*="/property-news/"]');
        console.log(`Combined scraper: Found ${propertyNewsLinks.length} property news links`);
        
        const extracted: CombinedArticle[] = [];
        
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
              // Find thumbnail image near this link
              let thumbnail = 'https://via.placeholder.com/300x200/4F46E5/FFFFFF?text=EdgeProp+News';
              const parentElement = link.closest('article, .article-item, .news-item, div, [class*="item"], [class*="card"], [class*="post"]');
              if (parentElement) {
                const imgSelectors = [
                  'img[src*="s3fs-public"]',
                  'img[src*="edgeprop"]',
                  'img[class*="thumbnail"]',
                  'img[class*="featured"]',
                  'img[class*="main"]',
                  'img[class*="image"]',
                  'img'
                ];
                
                for (const selector of imgSelectors) {
                  const img = parentElement.querySelector(selector);
                  if (img) {
                    const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
                    if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('avatar') && src.length > 10) {
                      thumbnail = src;
                      break;
                    }
                  }
                }
              }
              
              extracted.push({
                nid: `combined-${index}-${Date.now()}`,
                title: title,
                path: href.replace('https://www.edgeprop.sg/', ''),
                thumbnail: thumbnail,
                author: 'Unknown', // Will be updated when we scrape content
                created: new Date().toISOString(),
                category: ['Property News'],
                description: title.substring(0, 200),
                created_on: new Date().toISOString(),
                text_content: '', // Will be populated during content scraping
                paragraphs: [], // Will be populated during content scraping
                links: [], // Will be populated during content scraping
                images: [], // Will be populated during content scraping
                word_count: 0, // Will be calculated during content scraping
                reading_time_minutes: 0, // Will be calculated during content scraping
                scraped_at: new Date()
              });
              console.log(`Combined scraper: Discovered article: ${title}`);
            }
          }
        });
        
        console.log(`Combined scraper: Total articles discovered: ${extracted.length}`);
        return extracted;
      });
      
      console.log(`Combined scraper: Found ${discoveredArticles.length} articles on page ${pageNum}`);
      
      if (discoveredArticles.length > 0) {
        onProgress({
          currentPage: pageNum,
          totalPages: maxPages,
          currentArticle: 0,
          articlesDiscovered: seenIds.size + discoveredArticles.length,
          articlesScraped: allArticles.length,
          articlesFailed,
          status: 'running',
          message: `Page ${pageNum}: Discovered ${discoveredArticles.length} articles, now extracting full content...`
        });
        
        // STEP 2: Use MCP scraper's content extraction for each discovered article
        for (let i = 0; i < discoveredArticles.length; i++) {
          const discoveredArticle = discoveredArticles[i];
          
          // Skip duplicates
          if (seenIds.has(discoveredArticle.nid)) continue;
          seenIds.add(discoveredArticle.nid);
          
          onProgress({
            currentPage: pageNum,
            totalPages: maxPages,
            currentArticle: i + 1,
            articlesDiscovered: seenIds.size,
            articlesScraped: allArticles.length,
            articlesFailed,
            status: 'running',
            message: `Page ${pageNum}: Extracting content for article ${i + 1}/${discoveredArticles.length}: ${discoveredArticle.title.substring(0, 50)}...`
          });
          
          try {
            // Navigate to article page with timeout
            const articleUrl = `https://www.edgeprop.sg/${discoveredArticle.path}`;
            await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(2000);
            
            // Extract metadata AND content using MCP scraper's method
            const articleData = await page.evaluate(() => {
              console.log('🔍 Starting article content extraction...');
              
              // Use document.body as the content container since EdgeProp structure is complex
              const contentContainer = document.body;
              console.log(`Using document.body as content container`);
              
              // Extract metadata from article page
              let author = 'EdgeProp Staff'; // Default author
              let publishedDate = '';
              let categories: string[] = [];
              
              // Try to find author - based on actual EdgeProp structure
              const authorSelectors = [
                'meta[name="author"]',
                '[class*="author"]',
                '[class*="byline"]',
                '.writer-name',
                '.author-name'
              ];
              
              // Look for "By Author Name" pattern in the page
              const byPattern = /By\s+([^/|]+)/i;
              const pageText = document.body.textContent || '';
              const byMatch = pageText.match(byPattern);
              if (byMatch && byMatch[1]) {
                author = byMatch[1].trim();
              } else {
                // Fallback to selectors
                for (const selector of authorSelectors) {
                  const authorElement = document.querySelector(selector);
                  if (authorElement) {
                    const authorText = authorElement.getAttribute('content') || authorElement.textContent?.trim();
                    if (authorText && 
                        authorText !== 'Unknown' && 
                        authorText.length > 2 && 
                        authorText.length < 100 &&
                        !authorText.includes('EdgeProp') &&
                        !authorText.includes('Contact') &&
                        !authorText.includes('Agent')) {
                      author = authorText;
                      break;
                    }
                  }
                }
              }
              
              // Try to find published date
              const dateElement = document.querySelector('time, [class*="date"], [class*="published"], meta[property="article:published_time"]');
              if (dateElement) {
                publishedDate = dateElement.getAttribute('datetime') || 
                                dateElement.getAttribute('content') || 
                                dateElement.textContent?.trim() || '';
              }
              
              // Try to find categories/tags
              const categoryElements = document.querySelectorAll('[class*="category"], [class*="tag"], meta[property="article:section"]');
              categories = Array.from(categoryElements).map(el => 
                el.getAttribute('content') || el.textContent?.trim()
              ).filter(Boolean);
              
              if (categories.length === 0) {
                categories = ['Property News'];
              }
              
              // Extract text content and paragraphs (NO HTML, NO IMAGES)
              // Simple approach: get all text and filter out navigation/footer content
              // First, remove social sharing buttons from the DOM before extracting content
              const socialSharingButtons = Array.from(contentContainer.querySelectorAll('a, button, div')).filter(el => {
                const text = (el.textContent || '').toLowerCase();
                const href = (el as HTMLElement).getAttribute('href') || '';
                return text.includes('facebook sharing button') ||
                       text.includes('twitter sharing button') ||
                       text.includes('linkedin sharing button') ||
                       text.includes('messenger sharing button') ||
                       text.includes('whatsapp sharing button') ||
                       text.includes('email sharing button') ||
                       text.includes('wechat sharing button') ||
                       (href && (href.includes('facebook.com/share') || 
                                 href.includes('twitter.com/intent') ||
                                 href.includes('linkedin.com/shareArticle') ||
                                 href.includes('wa.me') ||
                                 href.includes('wechat') ||
                                 href.startsWith('mailto:')));
              });
              socialSharingButtons.forEach(btn => btn.remove());
              
              let paragraphs: string[] = [];
              
              // Get all text content from the page
              const allText = contentContainer.textContent || '';
              console.log(`Total text length: ${allText.length}`);
              
              if (allText.length > 100) {
                // Split by common paragraph boundaries and filter
                paragraphs = allText
                  .split(/\n\s*\n|\.\s+(?=[A-Z])/)
                  .map(p => p.trim())
                  .filter(text => {
                    if (!text || text.length <= 50 || text.length >= 1500) return false;
                    const lowerText = text.toLowerCase();
                    return !lowerText.includes('edgeprop') && // Filter out navigation
                           !lowerText.includes('follow us') &&
                           !lowerText.includes('subscribe') &&
                           !lowerText.includes('download') &&
                           !lowerText.includes('popular projects') &&
                           !lowerText.includes('property research') &&
                           !lowerText.includes('properties for sale') &&
                           !lowerText.includes('browse listings') &&
                           !lowerText.includes('our site') &&
                           !lowerText.includes('about us') &&
                           !lowerText.includes('terms') &&
                           !lowerText.includes('privacy') &&
                           !lowerText.includes('contact') &&
                           !lowerText.includes('advertise') &&
                           !lowerText.includes('user guide') &&
                           !lowerText.includes('we\'re hiring') &&
                           !lowerText.includes('faqs') &&
                           !lowerText.includes('sale') &&
                           !lowerText.includes('rent') &&
                           !lowerText.includes('new launches') &&
                           !lowerText.includes('analytics') &&
                           !lowerText.includes('news') &&
                           !lowerText.includes('ask buddy') &&
                           !lowerText.includes('agent') &&
                           !lowerText.includes('register') &&
                           !lowerText.includes('login') &&
                           // Filter out social sharing button text
                           !lowerText.includes('facebook sharing button') &&
                           !lowerText.includes('twitter sharing button') &&
                           !lowerText.includes('linkedin sharing button') &&
                           !lowerText.includes('messenger sharing button') &&
                           !lowerText.includes('whatsapp sharing button') &&
                           !lowerText.includes('email sharing button') &&
                           !lowerText.includes('wechat sharing button');
                  })
                  .slice(0, 20); // Limit to first 20 meaningful paragraphs
              }
              
              console.log(`Found ${paragraphs.length} paragraphs from article content`);
              
              const textContent = paragraphs.join('\n\n');
              const wordCount = textContent.split(/\s+/).length;
              const readingTime = Math.ceil(wordCount / 200);
              
              // Extract links only
              const links = Array.from(contentContainer.querySelectorAll('a'))
                .map(link => ({
                  text: link.textContent?.trim() || '',
                  url: link.getAttribute('href') || '',
                  type: (link.getAttribute('href')?.includes('edgeprop.sg') ? 'internal' : 'external') as 'internal' | 'external'
                }))
                .filter(link => link.url);
              
              const description = paragraphs.length > 0 ? paragraphs[0].substring(0, 200) : '';
              
              return {
                author,
                created: publishedDate,
                category: categories,
                description,
                text_content: textContent,
                paragraphs,
                links,
                word_count: wordCount,
                reading_time_minutes: readingTime
              };
            });
            
            if (articleData) {
              // Combine discovered metadata with extracted content
              const combinedArticle: CombinedArticle = {
                ...discoveredArticle,
                author: articleData.author,
                created: articleData.created || discoveredArticle.created,
                category: articleData.category,
                description: articleData.description || discoveredArticle.description,
                text_content: articleData.text_content,
                paragraphs: articleData.paragraphs,
                links: articleData.links,
                word_count: articleData.word_count,
                reading_time_minutes: articleData.reading_time_minutes,
                scraped_at: new Date()
              };

              allArticles.push(combinedArticle);
              console.log(`✅ Combined scraper: ${discoveredArticle.title} by ${articleData.author}`);
            } else {
              articlesFailed++;
              console.log(`❌ Combined scraper: Failed to extract content: ${discoveredArticle.title}`);
            }
            
          } catch (error: unknown) {
            articlesFailed++;
            console.error(`Combined scraper: Failed to scrape article ${discoveredArticle.title}:`, error);
          }
          
          // Respectful delay between articles
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else {
        console.log(`Combined scraper: No articles found on page ${pageNum}`);
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
      message: `Combined scraping completed! Found ${allArticles.length} articles with full content, ${articlesFailed} failed.`
    });
    
    console.log(`Combined scraper: Final result - ${allArticles.length} articles found with full content`);
    return allArticles;
    
  } finally {
    await browser.close();
  }
}
