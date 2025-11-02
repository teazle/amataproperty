import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as db from '@/lib/db/articles';
import { upsertArticles } from '../db/articles';
import { upsertArticleContent } from '@/lib/db/article-content';

export interface MCPArticle {
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
  
  // Content fields
  html_content?: string;
  text_content: string;
  paragraphs: string[];
  links: Array<{text: string; url: string; type: 'internal' | 'external'}>;
  images: Array<{url: string; alt?: string; caption?: string}>;
  main_image_url?: string;
  main_image_caption?: string;
  tags?: string[];
  word_count: number;
  reading_time_minutes: number;
  
  scraped_at: Date;
}

export interface MCPProgress {
  currentPage: number;
  totalPages: number;
  currentArticle: number;
  articlesDiscovered: number;
  articlesScraped: number;
  articlesFailed: number;
  status: 'running' | 'completed' | 'stopped' | 'error';
  message: string;
}

export type MCPProgressCallback = (progress: MCPProgress) => void;

/**
 * Fixed EdgeProp MCP Scraper with proper workflow sequence
 * Prevents redirects and ensures correct article extraction
 */
export async function scrapeEdgePropMCPFixed(
  maxPages: number = 1,
  onProgress: MCPProgressCallback,
  sessionId?: string,
  saveImmediately: boolean = false,
  maxArticles: number = 20
): Promise<MCPArticle[]> {
  console.log('🚀 Starting Fixed EdgeProp MCP Scraper...');
  console.log(`📊 Target: ${maxArticles} articles from ${maxPages} page(s)`);
  
  const browser = await chromium.launch({
    headless: false, // Keep visible for debugging
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--exclude-switches=enable-automation',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-SG,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    }
  });

  // Add stealth script to prevent detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    (window as any).chrome = {
      runtime: {},
    };
    
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-SG', 'en', 'en-US'],
    });
  });

  const page = await context.newPage();
  
  // Enhanced console logging
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('🔍') || text.includes('✅') || text.includes('⚠️') || text.includes('❌') || 
        text.includes('📊') || text.includes('🌐') || text.includes('📄')) {
      console.log(`[Browser] ${text}`);
    }
  });

  const allArticles: MCPArticle[] = [];
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
      message: 'Initializing fixed scraper...'
    });

    // Step 1: Navigate to listing page and prevent redirects
    console.log('📍 Step 1: Navigating to listing page with redirect prevention...');
    
    // Use the search URL directly to avoid redirects from /latest
    const listingUrl = 'https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=0&page_size=20&sort_by=posted_desc&category=';
    
    await page.goto(listingUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 45000 
    });

    // Verify we're on the correct page and not redirected
    const currentUrl = page.url();
    console.log(`📄 Current URL: ${currentUrl}`);
    
    if (!currentUrl.includes('property-news-search') && !currentUrl.includes('property-news/latest')) {
      throw new Error(`❌ Unexpected redirect detected. Expected listing page, got: ${currentUrl}`);
    }

    // Wait for page to fully load and handle any Cloudflare challenges
    await handleCloudflareChallenge(page);

    // Step 2: Identify and select exactly 20 articles
    console.log('📊 Step 2: Identifying and selecting exactly 20 articles...');
    
    const discoveredArticles = await page.evaluate((targetCount: number) => {
      console.log('🔍 Starting article discovery...');
      console.log(`📄 Page title: ${document.title}`);
      console.log(`📄 Page URL: ${window.location.href}`);
      
      // Multiple strategies to find article containers
      const strategies = [
        // Strategy 1: Direct article links
        () => Array.from(document.querySelectorAll('a[href*="/property-news/"]:not([href*="/property-news-search"]):not([href*="/property-news/latest"])')),
        
        // Strategy 2: Article containers with links and images
        () => Array.from(document.querySelectorAll('div')).filter(div => {
          const hasLink = div.querySelector('a[href*="/property-news/"]:not([href*="/property-news-search"])');
          const hasImage = div.querySelector('img');
          return hasLink && hasImage;
        }),
        
        // Strategy 3: JSX containers (Next.js)
        () => Array.from(document.querySelectorAll('[class*="jsx-"]')).filter(el => {
          return el.querySelector('a[href*="/property-news/"]:not([href*="/property-news-search"])');
        })
      ];

      let articleElements: Element[] = [];
      
      for (let i = 0; i < strategies.length; i++) {
        try {
          const elements = strategies[i]();
          console.log(`✅ Strategy ${i + 1} found ${elements.length} potential articles`);
          
          if (elements.length >= targetCount) {
            articleElements = elements;
            console.log(`🎯 Using strategy ${i + 1} with ${elements.length} articles`);
            break;
          }
        } catch (error) {
          console.log(`⚠️ Strategy ${i + 1} failed:`, error);
        }
      }

      if (articleElements.length === 0) {
        console.log('❌ No articles found with any strategy');
        return [];
      }

      // Extract article data with enhanced metadata
      const articles: any[] = [];
      const processedUrls = new Set<string>();

      for (let i = 0; i < Math.min(articleElements.length, targetCount); i++) {
        const element = articleElements[i];
        
        try {
          // Find the article link
          let linkElement = element.tagName === 'A' ? element as HTMLAnchorElement : 
                           element.querySelector('a[href*="/property-news/"]:not([href*="/property-news-search"])') as HTMLAnchorElement;
          
          if (!linkElement) continue;

          const href = linkElement.getAttribute('href');
          if (!href || processedUrls.has(href)) continue;

          // Validate it's a proper article URL
          const isValidArticle = href.includes('/property-news/') && 
                                !href.includes('/property-news-search') &&
                                !href.includes('/property-news/latest') &&
                                !href.includes('/property-news/news') &&
                                href.split('/').length >= 3;

          if (!isValidArticle) continue;

          processedUrls.add(href);

          // Extract comprehensive metadata
          const titleElement = element.querySelector('h1, h2, h3, h4, .title, [class*="title"], [class*="headline"]') ||
                              linkElement.querySelector('h1, h2, h3, h4, .title, [class*="title"]') ||
                              linkElement;
          
          const title = titleElement?.textContent?.trim() || 'Untitled Article';
          
          // Skip if title is too generic or empty
          if (!title || title.length < 10 || 
              ['Read More', 'View Article', 'Click Here', 'More Info'].includes(title)) {
            continue;
          }

          // Extract image
          const imgElement = element.querySelector('img') as HTMLImageElement;
          const thumbnail = imgElement?.src || imgElement?.getAttribute('data-src') || '';

          // Extract author information
          const authorElement = element.querySelector('.author, [class*="author"], .byline, [class*="byline"]');
          const author = authorElement?.textContent?.trim() || 'EdgeProp';

          // Extract date information
          const dateElement = element.querySelector('.date, [class*="date"], .published, [class*="published"], time');
          const dateText = dateElement?.textContent?.trim() || dateElement?.getAttribute('datetime') || '';
          
          // Extract description/excerpt
          const descElement = element.querySelector('.excerpt, .description, .summary, [class*="excerpt"], [class*="description"]');
          const description = descElement?.textContent?.trim() || '';

          // Extract category information
          const categoryElement = element.querySelector('.category, [class*="category"], .tag, [class*="tag"]');
          const categoryText = categoryElement?.textContent?.trim() || 'Property News';

          // Generate unique ID from URL
          const pathSegments = href.split('/');
          const nid = pathSegments[pathSegments.length - 1] || `article-${i}`;

          const article = {
            nid,
            title,
            path: href.startsWith('/') ? href : `/${href}`,
            thumbnail,
            author,
            created: dateText,
            category: [categoryText],
            description,
            created_on: dateText,
            keywords: [],
            text_content: '',
            paragraphs: [],
            links: [],
            images: [],
            word_count: 0,
            reading_time_minutes: 0,
            scraped_at: new Date()
          };

          articles.push(article);
          console.log(`✅ Article ${articles.length}: ${title.substring(0, 50)}...`);
        } catch (error) {
          console.log(`⚠️ Error processing article ${i}:`, error);
        }
      }

      console.log(`📊 Successfully identified ${articles.length} articles for processing`);
      return articles;
    }, maxArticles);

    if (discoveredArticles.length === 0) {
      throw new Error('❌ No articles found on the listing page');
    }

    console.log(`✅ Step 2 Complete: Found ${discoveredArticles.length} articles to process`);

    // Step 3: Process each article with full content extraction
    console.log('📖 Step 3: Processing articles with full content extraction...');
    
    for (let i = 0; i < discoveredArticles.length; i++) {
      const article = discoveredArticles[i];
      
      onProgress({
        currentPage: 1,
        totalPages: maxPages,
        currentArticle: i + 1,
        articlesDiscovered: discoveredArticles.length,
        articlesScraped: allArticles.length,
        articlesFailed,
        status: 'running',
        message: `Processing article ${i + 1}/${discoveredArticles.length}: ${article.title.substring(0, 50)}...`
      });

      try {
        console.log(`🌐 Processing article ${i + 1}: ${article.title}`);
        
        // Navigate to article page
        const articleUrl = article.path.startsWith('http') ? article.path : `https://www.edgeprop.sg${article.path}`;
        
        await page.goto(articleUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });

        // Handle Cloudflare if needed
        await handleCloudflareChallenge(page);

        // Extract full content
        const contentData = await extractArticleContent(page);
        
        if (contentData && contentData.text_content && contentData.text_content.length > 100) {
          // Merge article metadata with extracted content
          const completeArticle: MCPArticle = {
            ...article,
            ...contentData,
            scraped_at: new Date()
          };

          allArticles.push(completeArticle);
          seenIds.add(article.nid);

          // Save immediately if requested
          if (saveImmediately) {
            await saveArticleToDatabase(completeArticle, sessionId);
          }

          console.log(`✅ Successfully processed: ${article.title}`);
        } else {
          console.log(`⚠️ Failed to extract content for: ${article.title}`);
          articlesFailed++;
        }

      } catch (error) {
        console.error(`❌ Error processing article ${i + 1}:`, error);
        articlesFailed++;
      }

      // Add delay between articles to be respectful
      await page.waitForTimeout(1000);
    }

    onProgress({
      currentPage: maxPages,
      totalPages: maxPages,
      currentArticle: discoveredArticles.length,
      articlesDiscovered: discoveredArticles.length,
      articlesScraped: allArticles.length,
      articlesFailed,
      status: 'completed',
      message: `Completed! Scraped ${allArticles.length} articles successfully.`
    });

    console.log(`🎉 Scraping completed! Successfully processed ${allArticles.length} articles.`);
    return allArticles;

  } catch (error) {
    console.error('❌ Scraper error:', error);
    
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: seenIds.size,
      articlesScraped: allArticles.length,
      articlesFailed,
      status: 'error',
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    });

    throw error;
  } finally {
    await browser.close();
  }
}

/**
 * Handle Cloudflare challenges automatically
 */
async function handleCloudflareChallenge(page: Page): Promise<void> {
  console.log('🔍 Checking for Cloudflare challenges...');
  
  for (let attempt = 0; attempt < 5; attempt++) {
    const pageContent = await page.content().catch(() => '');
    const pageTitle = await page.title().catch(() => '');
    
    const isCloudflare = pageContent.includes('cf-browser-verification') ||
                        pageContent.includes('checking-your-browser') ||
                        pageTitle.includes('Just a moment') ||
                        pageContent.includes('cf-challenge-running');

    if (!isCloudflare) {
      console.log('✅ No Cloudflare challenge detected');
      return;
    }

    console.log(`⚠️ Cloudflare challenge detected (attempt ${attempt + 1}/5)`);
    
    // Try to handle the challenge
    try {
      const checkbox = page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
        await checkbox.click();
        console.log('✅ Clicked Cloudflare checkbox');
      }
    } catch (error) {
      console.log('⚠️ Could not interact with Cloudflare challenge');
    }

    // Wait for challenge to resolve
    await page.waitForTimeout(5000);
  }
}

/**
 * Extract comprehensive article content
 */
async function extractArticleContent(page: Page): Promise<Partial<MCPArticle> | null> {
  return await page.evaluate(() => {
    console.log('📖 Starting content extraction...');
    
    // Try multiple selectors for article content
    const contentSelectors = [
      'article .content',
      '.article-content',
      '.post-content',
      '.entry-content',
      'article',
      '.jsx-4217446631.article-detail.left-section',
      '.jsx-2128998887.detail-content',
      'main'
    ];

    let contentElement: Element | null = null;
    
    for (const selector of contentSelectors) {
      contentElement = document.querySelector(selector);
      if (contentElement && contentElement.textContent && contentElement.textContent.trim().length > 100) {
        console.log(`✅ Found content using selector: ${selector}`);
        break;
      }
    }

    if (!contentElement) {
      console.log('❌ No content element found');
      return null;
    }

    // Extract text content
    const textContent = contentElement.textContent?.trim() || '';
    
    // Extract paragraphs
    const paragraphElements = contentElement.querySelectorAll('p, div');
    const paragraphs = Array.from(paragraphElements)
      .map(p => p.textContent?.trim())
      .filter(text => text && text.length > 20);

    // Extract images
    const imageElements = contentElement.querySelectorAll('img');
    const images = Array.from(imageElements).map(img => ({
      url: img.src || img.getAttribute('data-src') || '',
      alt: img.alt || '',
      caption: img.getAttribute('title') || ''
    })).filter(img => img.url);

    // Extract links
    const linkElements = contentElement.querySelectorAll('a[href]');
    const links = Array.from(linkElements).map(link => ({
      text: link.textContent?.trim() || '',
      url: link.getAttribute('href') || '',
      type: (link.getAttribute('href') || '').startsWith('http') ? 'external' : 'internal'
    })).filter(link => link.url && link.text);

    // Calculate reading time (average 200 words per minute)
    const wordCount = textContent.split(/\s+/).length;
    const readingTimeMinutes = Math.ceil(wordCount / 200);

    console.log(`✅ Extracted ${paragraphs.length} paragraphs, ${images.length} images, ${links.length} links`);
    console.log(`📊 Word count: ${wordCount}, Reading time: ${readingTimeMinutes} minutes`);

    return {
      html_content: contentElement.innerHTML,
      text_content: textContent,
      paragraphs,
      links: links as Array<{text: string; url: string; type: 'internal' | 'external'}>,
      images,
      main_image_url: images[0]?.url,
      main_image_caption: images[0]?.caption,
      word_count: wordCount,
      reading_time_minutes: readingTimeMinutes
    };
  });
}

/**
 * Save article to database
 */
async function saveArticleToDatabase(article: MCPArticle, sessionId?: string): Promise<void> {
  try {
    // Store article in database
        const result = await upsertArticles([{
          nid: article.nid,
          title: article.title,
          thumbnail: article.thumbnail,
          path: article.path,
          author: article.author,
          created: article.created,
          category: Array.isArray(article.category) ? article.category : [article.category],
          description: article.description || '',
          created_on: article.created_on,
          keywords: article.keywords || [],
          discovery_method: 'mcp-scraper'
        }], sessionId || '');
        
        console.log(`✅ Article stored: ${article.title} (${result.newArticles ? 'new' : 'duplicate'})`);
        
        // Store content with proper type handling - map to ArticleContent interface
        const imageUrls = article.images?.map(img => img.url) || [];
        
        await upsertArticleContent({
          nid: article.nid,
          path: article.path,
          title: article.title,
          author: article.author,
          published_date: article.created,
          main_image_url: article.main_image_url || '',
          main_image_caption: article.main_image_caption || '',
          html_content: article.html_content || '',
          text_content: article.text_content,
          paragraphs: article.paragraphs,
          images: imageUrls,
          links: article.links,
          tags: article.tags || [],
          word_count: article.word_count,
          reading_time_minutes: article.reading_time_minutes,
          scraped_at: article.scraped_at
        });

    console.log(`💾 Saved article to database: ${article.title}`);
  } catch (error) {
    console.error(`❌ Failed to save article to database:`, error);
    throw error;
  }
}