/**
 * API endpoint for scraping a single article by URL
 */

import * as db from '@/lib/db/articles';
import { scrapeSingleArticleMCP } from '@/lib/scraper/edgeprop-mcp-scraper';
import { scrapeEdgeProp } from '@/lib/scraper/edgeprop-scraper';
import { NextRequest } from 'next/server';

interface ScrapedArticle {
  nid: string;
  title: string;
  path: string;
  author?: string;
  category?: string | string[];
  created?: string;
  created_on?: string;
  description?: string;
  thumbnail?: string;
  keywords?: string[];
  word_count?: number;
  reading_time_minutes?: number;
  text_content?: string;
  paragraphs?: string[];
  images?: unknown[];
  links?: unknown[];
}

interface ScrapeProgress {
  message?: string;
  articles?: ScrapedArticle[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, scraperType = 'mcp' } = body;
    
    if (!url) {
      return Response.json({ error: 'URL is required' }, { status: 400 });
    }
    
    // Validate scraper type
    if (!['mcp', 'api'].includes(scraperType)) {
      return Response.json({ error: 'Invalid scraper type. Must be "mcp" or "api"' }, { status: 400 });
    }
    
    // Validate that it's an EdgeProp URL
    if (!url.includes('edgeprop.sg')) {
      return Response.json({ error: 'Only EdgeProp Singapore URLs are supported' }, { status: 400 });
    }
    
    console.log(`🔍 Starting single article scrape using ${scraperType.toUpperCase()} scraper for:`, url);
    
    // Create a scrape session
    const sessionId = await db.createScrapeSession();
    console.log('📊 Created scrape session:', sessionId);
    
    let progress: ScrapeProgress = {};
    let articles: ScrapedArticle[] = [];
    
    if (scraperType === 'mcp') {
      // Use the dedicated single article scraper
      const article = await scrapeSingleArticleMCP(
        url,
        (progressUpdate) => {
          progress = progressUpdate as ScrapeProgress;
          console.log('Progress:', progressUpdate.message);
        },
        sessionId,
        true // saveImmediately
      );
      
      if (article) {
        articles = [article];
      }
    } else if (scraperType === 'api') {
      // Use API scraper to get metadata only
      articles = await scrapeEdgeProp(
        1, // maxPages: 1
        (progressUpdate) => {
          progress = progressUpdate as ScrapeProgress;
          console.log('Progress:', progressUpdate.message);
        },
        sessionId
      );
      
      // For API scraper, we need to filter to find the specific article by URL
      // Extract the path from the URL to match against article paths
      const urlPath = url.replace('https://www.edgeprop.sg', '').replace('http://www.edgeprop.sg', '');
      articles = articles.filter(article => article.path === urlPath || article.path === urlPath.replace(/^\//, ''));
      
      // If no exact match found, take the first article (fallback)
      if (articles.length === 0 && progress.articles && progress.articles.length > 0) {
        articles = [progress.articles[0]];
        console.log('⚠️ No exact URL match found, using first available article');
      }
    }
    
    if (!articles || articles.length === 0) {
      await db.completeScrapeSession(sessionId, 'error');
      return Response.json({ 
        error: 'No articles found. The URL might not contain a valid article or the page structure may have changed.' 
      }, { status: 404 });
    }
    
    const article = articles[0];
    
    // Complete the session
    await db.completeScrapeSession(sessionId, 'completed');
    
    console.log(`✅ Single article scraped successfully using ${scraperType.toUpperCase()} scraper:`, article.title);
    
    // Return different response structure based on scraper type
    const responseData: {
      success: boolean;
      scraperType: string;
      sessionId: string;
      message: string;
      article?: Record<string, unknown>;
    } = {
      success: true,
      scraperType,
      sessionId,
      message: `Successfully scraped article using ${scraperType.toUpperCase()} scraper: ${article.title}`
    };
    
    if (scraperType === 'mcp') {
      // MCP scraper provides full content
      responseData.article = {
        nid: article.nid,
        title: article.title,
        author: article.author,
        path: article.path,
        category: article.category,
        created_on: article.created_on,
        word_count: article.word_count,
        reading_time_minutes: article.reading_time_minutes,
        text_content: article.text_content?.substring(0, 500) + '...', // Preview only
        paragraphs_count: article.paragraphs?.length || 0,
        images_count: article.images?.length || 0,
        links_count: article.links?.length || 0
      };
    } else if (scraperType === 'api') {
      // API scraper provides metadata only
      responseData.article = {
        nid: article.nid,
        title: article.title,
        author: article.author,
        path: article.path,
        category: article.category,
        created: article.created,
        created_on: article.created_on,
        description: article.description,
        thumbnail: article.thumbnail,
        keywords: article.keywords,
        // Note: API scraper doesn't provide full content
        content_available: false,
        note: 'API scraper provides metadata only. Use MCP scraper for full content.'
      };
    }
    
    return Response.json(responseData);
    
  } catch (error) {
    console.error('❌ Single article scrape failed:', error);
    
    return Response.json({ 
      error: 'Failed to scrape article', 
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
