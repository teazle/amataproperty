/**
 * EdgeProp Unified Scraper
 * One-pass scraping: Discovers articles from API + Immediately scrapes full content
 * Combines metadata discovery with full content extraction
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { type ArticleContent as _ArticleContent } from './edgeprop-content-scraper';
import { cleanArticleParagraphs, sanitizeHtmlContent as _sanitizeHtmlContent, extractCleanTextContent as _extractCleanTextContent } from '@/lib/utils/content-parser';
import { solveCloudflareWithFlaresolverr, applyFlaresolverrToContext, FLARESOLVERR_UA } from '@/workers/flaresolverr';

export interface UnifiedArticle {
  // Metadata (from API)
  nid: string;
  title: string;
  path: string;
  thumbnail: string;
  author: string;
  created: string;
  category: string | string[];
  description?: string;
  created_on: string;
  keywords?: string[];
  
  // Full Content (from page scraping)
  html_content: string | null;
  text_content: string;
  paragraphs: string[];
  images: string[] | null;
  links: Array<{text: string; url: string; type: 'internal' | 'external'}>;
  main_image_url: string | null;
  main_image_caption?: string | null;
  tags: string[] | null;
  word_count: number;
  reading_time_minutes: number;
  
  // Scraping Method Tracking
  discovery_method: 'api' | 'dom' | 'unknown';
  
  // Tracking
  scraped_at: Date;
}

export interface CapturedApiData {
  total?: number;
  results?: unknown[];
  response?: unknown[] | { results?: unknown[] };
  data?: unknown[];
  articles?: unknown[];
  url?: string;
  timestamp?: number;
  discovery_method?: 'api' | 'dom' | 'unknown';
}

export interface UnifiedProgress {
  currentPage: number;
  totalPages: number;
  currentArticle: number;
  articlesDiscovered: number;
  articlesScraped: number;
  articlesFailed: number;
  status: 'running' | 'completed' | 'stopped' | 'error';
  message: string;
}

export type UnifiedProgressCallback = (progress: UnifiedProgress) => void;

let currentBrowser: Browser | null = null;
let shouldStop = false;

/**
 * Unified scraper: Discovers articles from API and immediately scrapes full content
 */
export async function scrapeEdgePropUnified(
  maxPages: number,
  onProgress: UnifiedProgressCallback,
  sessionId?: string
): Promise<UnifiedArticle[]> {
  shouldStop = false;
  const allArticles: UnifiedArticle[] = [];
  const seenIds = new Set<string>();
  let capturedData: CapturedApiData | unknown[] | null = null;
  let currentPage: Page | null = null;
  let context: BrowserContext | null = null;
  let articlesFailed = 0;
  
  // Import database functions if session ID provided
  let dbModule: typeof import('@/lib/db/articles') | null = null;
  let contentDbModule: typeof import('@/lib/db/article-content') | null = null;
  if (sessionId) {
    dbModule = await import('@/lib/db/articles');
    contentDbModule = await import('@/lib/db/article-content');
  }
  
  try {
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: 0,
      articlesScraped: 0,
      articlesFailed,
      status: 'running',
      message: 'Launching browser...'
    });
    
    currentBrowser = await chromium.launch({ 
      headless: true,
      timeout: 10000, // 10 second timeout for browser launch
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        // Memory optimization flags (safe, won't break functionality)
        '--disable-software-rasterizer', // Reduce memory usage
        '--disable-background-networking', // Disable background networking
        '--disable-background-timer-throttling', // Disable background timers
        '--disable-backgrounding-occluded-windows', // Disable backgrounding
        '--disable-renderer-backgrounding', // Disable renderer backgrounding
        // Note: We don't set --max-old-space-size because:
        // 1. It's for Node.js V8 heap, not Chromium
        // 2. Setting it too low can break JavaScript execution
        // 3. Chromium manages its own memory better without this flag
      ]
    });
    // Create context with realistic user agent and settings
    context = await currentBrowser.newContext({
      userAgent: FLARESOLVERR_UA, // Match Flaresolverr's user-agent
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
    
    currentPage = await context.newPage();
    
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: 0,
      articlesScraped: 0,
      articlesFailed,
      status: 'running',
      message: 'Browser launched, navigating to EdgeProp...'
    });
    
    // Use Flaresolverr to solve Cloudflare before initial navigation
    const initialUrl = 'https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=1&page_size=20&sort_by=posted_desc&category=';
    // Use useSession: false to prevent multiple Chrome instances and OOM kills
    const flaresolverrResult = await solveCloudflareWithFlaresolverr(initialUrl, false);
    
    if (flaresolverrResult && flaresolverrResult.cookies.length > 0) {
      await applyFlaresolverrToContext(context, flaresolverrResult, '.edgeprop.sg');
      await currentPage.waitForTimeout(500);
    }
    
    // Set up request interception to catch API calls
    await currentPage.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      
      // Log all requests to help debug what EdgeProp is actually calling
      if (url.includes('edgeprop.sg') && (url.includes('api') || url.includes('search') || url.includes('news') || url.includes('proxy'))) {
        console.log('🔍 Intercepted request:', request.method(), url);
      }
      
      // Continue with the request
      await route.continue();
    });
    
    // Intercept API calls to get article metadata - improved targeting
    currentPage.on('response', async (response) => {
      const url = response.url();
      const status = response.status();
      const contentType = response.headers()['content-type'] || '';
      
      // Only log responses that might be relevant to reduce noise
      if (status === 200 && contentType.includes('json')) {
        console.log('📡 JSON response from:', url);
      }
      
      // Target specific EdgeProp API patterns more precisely
      const isEdgePropAPI = status === 200 && 
        contentType.includes('json') && (
          // EdgeProp specific API endpoints
          url.includes('/api/property-news') ||
          url.includes('/api/search') ||
          url.includes('/property-news-search') ||
          url.includes('/proxy/news') ||  // EdgeProp uses proxy endpoint for article data
          // XHR/fetch requests that might be the article listing API
          (url.includes('edgeprop.sg') && 
           (url.includes('search') || url.includes('news') || url.includes('api') || url.includes('proxy')) &&
           url.includes('page=') && url.includes('page_size='))
        );
      
      if (isEdgePropAPI) {
        console.log('🎯 Intercepted EdgeProp API response from:', url);
        
        try {
            const data = await response.json();
          console.log('📊 API response structure:', Object.keys(data));
          console.log('🔍 Response URL:', url);
          
          // Special handling for proxy endpoint
          if (url.includes('/proxy/news')) {
            console.log('🎯 Detected EdgeProp proxy/news endpoint - this is likely the article data!');
            console.log('📋 Proxy response keys:', Object.keys(data));
            if (data.response) {
              console.log('📋 Response structure:', typeof data.response, Array.isArray(data.response) ? data.response.length : 'not array');
            }
          }
          
          // More robust data structure detection
          let articles = null;
          let totalCount = 0;
          
              if (data.response && Array.isArray(data.response)) {
            articles = data.response;
            totalCount = data.total || articles.length;
            console.log(`✅ Found ${articles.length} articles in response array (total: ${totalCount})`);
          } else if (data.response && data.response.results && Array.isArray(data.response.results)) {
            articles = data.response.results;
            totalCount = data.response.total || articles.length;
            console.log(`✅ Found ${articles.length} articles in response.results (total: ${totalCount})`);
          } else if (data.results && Array.isArray(data.results)) {
            articles = data.results;
            totalCount = data.total || articles.length;
            console.log(`✅ Found ${articles.length} articles in results (total: ${totalCount})`);
          } else if (data.data && Array.isArray(data.data)) {
            articles = data.data;
            totalCount = data.total || articles.length;
            console.log(`✅ Found ${articles.length} articles in data (total: ${totalCount})`);
          } else if (data.articles && Array.isArray(data.articles)) {
            articles = data.articles;
            totalCount = data.total || articles.length;
            console.log(`✅ Found ${articles.length} articles in articles (total: ${totalCount})`);
          } else if (Array.isArray(data) && data.length > 0) {
            articles = data;
            totalCount = data.length;
            console.log(`✅ Found ${articles.length} articles as direct array (total: ${totalCount})`);
          }
          
          // Validate that we have actual article data
          if (articles && articles.length > 0) {
            const firstArticle = articles[0];
            if (firstArticle && (firstArticle.nid || firstArticle.title || firstArticle.path)) {
              capturedData = {
                response: articles,
                total: totalCount,
                url: url,
                timestamp: Date.now(),
                discovery_method: 'api' // Mark as API discovery
              };
              console.log(`🎯 API interception SUCCESS! Captured ${articles.length} articles with valid structure`);
              console.log(`📝 Sample article: ${firstArticle.title?.substring(0, 50)}...`);
            } else {
              console.log('⚠️ API response contains invalid article structure');
            }
          } else {
            console.log('⚠️ No valid articles found in API response');
          }
          
        } catch (error) {
          console.error('❌ Failed to parse API response:', error instanceof Error ? error.message : String(error));
          console.log('📄 Response URL:', url);
          console.log('📄 Content-Type:', contentType);
        }
      }
    });
    
    // Navigate to first page with timeout
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: 0,
      articlesScraped: 0,
      articlesFailed,
      status: 'running',
      message: 'Navigating to EdgeProp...'
    });
    
    try {
      // Use Flaresolverr to solve Cloudflare before initial navigation
      const initialUrl = 'https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=1&page_size=20&sort_by=posted_desc&category=';
      // Use useSession: false to prevent multiple Chrome instances and OOM kills
    const flaresolverrResult = await solveCloudflareWithFlaresolverr(initialUrl, false);
      
      if (flaresolverrResult && flaresolverrResult.cookies.length > 0) {
        await applyFlaresolverrToContext(context, flaresolverrResult, '.edgeprop.sg');
        await currentPage.waitForTimeout(500);
      }

      await currentPage.goto(
        initialUrl,
        { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 // 30 second timeout
        }
      );
    } catch (error) {
      console.error('Navigation failed:', error);
      onProgress({
        currentPage: 0,
        totalPages: maxPages,
        currentArticle: 0,
        articlesDiscovered: 0,
        articlesScraped: 0,
        articlesFailed,
        status: 'error',
        message: `Navigation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      throw error;
    }
    
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: 0,
      articlesScraped: 0,
      articlesFailed,
      status: 'running',
      message: 'Page loaded, waiting for API data...'
    });
    
    // Create session in database
    if (sessionId && dbModule) {
      // Session already created by caller
    }
    
    const _apiMaxPages = (capturedData && typeof capturedData === 'object' && !Array.isArray(capturedData) && 'total' in capturedData && typeof (capturedData as CapturedApiData).total === 'number') 
      ? Math.ceil((capturedData as CapturedApiData).total! / 20) 
      : maxPages;
    
    // Iterate through pages
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`Starting page ${pageNum} of ${maxPages}`);
      if (shouldStop) {
        onProgress({
          currentPage: pageNum - 1,
          totalPages: maxPages,
          currentArticle: 0,
          articlesDiscovered: seenIds.size,
          articlesScraped: allArticles.length,
          articlesFailed,
          status: 'stopped',
          message: 'Scraping stopped by user'
        });
        break;
      }
      
      // Wait for API data with progress updates
      onProgress({
        currentPage: pageNum,
        totalPages: maxPages,
        currentArticle: 0,
        articlesDiscovered: seenIds.size,
        articlesScraped: allArticles.length,
        articlesFailed,
        status: 'running',
        message: `Page ${pageNum}: Waiting for API data...`
      });
      
      // Wait for API data with better error handling and progress updates
      let apiDataReceived = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        await currentPage.waitForTimeout(2000);
        
        // Check if we have valid captured data
        if (capturedData && (
          (typeof capturedData === 'object' && !Array.isArray(capturedData) && ('results' in capturedData || 'response' in capturedData || 'data' in capturedData || 'articles' in capturedData)) || 
          Array.isArray(capturedData)
        )) {
          apiDataReceived = true;
          console.log(`✅ API data received after ${attempt + 1} attempts`);
          break;
        }
        
        // Update progress every few attempts
        if (attempt % 3 === 0) {
          onProgress({
            currentPage: pageNum,
            totalPages: maxPages,
            currentArticle: 0,
            articlesDiscovered: seenIds.size,
            articlesScraped: allArticles.length,
            articlesFailed,
            status: 'running',
            message: `Page ${pageNum}: Waiting for API data... (attempt ${attempt + 1}/15)`
          });
        }
        
        console.log(`⏳ Waiting for API data... attempt ${attempt + 1}/15`);
      }
      
      if (!apiDataReceived) {
        console.log('⚠️ No API data received after 30 seconds, will fall back to DOM extraction');
        onProgress({
          currentPage: pageNum,
          totalPages: maxPages,
          currentArticle: 0,
          articlesDiscovered: seenIds.size,
          articlesScraped: allArticles.length,
          articlesFailed,
          status: 'running',
          message: `Page ${pageNum}: No API data, falling back to DOM extraction...`
        });
      }
      
      // Handle the actual EdgeProp API structure
      let pageArticles = null;
      const capturedDataObj = capturedData && !Array.isArray(capturedData) ? capturedData as CapturedApiData : null;
      
      if (capturedDataObj?.response && Array.isArray(capturedDataObj.response)) {
        pageArticles = capturedDataObj.response;
        console.log(`Found ${pageArticles.length} articles on page ${pageNum} (response array)`);
      } else if (capturedDataObj?.response && typeof capturedDataObj.response === 'object' && 'results' in capturedDataObj.response && Array.isArray(capturedDataObj.response.results)) {
        pageArticles = capturedDataObj.response.results;
        console.log(`Found ${pageArticles.length} articles on page ${pageNum} (response.results)`);
      } else if (capturedDataObj?.results) {
        pageArticles = capturedDataObj.results;
        console.log(`Found ${pageArticles.length} articles on page ${pageNum} (results)`);
      } else if (capturedDataObj?.data) {
        pageArticles = capturedDataObj.data;
        console.log(`Found ${pageArticles.length} articles on page ${pageNum} (data)`);
      } else if (capturedData?.articles) {
        pageArticles = capturedData.articles;
        console.log(`Found ${pageArticles.length} articles on page ${pageNum} (articles)`);
      } else if (Array.isArray(capturedData)) {
        pageArticles = capturedData;
        console.log(`Found ${pageArticles.length} articles on page ${pageNum} (array)`);
      }
      
      // Add discovery method to API articles if not present
      if (pageArticles && capturedData) {
        pageArticles.forEach((article: UnifiedArticle) => {
          if (!article.discovery_method) {
            article.discovery_method = 'api';
          }
        });
      }
      
      if (pageArticles && pageArticles.length > 0) {
        
        onProgress({
          currentPage: pageNum,
          totalPages: maxPages,
          currentArticle: 0,
          articlesDiscovered: seenIds.size + pageArticles.length,
          articlesScraped: allArticles.length,
          articlesFailed,
          status: 'running',
          message: `Page ${pageNum}: Discovered ${pageArticles.length} articles, now scraping full content...`
        });
        
        // Scrape full content for each article on this page (limit to first 5 for performance)
        const articlesToScrape = pageArticles.slice(0, 5);
        for (let i = 0; i < articlesToScrape.length; i++) {
          if (shouldStop) break;
          
          const article = articlesToScrape[i];
          
          // Skip duplicates
          if (seenIds.has(article.nid)) {
            continue;
          }
          seenIds.add(article.nid);
          
          onProgress({
            currentPage: pageNum,
            totalPages: maxPages,
            currentArticle: i + 1,
            articlesDiscovered: seenIds.size,
            articlesScraped: allArticles.length,
            articlesFailed,
            status: 'running',
            message: `Page ${pageNum}: Scraping article ${i + 1}/${articlesToScrape.length}: ${article.title.substring(0, 50)}...`
          });
          
          let articlePage: Page | null = null;
          try {
            // Open article page in new tab with better error handling
            articlePage = await currentBrowser.newPage();
            const fullUrl = `https://www.edgeprop.sg/${article.path}`;
            
            console.log(`📖 Opening article: ${fullUrl}`);
            // Try multiple navigation strategies for better reliability
            let navigationSuccess = false;
            let _lastError = null;
            
            // Strategy 1: networkidle with longer timeout
            try {
              await articlePage.goto(fullUrl, { 
                waitUntil: 'networkidle', 
                timeout: 45000 
              });
              navigationSuccess = true;
            } catch (error) {
              _lastError = error;
              console.log(`⚠️ Networkidle failed, trying domcontentloaded...`);
            }
            
            // Strategy 2: domcontentloaded as fallback
            if (!navigationSuccess) {
              try {
                await articlePage.goto(fullUrl, { 
                  waitUntil: 'domcontentloaded', 
                  timeout: 30000 
                });
                navigationSuccess = true;
                console.log(`✅ DOM content loaded successfully`);
              } catch (error) {
                _lastError = error;
                console.log(`⚠️ Load event failed`);
              }
            }
            
            // Strategy 3: load as final fallback
            if (!navigationSuccess) {
              try {
                await articlePage.goto(fullUrl, { 
                  waitUntil: 'load', 
                  timeout: 20000 
                });
                navigationSuccess = true;
                console.log(`✅ Page load completed`);
              } catch (error) {
                _lastError = error;
                console.log(`❌ All navigation strategies failed`);
                throw error;
              }
            }
            
            // Wait for content to load regardless of navigation strategy
            await articlePage.waitForTimeout(3000);
            
        // Extract content using improved article-specific targeting
        const contentData = await articlePage.evaluate(() => {
          console.log('🔍 Starting article content extraction...');
          
          // Try to find the main article content area first - be more specific for EdgeProp
          let contentContainer = document.body;
          
          // For EdgeProp, look for the specific article content structure
          // Based on DOM analysis, the content is in specific JSX classes
          const articleSelectors = [
            '.jsx-4217446631.article-detail.left-section', // Main article container
            '.jsx-2128998887.detail-content', // Article content area
            '.jsx-4217446631', // Article container
            '.jsx-2128998887', // Content wrapper
            'main > div > div:first-child', // Fallback structure
            'main',
            'article',
            '.article-content',
            '.post-content',
            '.entry-content',
            '[class*="article-body"]',
            '[class*="content"]'
          ];
          
          for (const selector of articleSelectors) {
            const element = document.querySelector(selector) as HTMLElement;
            if (element) {
              const elementText = element.textContent?.trim();
              // Check if this element has substantial content and looks like article content
              // Be more restrictive - avoid footer/navigation content
              if (elementText && elementText.length > 500 && 
                  !elementText.includes('Follow Us') &&
                  !elementText.includes('Subscribe') &&
                  !elementText.includes('Popular Projects') &&
                  !elementText.includes('Property Research') &&
                  !elementText.includes('Whether you are looking to buy, sell or rent') &&
                  !elementText.includes('Make data-driven property decisions') &&
                  !elementText.includes('Our whole new Research tool') &&
                  !elementText.includes('Shortlist Projects & Transactions') &&
                  (elementText.includes('$') || // Look for price information (likely article content)
                   elementText.includes('psf') || // Look for psf information
                   elementText.includes('million') || // Look for million/price info
                   elementText.includes('sq ft') || // Look for area information
                   elementText.includes('detached factory') || // Look for property type
                   elementText.includes('Pandan Avenue') || // Look for location
                   elementText.includes('guide price') || // Look for pricing info
                   elementText.includes('expression of interest'))) { // Look for EOI info
                contentContainer = element;
                console.log(`Using ${selector} as content container (${elementText.length} chars)`);
                console.log(`Content preview: ${elementText.substring(0, 200)}...`);
                break;
              }
            }
          }
          
          console.log(`Using content container with ${contentContainer.textContent?.length || 0} chars`);
          console.log(`Page title: ${document.title}`);
          console.log(`Page URL: ${window.location.href}`);
              
              // Extract metadata from article page
              let author = 'EdgeProp Staff'; // Default author
              let publishedDate = '';
              let categories: string[] = [];
              
              // Try to find published date first - this often contains the author info
              const dateElement = document.querySelector('time, [class*="date"], [class*="published"], meta[property="article:published_time"]');
              if (dateElement) {
                publishedDate = dateElement.getAttribute('datetime') || 
                                dateElement.getAttribute('content') || 
                                dateElement.textContent?.trim() || '';
              }
              
              // Extract author from the "created" field pattern: "By Author Name / EdgeProp Singapore | Date"
              const createdPattern = /By\s+([A-Za-z\s]+?)\s*\/\s*EdgeProp Singapore/i;
              const pageText = document.body.textContent || '';
              const createdMatch = pageText.match(createdPattern);
              
              if (createdMatch && createdMatch[1]) {
                const potentialAuthor = createdMatch[1].trim();
                // Filter out obviously wrong matches
                if (potentialAuthor.length > 2 && 
                    potentialAuthor.length < 50 &&
                    !potentialAuthor.toLowerCase().includes('edgeprop') &&
                    !potentialAuthor.toLowerCase().includes('singapore') &&
                    !potentialAuthor.toLowerCase().includes('contact') &&
                    !potentialAuthor.toLowerCase().includes('agent')) {
                  author = potentialAuthor;
                  console.log(`Found author via created pattern: "${author}"`);
                }
              }
              
              // Fallback: Look for author in the page text - find the FIRST occurrence of "By Author Name" pattern
              if (author === 'EdgeProp Staff') {
                const byPattern = /By\s+([A-Za-z\s]+?)(?:\s*\/|\s*\|)/i;
                const byMatch = pageText.match(byPattern);
                
                if (byMatch && byMatch[1]) {
                  const potentialAuthor = byMatch[1].trim();
                  // Filter out obviously wrong matches (navigation text, etc.)
                  if (potentialAuthor.length > 2 && 
                      potentialAuthor.length < 50 &&
                      !potentialAuthor.toLowerCase().includes('amenities') &&
                      !potentialAuthor.toLowerCase().includes('market watch') &&
                      !potentialAuthor.toLowerCase().includes('premium tools') &&
                      !potentialAuthor.toLowerCase().includes('presentation tool') &&
                      !potentialAuthor.toLowerCase().includes('landlens') &&
                      !potentialAuthor.toLowerCase().includes('inspector') &&
                      !potentialAuthor.toLowerCase().includes('edgeprop') &&
                      !potentialAuthor.toLowerCase().includes('singapore') &&
                      !potentialAuthor.toLowerCase().includes('property') &&
                      !potentialAuthor.toLowerCase().includes('news') &&
                      !potentialAuthor.toLowerCase().includes('contact') &&
                      !potentialAuthor.toLowerCase().includes('agent') &&
                      !potentialAuthor.toLowerCase().includes('subscribe') &&
                      !potentialAuthor.toLowerCase().includes('follow') &&
                      !potentialAuthor.toLowerCase().includes('download') &&
                      !potentialAuthor.toLowerCase().includes('browse') &&
                      !potentialAuthor.toLowerCase().includes('our site') &&
                      !potentialAuthor.toLowerCase().includes('about us') &&
                      !potentialAuthor.toLowerCase().includes('terms') &&
                      !potentialAuthor.toLowerCase().includes('privacy') &&
                      !potentialAuthor.toLowerCase().includes('advertise') &&
                      !potentialAuthor.toLowerCase().includes('user guide') &&
                      !potentialAuthor.toLowerCase().includes('we\'re hiring') &&
                      !potentialAuthor.toLowerCase().includes('faqs') &&
                      !potentialAuthor.toLowerCase().includes('sale') &&
                      !potentialAuthor.toLowerCase().includes('rent') &&
                      !potentialAuthor.toLowerCase().includes('new launches') &&
                      !potentialAuthor.toLowerCase().includes('analytics') &&
                      !potentialAuthor.toLowerCase().includes('ask buddy') &&
                      !potentialAuthor.toLowerCase().includes('register') &&
                      !potentialAuthor.toLowerCase().includes('login')) {
                    author = potentialAuthor;
                    console.log(`Found author via fallback pattern: "${author}"`);
                  }
                }
              }
              
              // If no author found via pattern, try selectors as fallback
              if (author === 'EdgeProp Staff') {
                const authorSelectors = [
                  'meta[name="author"]',
                  '[class*="author"]',
                  '[class*="byline"]',
                  '.writer-name',
                  '.author-name'
                ];
                
                for (const selector of authorSelectors) {
                  const authorElement = document.querySelector(selector);
                  if (authorElement) {
                    const authorText = authorElement.getAttribute('content') || authorElement.textContent?.trim();
                    if (authorText && 
                        authorText !== 'Unknown' && 
                        authorText.length > 2 && 
                        authorText.length < 50 &&
                        !authorText.includes('EdgeProp') &&
                        !authorText.includes('Contact') &&
                        !authorText.includes('Agent') &&
                        !authorText.includes('Market Watch') &&
                        !authorText.includes('Premium Tools') &&
                        !authorText.includes('Presentation Tool') &&
                        !authorText.includes('LandLens') &&
                        !authorText.includes('Inspector') &&
                        !authorText.includes('amenities')) {
                      author = authorText;
                      console.log(`Found author via selector: "${author}"`);
                      break;
                    }
                  }
                }
              }
              
              // publishedDate was already extracted above
              
              // Try to find categories/tags - clean and filter them
              const categoryElements = document.querySelectorAll('[class*="category"], [class*="tag"], meta[property="article:section"]');
              const rawCategories = Array.from(categoryElements).map(el => 
                el.getAttribute('content') || el.textContent?.trim()
              ).filter(Boolean);
              
              // Clean and filter categories to match screenshot format
              categories = rawCategories
                .map(cat => cat.trim())
                .filter(cat => 
                  cat.length > 0 && 
                  cat.length < 30 && // Shorter length for clean display
                  !cat.toLowerCase().includes('tags:') && // Remove "Tags:" prefix
                  !cat.includes('PROPERTY NEWS') && // Remove redundant entries
                  !cat.includes('SHOWCASE') && // Remove redundant entries
                  !cat.includes('Tags:') && // Remove "Tags:" prefix
                  cat !== 'Property News' && // Avoid duplicates
                  cat !== 'News' || // Allow "News" as it's clean
                  ['News', 'International', 'Deal Watch', 'In Depth', 'Showcase', 'BTO', 'HDB', 'Developer Sales', 'Hospitality'].includes(cat) // Keep known good categories
                )
                .slice(0, 2); // Limit to 2 categories max for cleaner display
              
              // If no clean categories found, use a default
              if (categories.length === 0) {
                categories = ['News'];
              }
              
              // Extract text content and paragraphs using improved content parser
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
              
              // First, try to extract from paragraph elements within the content container
              const pElements = Array.from(contentContainer.querySelectorAll('p'))
                .map(p => p.textContent?.trim())
                .filter(text => {
                  if (!text || text.length <= 30) return false;
                  const lowerText = text.toLowerCase();
                  // Filter out social sharing button text
                  return !lowerText.includes('facebook sharing button') &&
                         !lowerText.includes('twitter sharing button') &&
                         !lowerText.includes('linkedin sharing button') &&
                         !lowerText.includes('messenger sharing button') &&
                         !lowerText.includes('whatsapp sharing button') &&
                         !lowerText.includes('email sharing button') &&
                         !lowerText.includes('wechat sharing button');
                });
              
              if (pElements.length > 0) {
                paragraphs = pElements;
                console.log(`Found ${paragraphs.length} paragraphs from <p> elements`);
              } else {
                // Fallback to text splitting if no good paragraph elements found
                const allText = contentContainer.textContent || '';
                console.log(`Total text length: ${allText.length}`);
                console.log(`First 200 chars: ${allText.substring(0, 200)}`);
                
                if (allText.length > 100) {
                  // Split by common paragraph boundaries and filter using content parser
                  const rawParagraphs = allText
                    .split(/\n\s*\n|\.\s+(?=[A-Z])/)
                    .map(p => p.trim())
                    .filter(text => {
                      if (!text || text.length <= 50) return false;
                      const lowerText = text.toLowerCase();
                      // Filter out social sharing button text
                      return !lowerText.includes('facebook sharing button') &&
                             !lowerText.includes('twitter sharing button') &&
                             !lowerText.includes('linkedin sharing button') &&
                             !lowerText.includes('messenger sharing button') &&
                             !lowerText.includes('whatsapp sharing button') &&
                             !lowerText.includes('email sharing button') &&
                             !lowerText.includes('wechat sharing button');
                    });
                  
                  paragraphs = rawParagraphs;
                  console.log(`Found ${paragraphs.length} paragraphs from text splitting`);
                }
              }
              
              console.log(`Found ${paragraphs.length} paragraphs from article content`);
              console.log(`Sample paragraph: ${paragraphs[0]?.substring(0, 100) || 'No paragraphs found'}`);
              
              const textContent = paragraphs.join('\n\n');
              const wordCount = textContent.split(/\s+/).length;
              const readingTime = Math.ceil(wordCount / 200);
              
              console.log(`Final text content length: ${textContent.length}`);
              console.log(`Word count: ${wordCount}`);
              
              // Extract links - filter out social sharing buttons
              const links = Array.from(contentContainer.querySelectorAll('a'))
                .map(link => ({
                  text: link.textContent?.trim() || '',
                  url: link.getAttribute('href') || '',
                  type: (link.getAttribute('href')?.includes('edgeprop.sg') ? 'internal' : 'external') as 'internal' | 'external'
                }))
                .filter(link => {
                  if (!link.url) return false;
                  const lowerText = link.text.toLowerCase();
                  const lowerUrl = link.url.toLowerCase();
                  // Filter out social sharing buttons
                  return !lowerUrl.includes('facebook.com/share') &&
                         !lowerUrl.includes('twitter.com/intent') &&
                         !lowerUrl.includes('linkedin.com/sharearticle') &&
                         !lowerUrl.includes('wa.me') &&
                         !lowerUrl.includes('wechat') &&
                         !lowerUrl.startsWith('mailto:') &&
                         !lowerText.includes('facebook sharing button') &&
                         !lowerText.includes('twitter sharing button') &&
                         !lowerText.includes('linkedin sharing button') &&
                         !lowerText.includes('messenger sharing button') &&
                         !lowerText.includes('whatsapp sharing button') &&
                         !lowerText.includes('email sharing button') &&
                         !lowerText.includes('wechat sharing button');
                });

              // Extract images from the content
              const images = Array.from(contentContainer.querySelectorAll('img'))
                .map(img => {
                  const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
                  return src;
                })
                .filter(src => {
                  // Filter out logos, icons, and placeholder images
                  return src && 
                    !src.includes('logo') && 
                    !src.includes('icon') && 
                    !src.includes('avatar') && 
                    !src.includes('placeholder') &&
                    !src.includes('blank.gif') &&
                    src.length > 10; // Basic validation
                })
                .map(src => {
                  // Convert relative URLs to absolute URLs
                  if (src.startsWith('/')) {
                    return `https://www.edgeprop.sg${src}`;
                  } else if (!src.startsWith('http')) {
                    return `https://www.edgeprop.sg/${src}`;
                  }
                  return src;
                });

              // Extract main image (first valid image or from meta tags)
              let mainImageUrl: string | null = null;
              
              // Try to get main image from meta tags first
              const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
              const twitterImage = document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
              
              if (ogImage && !ogImage.includes('logo') && !ogImage.includes('placeholder')) {
                mainImageUrl = ogImage.startsWith('http') ? ogImage : `https://www.edgeprop.sg${ogImage}`;
              } else if (twitterImage && !twitterImage.includes('logo') && !twitterImage.includes('placeholder')) {
                mainImageUrl = twitterImage.startsWith('http') ? twitterImage : `https://www.edgeprop.sg${twitterImage}`;
              } else if (images.length > 0) {
                mainImageUrl = images[0];
              }

              console.log(`Found ${images.length} images in article content`);
              console.log(`Main image URL: ${mainImageUrl}`);
              if (images.length > 0) {
                console.log(`Sample images: ${images.slice(0, 3).join(', ')}`);
              }
              
              // Create a proper description from the first meaningful paragraph
          let description = '';
          if (paragraphs.length > 0) {
            // Find the first paragraph that looks like article content (not navigation)
            const contentParagraph = paragraphs.find(p => 
              p.length > 50 && 
              !p.toLowerCase().includes('be the first to work out') &&
              !p.toLowerCase().includes('prospecting') &&
              !p.toLowerCase().includes('featured enquiries') &&
              !p.toLowerCase().includes('real daily leads') &&
              !p.toLowerCase().includes('fsbo') &&
              !p.toLowerCase().includes('hdb mop') &&
              !p.toLowerCase().includes('check all hdb units') &&
              !p.toLowerCase().includes('click into any listing') &&
              !p.toLowerCase().includes('make data-driven property') &&
              !p.toLowerCase().includes('the edge fair value') &&
              !p.toLowerCase().includes('en bloc calculator') &&
              !p.toLowerCase().includes('check out our insightful') &&
              !p.toLowerCase().includes('we also provide fruitful') &&
              !p.toLowerCase().includes('window._peq=window._peq') &&
              !p.toLowerCase().includes('get the latest details') &&
              !p.toLowerCase().includes('penrith, which previewed') &&
              p.includes('$') || // Look for price information (likely article content)
              p.toLowerCase().includes('unit') || // Look for unit information
              p.toLowerCase().includes('project') || // Look for project information
              p.toLowerCase().includes('development') // Look for development information
            );
            
            if (contentParagraph) {
              description = contentParagraph.substring(0, 200);
              console.log(`Found good description: ${description.substring(0, 100)}...`);
            } else {
              // Fallback to first paragraph if no good content found
              description = paragraphs[0].substring(0, 200);
              console.log(`Using fallback description: ${description.substring(0, 100)}...`);
            }
          }
              
              // If no paragraphs found with the main method, try fallback extraction
              if (paragraphs.length === 0) {
                console.log('🔄 Trying fallback content extraction...');
                
                // Fallback 1: Try to find any paragraph elements
                const pElements = Array.from(document.querySelectorAll('p'))
                  .map(p => p.textContent?.trim())
                  .filter(text => text && text.length > 30);
                
                if (pElements.length > 0) {
                  console.log(`Fallback found ${pElements.length} raw paragraphs`);
                  const fallbackText = pElements.join('\n\n');
                  const fallbackWordCount = fallbackText.split(/\s+/).length;
                  const fallbackReadingTime = Math.ceil(fallbackWordCount / 200);
              
              return {
                    author,
                    created: publishedDate,
                    category: categories,
                    description: pElements[0].substring(0, 200),
                    text_content: fallbackText,
                    paragraphs: pElements,
                    images: [], // No images extracted in fallback
                    links,
                    main_image_url: null, // No main image in fallback
                    word_count: fallbackWordCount,
                    reading_time_minutes: fallbackReadingTime
                  };
                }
                
                // Fallback 2: Try to extract from article-specific containers
                const articleSelectors = [
                  'article',
                  '.article-content',
                  '.post-content',
                  '.entry-content',
                  'main',
                  '.content',
                  '[class*="article"]',
                  '[class*="content"]'
                ];
                
                for (const selector of articleSelectors) {
                  const element = document.querySelector(selector);
                  if (element) {
                    const elementText = element.textContent?.trim();
                    if (elementText && elementText.length > 100) {
                      console.log(`Fallback found content in ${selector}: ${elementText.length} chars`);
                      const fallbackWordCount = elementText.split(/\s+/).length;
                      const fallbackReadingTime = Math.ceil(fallbackWordCount / 200);
                      
                      return {
                        author,
                        created: publishedDate,
                        category: categories,
                        description: elementText.substring(0, 200),
                        text_content: elementText,
                        paragraphs: [elementText],
                        images: [], // No images extracted in fallback
                        links,
                        main_image_url: null, // No main image in fallback
                        word_count: fallbackWordCount,
                        reading_time_minutes: fallbackReadingTime
                      };
                    }
                  }
                }
              }
              
              return {
                author,
                created: publishedDate,
                category: categories,
                description,
                text_content: textContent,
                paragraphs,
                images,
                links,
                main_image_url: mainImageUrl,
                word_count: wordCount,
                reading_time_minutes: readingTime
              };
            });
            
            // Close articlePage after content extraction
            if (articlePage) {
              await articlePage.close().catch(() => {});
              articlePage = null;
            }
            
            // Clean the paragraphs using the Node.js function (outside browser context)
            if (contentData && contentData.paragraphs && Array.isArray(contentData.paragraphs)) {
              const cleanedParagraphs = cleanArticleParagraphs(contentData.paragraphs);
              contentData.paragraphs = cleanedParagraphs;
              
              // Recalculate text content, word count, and reading time with cleaned paragraphs
              contentData.text_content = cleanedParagraphs.join('\n\n');
              contentData.word_count = contentData.text_content.split(/\s+/).length;
              contentData.reading_time_minutes = Math.ceil(contentData.word_count / 200);
              
              // Update description if needed
              if (cleanedParagraphs.length > 0 && (!contentData.description || contentData.description.length < 50)) {
                contentData.description = cleanedParagraphs[0].substring(0, 200);
              }
            }
            
            // More flexible content validation - accept articles with any meaningful content
            const hasValidContent = contentData && contentData.text_content && contentData.text_content.length > 30;
            
            console.log(`📊 Content extraction result: ${hasValidContent ? 'SUCCESS' : 'FAILED'}`);
            if (contentData) {
              console.log(`   Text length: ${contentData.text_content?.length || 0}`);
              console.log(`   Word count: ${contentData.word_count || 0}`);
              console.log(`   Paragraphs: ${contentData.paragraphs?.length || 0}`);
            }
            
            if (hasValidContent) {
              // Debug description extraction
              console.log(`🔍 Description Debug:`);
              console.log(`   contentData.description: "${contentData.description?.substring(0, 100)}..."`);
              console.log(`   article.description: "${article.description?.substring(0, 100)}..."`);
              console.log(`   Final description will be: "${(contentData.description || article.description || '').substring(0, 100)}..."`);
              
              // Combine API metadata with enhanced content extraction data
              const unifiedArticle: UnifiedArticle = {
                // Use enhanced metadata from content extraction when available
                nid: article.nid,
                title: article.title,
                path: article.path,
                thumbnail: article.thumbnail,
                // Truncate author to fit database schema (VARCHAR(255))
                author: (contentData.author || article.author || 'EdgeProp Staff').substring(0, 255),
                created: contentData.created || article.created, // Use extracted date if available
                category: contentData.category || article.category, // Use extracted categories if available
                // Truncate description to reasonable length
                description: (contentData.description || article.description || '').substring(0, 500),
                created_on: contentData.created || article.created_on,
                keywords: article.keywords,
                
                // Full content extraction with images
                text_content: contentData.text_content,
                paragraphs: contentData.paragraphs,
                images: contentData.images || [],
                links: contentData.links,
                main_image_url: contentData.main_image_url,
                word_count: contentData.word_count,
                reading_time_minutes: contentData.reading_time_minutes,
                
                // Set removed fields to null
                html_content: null,
                main_image_caption: null,
                tags: null,
                
                // Scraping method tracking
                discovery_method: article.discovery_method || 'unknown',
                
                scraped_at: new Date()
              };
            
              allArticles.push(unifiedArticle);
              
              // Save to database
              if (sessionId && dbModule && contentDbModule) {
              try {
                  console.log(`💾 Saving article ${unifiedArticle.nid} to database...`);
                  
            // Save article metadata first
            const articleData = {
                  nid: unifiedArticle.nid,
                  title: unifiedArticle.title,
                  thumbnail: unifiedArticle.thumbnail,
                  path: unifiedArticle.path,
                  author: unifiedArticle.author,
                  created: unifiedArticle.created,
                  category: unifiedArticle.category,
                  description: unifiedArticle.description,
                  created_on: unifiedArticle.created_on,
              keywords: unifiedArticle.keywords,
              discovery_method: unifiedArticle.discovery_method || 'unknown'
            };
                  
                  console.log(`📝 Article data:`, {
                    nid: articleData.nid,
                    title: articleData.title.substring(0, 50) + '...',
                    author: articleData.author?.substring(0, 50) + '...',
                    authorLength: articleData.author?.length || 0
                  });
                  
                  await dbModule.upsertArticles([articleData], sessionId);
                  console.log(`✅ Article metadata saved successfully`);
                  
                  // Small delay to ensure database transaction is committed
                  await new Promise(resolve => setTimeout(resolve, 100));
                
                // Save optimized content
                  const contentData = {
                  nid: unifiedArticle.nid,
                  path: unifiedArticle.path,
                  title: unifiedArticle.title,
                  author: unifiedArticle.author,
                  published_date: unifiedArticle.created,
                  text_content: unifiedArticle.text_content,
                  paragraphs: unifiedArticle.paragraphs,
                  links: unifiedArticle.links,
                  word_count: unifiedArticle.word_count,
                  reading_time_minutes: unifiedArticle.reading_time_minutes,
                  scraped_at: unifiedArticle.scraped_at,
                    // Set removed fields to empty strings/arrays to match ArticleContent interface
                    main_image_url: '',
                    main_image_caption: '',
                    html_content: '',
                    images: [],
                    tags: []
                  };
                  
                  // Try to save content with retry logic
                  let contentSaveSuccess = false;
                  for (let retry = 0; retry < 3; retry++) {
                    try {
                      await contentDbModule.upsertArticleContent(contentData);
                      console.log(`✅ Article content saved successfully`);
                      contentSaveSuccess = true;
                      break;
                    } catch (contentError) {
                      console.log(`⚠️ Content save attempt ${retry + 1} failed:`, contentError instanceof Error ? contentError.message : String(contentError));
                      if (retry < 2) {
                        console.log(`🔄 Retrying content save in 200ms...`);
                        await new Promise(resolve => setTimeout(resolve, 200));
                      }
                    }
                  }
                  
                  if (!contentSaveSuccess) {
                    console.error(`❌ Failed to save content after 3 attempts for article ${unifiedArticle.nid}`);
                  }
                
                // Update session
                await dbModule.updateScrapeSession(sessionId, {
                  pages_scraped: pageNum,
                  articles_scraped: allArticles.length,
                  unique_articles: allArticles.length
                });
                  
                } catch (dbError) {
                  console.error('❌ Failed to save to database:', dbError instanceof Error ? dbError.message : String(dbError));
                  console.error('❌ Database error details:', dbError);
                }
              }
            } else {
              console.log(`⚠️ Skipped article ${article.nid}: insufficient content (${contentData?.text_content?.length || 0} chars)`);
              console.log(`   Article title: ${article.title}`);
              console.log(`   Content data available: ${!!contentData}`);
              console.log(`   Text content length: ${contentData?.text_content?.length || 0}`);
              console.log(`   Paragraphs found: ${contentData?.paragraphs?.length || 0}`);
              articlesFailed++;
            }
            
            // Respectful delay between articles
            await new Promise(resolve => setTimeout(resolve, 2000));
            
          } catch (error) {
            // Ensure articlePage is closed even on error
            if (articlePage) {
              await articlePage.close().catch(() => {});
              articlePage = null;
            }
            console.error(`❌ Failed to scrape article ${article.nid}:`, error instanceof Error ? error.message : String(error));
            articlesFailed++;
            
            // Try one retry with simpler navigation for timeout issues
            if (error instanceof Error && error.message.includes('Timeout')) {
              console.log(`🔄 Retrying article ${article.nid} with simpler navigation...`);
              let retryPage: Page | null = null;
              try {
                retryPage = await currentBrowser.newPage();
                const fullUrl = `https://www.edgeprop.sg/${article.path}`;
                
                // Simple navigation for retry
                await retryPage.goto(fullUrl, { 
                  waitUntil: 'load', 
                  timeout: 15000 
                });
                await retryPage.waitForTimeout(2000);
                
                // Simple content extraction for retry
                const retryContentData = await retryPage.evaluate(() => {
                  const allText = document.body.textContent || '';
                  const rawParagraphs = allText
                    .split(/\n\s*\n/)
                    .map(p => p.trim())
                    .filter(text => text && text.length > 30);
                  
                  // Note: We can't use the content parser here since it's in browser context
                  // So we'll do basic filtering and let the main logic handle it
                  const paragraphs = rawParagraphs
                    .filter(text => !text.includes('EdgeProp') && !text.includes('Follow Us'))
                    .slice(0, 10);
                  
                  const textContent = paragraphs.join('\n\n');
                  const wordCount = textContent.split(/\s+/).length;
                  
                  return {
                    text_content: textContent,
                    paragraphs,
                    word_count: wordCount,
                    reading_time_minutes: Math.ceil(wordCount / 200),
                    links: []
                  };
                });
                
                if (retryContentData && retryContentData.text_content && retryContentData.text_content.length > 30) {
                  console.log(`✅ Retry successful for article ${article.nid}`);
                  articlesFailed--; // Decrease failed count
                  
                  // Create article with retry data
                  const retryArticle: UnifiedArticle = {
                    nid: article.nid,
                    title: article.title,
                    path: article.path,
                    thumbnail: article.thumbnail,
                    author: article.author,
                    created: article.created,
                    category: article.category,
                    description: article.description,
                    created_on: article.created_on,
                    keywords: article.keywords,
                    text_content: retryContentData.text_content,
                    paragraphs: retryContentData.paragraphs,
                    links: retryContentData.links,
                    word_count: retryContentData.word_count,
                    reading_time_minutes: retryContentData.reading_time_minutes,
                    html_content: null,
                    images: null,
                    main_image_url: null,
                    main_image_caption: null,
                    tags: null,
                    discovery_method: article.discovery_method || 'unknown',
                    scraped_at: new Date()
                  };
                  
                  allArticles.push(retryArticle);
                }
              } catch (retryError) {
                console.log(`❌ Retry also failed for article ${article.nid}`);
              } finally {
                // Always close retry page
                if (retryPage) {
                  await retryPage.close().catch(() => {});
                }
              }
            }
            
            // Update progress to show failure
            onProgress({
              currentPage: pageNum,
              totalPages: maxPages,
              currentArticle: i + 1,
              articlesDiscovered: seenIds.size,
              articlesScraped: allArticles.length,
              articlesFailed,
              status: 'running',
              message: `Page ${pageNum}: Failed to scrape article ${i + 1}/${articlesToScrape.length} (${articlesFailed} failed so far)`
            });
          }
        }
        
        capturedData = null;
        
        // Navigate to next page
        if (pageNum < maxPages) {
          try {
            const nextUrl = `https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=${pageNum + 1}&page_size=20&sort_by=posted_desc&category=`;
            await currentPage.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await currentPage.waitForTimeout(2000);
          } catch (navError) {
            console.error('Navigation error:', navError instanceof Error ? navError.message : String(navError));
            break;
          }
        }
      } else {
        // No API data captured - try to extract articles from DOM
        console.log(`No API data captured for page ${pageNum}, trying DOM extraction`);
        onProgress({
          currentPage: pageNum,
          totalPages: maxPages,
          currentArticle: 0,
          articlesDiscovered: seenIds.size,
          articlesScraped: allArticles.length,
          articlesFailed,
          status: 'running',
          message: `Page ${pageNum}: No API data, trying DOM extraction...`
        });
        
        try {
          // Try to extract articles from page DOM with more comprehensive selectors
          const articles = await currentPage.evaluate(() => {
            console.log('Starting DOM extraction...');
            
            // Try multiple selectors for EdgeProp articles (updated based on investigation)
            const selectors = [
              'a[href*="/property-news/"]', // Direct links to articles
              '[class*="article"]', // Elements with "article" in class name
              'div[class*="list"]', // List containers
              'article',
              '.article-item',
              '.news-item', 
              '.property-news-item',
              '.list-item',
              '.card',
              '[data-testid="article"]',
              '.views-row',
              '.node-article',
              'div[class*="news"]',
              'div[class*="item"]'
            ];
            
            let articleElements: Element[] = [];
            for (const selector of selectors) {
              const elements = document.querySelectorAll(selector);
              if (elements.length > 0) {
                console.log(`Found ${elements.length} elements with selector: ${selector}`);
                articleElements = Array.from(elements);
                break;
              }
            }
            
            console.log(`Total article elements found: ${articleElements.length}`);
            
            const extracted: Array<{
              title: string;
              href: string;
              imgSrc: string;
            }> = [];
            
            articleElements.forEach((el, _index) => {
              let title = '';
              let href = '';
              let imgSrc = '';
              
              // If the element itself is a link to an article
              if (el.tagName === 'A' && (el as HTMLAnchorElement).href && (el as HTMLAnchorElement).href.includes('/property-news/')) {
                title = el.textContent?.trim() || '';
                href = (el as HTMLAnchorElement).href;
                imgSrc = el.querySelector('img')?.getAttribute('src') || '';
              } else {
                // Try to find title and link within the element
                const titleSelectors = ['h1', 'h2', 'h3', 'h4', '.title', '.headline', 'a', '[class*="title"]'];
                let titleEl = null;
                for (const sel of titleSelectors) {
                  titleEl = el.querySelector(sel);
                  if (titleEl && titleEl.textContent?.trim()) break;
                }
                
                // Try to find link within the element
                const linkEl = el.querySelector('a[href*="/property-news/"]') || el.querySelector('a');
                
                if (titleEl) title = titleEl.textContent.trim();
                if (linkEl) {
                  href = linkEl.getAttribute('href') || '';
                  // Make sure it's a full URL
                  if (href && !href.startsWith('http')) {
                    href = href.startsWith('/') ? `https://www.edgeprop.sg${href}` : `https://www.edgeprop.sg/${href}`;
                  }
                }
                
                const imgEl = el.querySelector('img');
                if (imgEl) imgSrc = imgEl.getAttribute('src') || '';
              }
              
              // Only add if we have a valid title and href
              if (title && href && href.includes('/property-news/')) {
                // Extract the path part for our database
                const _path = href.replace('https://www.edgeprop.sg/', '');
                
                extracted.push({
                  title: title,
                  href: href,
                  imgSrc: imgSrc
                });
                
                console.log(`Extracted article: ${title}`);
              }
            });
            
            console.log(`Total articles extracted: ${extracted.length}`);
            return extracted;
          });
          
          if (articles.length > 0) {
            console.log(`Extracted ${articles.length} articles from DOM`);
            capturedData = { results: articles };
          } else {
            console.log('No articles found in DOM');
          }
        } catch (error) {
          console.log('DOM extraction failed:', error);
        }
        
        // Try to navigate to next page anyway
        if (pageNum < maxPages) {
          try {
            const nextUrl = `https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=${pageNum + 1}&page_size=20&sort_by=posted_desc&category=`;
            await currentPage.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await currentPage.waitForTimeout(2000);
          } catch (navError2) {
            console.error('Navigation error:', navError2 instanceof Error ? navError2.message : String(navError2));
            break;
          }
        }
      }
    }
    
    if (!shouldStop && sessionId && dbModule) {
      await dbModule.completeScrapeSession(sessionId, 'completed');
    }
    
    onProgress({
      currentPage: maxPages,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: seenIds.size,
      articlesScraped: allArticles.length,
      articlesFailed,
      status: 'completed',
      message: `Completed! Scraped ${allArticles.length} articles with full content (${articlesFailed} failed)`
    });
    
    return allArticles;
    
  } catch (_error) {
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: seenIds.size,
      articlesScraped: allArticles.length,
      articlesFailed,
      status: 'error',
      message: `Error: ${_error instanceof Error ? _error.message : String(_error)}`
    });
    
    throw _error;
  } finally {
    // CRITICAL: Always close context and browser to prevent resource leaks
    // Close in reverse order: pages -> context -> browser
    try {
      if (currentPage) {
        await currentPage.close().catch(() => {});
        currentPage = null;
      }
      if (context) {
        await context.close().catch(() => {});
        context = null;
      }
      if (currentBrowser) {
        await currentBrowser.close().catch(() => {});
        currentBrowser = null;
      }
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }
  }
}

/**
 * Stop the unified scraper
 */
export async function stopUnifiedScraper() {
  shouldStop = true;
  // Browser will be closed in finally block of scrapeEdgePropUnified
  // This function just signals to stop
}

