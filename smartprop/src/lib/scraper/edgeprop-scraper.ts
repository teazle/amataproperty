/**
 * EdgeProp Scraper - API Intercept Method
 * Integrated into Next.js with TypeScript
 */

import { type Page as _Page, type Browser, chromium } from 'playwright';

export interface Article {
  nid: string;
  title: string;
  thumbnail: string;
  path: string;
  author: string;
  created: string;
  category: string | string[];
  description?: string;
  created_on: string;
  keywords?: string[];
}

export interface ScraperProgress {
  currentPage: number;
  totalPages: number;
  articlesCollected: number;
  totalArticles: number;
  maxPagesAvailable?: number; // Dynamic max from API
  status: 'running' | 'completed' | 'error' | 'stopped';
  message?: string;
  articles?: Article[];
}

interface CapturedApiData {
  total?: number;
  results?: Article[];
}

export type ProgressCallback = (progress: ScraperProgress) => void;

let currentBrowser: Browser | null = null;
let shouldStop = false;

export async function scrapeEdgeProp(
  maxPages: number,
  onProgress: ProgressCallback,
  sessionId?: string // Optional: pass session ID for database tracking
): Promise<Article[]> {
  shouldStop = false;
  const allArticles: Article[] = [];
  const seenIds = new Set<string>(); // Track unique article IDs for deduplication
  let capturedData: CapturedApiData | null = null;
  
  // Import database functions if session ID provided
  let dbModule: typeof import('@/lib/db/articles') | null = null;
  if (sessionId) {
    dbModule = await import('@/lib/db/articles');
  }
  
  try {
    currentBrowser = await chromium.launch({ headless: true });
    const page = await currentBrowser.newPage();
    
    // Intercept API responses
    page.on('response', async (response: any) => {
      if (response.url().includes('/proxy/news?secure-url=')) {
        try {
          const json = await response.json();
          if (json?.response?.results) {
            capturedData = json.response;
          }
        } catch (_e: unknown) {
          // Ignore parse errors
        }
      }
    });
    
    // Navigate to first page
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      articlesCollected: 0,
      totalArticles: 0,
      status: 'running',
      message: 'Starting scraper...'
    });
    
    await page.goto(
      'https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=1&page_size=20&sort_by=posted_desc&category=',
      { waitUntil: 'domcontentloaded' }
    );
    
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (shouldStop) {
        onProgress({
          currentPage: pageNum - 1,
          totalPages: maxPages,
          articlesCollected: allArticles.length,
          totalArticles: (capturedData as unknown as CapturedApiData)?.total || 0,
          status: 'stopped',
          message: 'Scraping stopped by user',
          articles: allArticles
        });
        break;
      }
      
      // Wait for data to be captured
      await page.waitForTimeout(2000);
      
      if ((capturedData as unknown as CapturedApiData)?.results && (capturedData as unknown as CapturedApiData).results!.length > 0) {
        // Type assertion to help TypeScript understand the type
        const data = capturedData as unknown as CapturedApiData & { results: Article[]; total?: number };
        
        // Calculate max pages from API total (20 articles per page)
        const apiMaxPages = data.total ? Math.ceil(data.total / 20) : maxPages;
        
        // Deduplicate articles based on nid (article ID)
        let newArticlesCount = 0;
        const pageArticles: Article[] = [];
        
        for (const article of data.results) {
          if (!seenIds.has(article.nid)) {
            seenIds.add(article.nid);
            allArticles.push(article);
            pageArticles.push(article);
            newArticlesCount++;
          }
        }
        
        // Save to database if session ID provided
        if (sessionId && dbModule && pageArticles.length > 0) {
          try {
            const { newArticles, duplicates } = await dbModule.upsertArticles(pageArticles, sessionId);
            await dbModule.updateScrapeSession(sessionId, {
              pages_scraped: pageNum,
              articles_scraped: allArticles.length,
              unique_articles: allArticles.length,
              duplicates_found: duplicates
            });
          } catch (_error: unknown) {
            console.error('Failed to save articles to database:', _error);
          }
        }
        
        onProgress({
          currentPage: pageNum,
          totalPages: maxPages,
          articlesCollected: allArticles.length,
          totalArticles: data.total || 0,
          maxPagesAvailable: apiMaxPages,
          status: 'running',
          message: `Scraped page ${pageNum} (${newArticlesCount} new, ${data.results.length - newArticlesCount} duplicates)`,
          articles: [...allArticles] // Send copy
        });
        
        capturedData = null; // Reset for next page
        
        // Navigate to next page
        if (pageNum < maxPages) {
          try {
            const nextUrl = `https://www.edgeprop.sg/property-news-search?combine=&field_tags_tid=&page=${pageNum + 1}&page_size=20&sort_by=posted_desc&category=`;
            await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          } catch (_e: unknown) {
            const errorMessage = _e instanceof Error ? _e.message : 'Unknown navigation error';
            onProgress({
              currentPage: pageNum,
              totalPages: maxPages,
              articlesCollected: allArticles.length,
              totalArticles: (capturedData as unknown as CapturedApiData)?.total || 0,
              status: 'error',
              message: `Navigation error: ${errorMessage}`
            });
            break;
          }
        }
      } else {
        // Retry once
        await page.waitForTimeout(2000);
        if (!capturedData) {
          await page.reload({ waitUntil: 'domcontentloaded' });
        }
      }
    }
    
    if (!shouldStop) {
      // Complete session in database
      if (sessionId && dbModule) {
        try {
          await dbModule.completeScrapeSession(sessionId, 'completed');
        } catch (_error: unknown) {
          console.error('Failed to complete session:', _error);
        }
      }
      
      // Send final progress update
      try {
        onProgress({
          currentPage: maxPages,
          totalPages: maxPages,
          articlesCollected: allArticles.length,
          totalArticles: allArticles.length,
          status: 'completed',
          message: 'Scraping completed successfully',
          articles: allArticles
        });
      } catch (_error: unknown) {
      console.error('Failed to send final progress:', _error);
      }
    }
    
    await currentBrowser.close();
    currentBrowser = null;
    
    return allArticles;
    
  } catch (_error: unknown) {
    if (currentBrowser) {
      await currentBrowser.close();
      currentBrowser = null;
    }
    
    onProgress({
      currentPage: 0,
      totalPages: maxPages,
      articlesCollected: allArticles.length,
      totalArticles: 0,
      status: 'error',
      message: _error instanceof Error ? _error.message : String(_error)
    });
    
    throw _error;
  }
}

export async function stopScraper() {
  shouldStop = true;
  if (currentBrowser) {
    await currentBrowser.close();
    currentBrowser = null;
  }
}

