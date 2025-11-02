/**
 * SSE endpoint for real-time scraper updates with database tracking
 */

import { NextRequest } from 'next/server';
import { scrapeEdgePropUnified, stopUnifiedScraper } from '@/lib/scraper/edgeprop-unified-scraper';
import { scrapeEdgePropMCP } from '@/lib/scraper/edgeprop-mcp-scraper';
import { scrapeEdgePropSimple } from '@/lib/scraper/edgeprop-simple-scraper';
import { scrapeEdgePropCombined } from '@/lib/scraper/edgeprop-combined-scraper';
import * as db from '@/lib/db/articles';
import { upsertArticleContent } from '@/lib/db/article-content';

// Store active scraping session
let isScraperRunning = false;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  const maxPages = parseInt(searchParams.get('pages') || '10');
  const method = searchParams.get('method') || 'mcp'; // 'mcp', 'combined', 'unified', or 'simple'
  
  if (action === 'stop') {
    await stopUnifiedScraper();
    isScraperRunning = false;
    return new Response('Scraper stopped', { status: 200 });
  }
  
  if (action === 'status') {
    return Response.json({ isRunning: isScraperRunning });
  }
  
  // Start scraping with SSE
  if (isScraperRunning) {
    return new Response('Scraper already running', { status: 409 });
  }
  
  isScraperRunning = true;
  
  console.log('Starting scraper endpoint with maxPages:', maxPages);
  
  // Create scrape session in database
  let sessionId: string | undefined;
  try {
    console.log('Creating scrape session...');
    
    // Add timeout to database session creation
    const sessionPromise = db.createScrapeSession();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database session creation timeout')), 5000)
    );
    
    sessionId = await Promise.race([sessionPromise, timeoutPromise]) as string;
    console.log('Scrape session created:', sessionId);
  } catch (error: unknown) {
    console.error('Failed to create scrape session:', error);
    // Return error immediately if database connection fails
    return new Response(`data: ${JSON.stringify({
      status: 'error',
      message: 'Database connection failed. Please check your Supabase configuration.',
      details: error instanceof Error ? error.message : 'Unknown database error'
    })}\n\n`, {
      status: 500,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }
  
  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;
      
      try {
        console.log('Starting scraper with maxPages:', maxPages);
        
        // Send initial progress
        const initialData = `data: ${JSON.stringify({
          currentPage: 0,
          totalPages: maxPages,
          currentArticle: 0,
          articlesDiscovered: 0,
          articlesScraped: 0,
          articlesFailed: 0,
          status: 'running',
          message: 'Initializing scraper...',
          sessionId
        })}\n\n`;
        controller.enqueue(encoder.encode(initialData));
        
        // Send browser launch progress
        const browserData = `data: ${JSON.stringify({
          currentPage: 0,
          totalPages: maxPages,
          currentArticle: 0,
          articlesDiscovered: 0,
          articlesScraped: 0,
          articlesFailed: 0,
          status: 'running',
          message: 'Launching browser...',
          sessionId
        })}\n\n`;
        controller.enqueue(encoder.encode(browserData));
        
        // Choose scraper method
        const scraperPromise = method === 'combined'
          ? scrapeEdgePropCombined(maxPages, (progress) => {
              if (!isClosed) {
                try {
                  console.log('Sending progress:', progress);
                  const data = `data: ${JSON.stringify({...progress, sessionId})}\n\n`;
                  controller.enqueue(encoder.encode(data));
                } catch (e) {
                  console.error('Failed to send SSE update:', e);
                  isClosed = true;
                }
              }
            }, sessionId)
          : method === 'simple'
          ? scrapeEdgePropSimple(maxPages, (progress) => {
              if (!isClosed) {
                try {
                  console.log('Sending progress:', progress);
                  const data = `data: ${JSON.stringify({...progress, sessionId})}\n\n`;
                  controller.enqueue(encoder.encode(data));
                } catch (e) {
                  console.error('Failed to send SSE update:', e);
                  isClosed = true;
                }
              }
            }, sessionId)
          : method === 'mcp' 
          ? scrapeEdgePropMCP(maxPages, (progress) => {
              if (!isClosed) {
                try {
                  console.log('Sending progress:', progress);
                  const data = `data: ${JSON.stringify({...progress, sessionId})}\n\n`;
                  controller.enqueue(encoder.encode(data));
                } catch (e) {
                  console.error('Failed to send SSE update:', e);
                  isClosed = true;
                }
              }
            }, sessionId, true) // Enable immediate saving for MCP
          : scrapeEdgePropUnified(maxPages, (progress) => {
              if (!isClosed) {
                try {
                  console.log('Sending progress:', progress);
                  const data = `data: ${JSON.stringify({...progress, sessionId})}\n\n`;
                  controller.enqueue(encoder.encode(data));
                } catch (e) {
                  console.error('Failed to send SSE update:', e);
                  isClosed = true;
                }
              }
            }, sessionId);
        
        // No timeout needed since articles are saved immediately
        let scrapedArticles: any[] = [];
        try {
          scrapedArticles = await scraperPromise as any[];
        } catch (scraperError: any) {
          console.error('Scraper error:', scraperError);
          const errorData = `data: ${JSON.stringify({
            currentPage: maxPages,
            totalPages: maxPages,
            currentArticle: 0,
            articlesDiscovered: 0,
            articlesScraped: 0,
            articlesFailed: 0,
            status: 'error',
            message: `Scraper failed: ${scraperError?.message || 'Unknown error'}`,
            sessionId
          })}\n\n`;
          controller.enqueue(encoder.encode(errorData));
          await db.completeScrapeSession(sessionId, 'error');
          return new Response('Scraper failed', { status: 500 });
        }
        
        console.log(`📊 API: Scraper completed. Found ${scrapedArticles?.length || 0} articles`);
        console.log(`📊 API: Controller closed status: ${isClosed}`);
        
        if (!isClosed) {
          if (scrapedArticles && Array.isArray(scrapedArticles) && scrapedArticles.length > 0) {
            if (method === 'mcp') {
              // Articles are already saved immediately for MCP, just send completion message
              console.log(`✅ API: Scraping completed. ${scrapedArticles.length} articles were processed and saved immediately.`);
              
              const completionData = `data: ${JSON.stringify({
                currentPage: maxPages,
                totalPages: maxPages,
                currentArticle: 0,
                articlesDiscovered: scrapedArticles.length,
                articlesScraped: scrapedArticles.length,
                articlesFailed: 0,
                status: 'completed',
                message: `Scraping completed successfully! ${scrapedArticles.length} articles were saved immediately to database.`,
                sessionId
              })}\n\n`;
              controller.enqueue(encoder.encode(completionData));
            } else {
              // For other methods, save articles now
              try {
                console.log(`📝 API: Saving ${scrapedArticles.length} articles to database...`);
                const savedArticles = await db.upsertArticles(scrapedArticles, sessionId || '');
                console.log(`✅ API: Saved ${savedArticles.newArticles} new articles and ${savedArticles.duplicates} duplicates to database`);
                
                // Save full content for methods that have it
                if ((method === 'combined') && scrapedArticles[0] && ('text_content' in scrapedArticles[0])) {
                  console.log('📄 API: Saving full article content...');
                  let contentSaved = 0;
                  for (const article of scrapedArticles) {
                    if ('text_content' in article && article.text_content) {
                      try {
                        await upsertArticleContent(article);
                        contentSaved++;
                      } catch (contentError) {
                        console.error(`❌ API: Failed to save content for article ${article.nid}:`, contentError);
                      }
                    }
                  }
                  console.log(`✅ API: Saved content for ${contentSaved} articles`);
                }
                
                const completionData = `data: ${JSON.stringify({
                  currentPage: maxPages,
                  totalPages: maxPages,
                  currentArticle: 0,
                  articlesDiscovered: scrapedArticles.length,
                  articlesScraped: savedArticles.newArticles + savedArticles.duplicates,
                  articlesFailed: scrapedArticles.length - (savedArticles.newArticles + savedArticles.duplicates),
                  status: 'completed',
                  message: `Scraping completed successfully! Saved ${savedArticles.newArticles} new articles and ${savedArticles.duplicates} duplicates to database.`,
                  sessionId
                })}\n\n`;
                controller.enqueue(encoder.encode(completionData));
                
              } catch (dbError: any) {
                console.error('Database save error:', dbError);
                const errorData = `data: ${JSON.stringify({
                  currentPage: maxPages,
                  totalPages: maxPages,
                  currentArticle: 0,
                  articlesDiscovered: scrapedArticles.length,
                  articlesScraped: 0,
                  articlesFailed: scrapedArticles.length,
                  status: 'error',
                  message: `Scraping completed but failed to save to database: ${dbError?.message || 'Unknown error'}`,
                  sessionId
                })}\n\n`;
                controller.enqueue(encoder.encode(errorData));
              }
            }
            
            // Mark session as completed
            await db.completeScrapeSession(sessionId, 'completed');
            console.log(`✅ API: Session ${sessionId} marked as completed`);
            
          } else {
            // Send completion message for no articles found
            const completionData = `data: ${JSON.stringify({
              currentPage: maxPages,
              totalPages: maxPages,
              currentArticle: 0,
              articlesDiscovered: 0,
              articlesScraped: 0,
              articlesFailed: 0,
              status: 'completed',
              message: 'Scraping completed but no articles were found.',
              sessionId
            })}\n\n`;
            controller.enqueue(encoder.encode(completionData));
            
            // Mark session as completed
            await db.completeScrapeSession(sessionId, 'completed');
          }
          
          // Close controller only once
          if (!isClosed) {
            controller.close();
            isClosed = true;
            console.log(`🔒 API: Controller closed for session ${sessionId}`);
          }
        }
        isScraperRunning = false;
      } catch (error: unknown) {
        console.error('Scraping error:', error);
        
        // Mark session as failed
        if (sessionId) {
          await db.completeScrapeSession(sessionId, 'error', error instanceof Error ? error.message : String(error));
        }
        
        if (!isClosed) {
          try {
            const errorData = `data: ${JSON.stringify({
              currentPage: 0,
              totalPages: maxPages,
              currentArticle: 0,
              articlesDiscovered: 0,
              articlesScraped: 0,
              articlesFailed: 0,
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
              sessionId
            })}\n\n`;
            controller.enqueue(encoder.encode(errorData));
            if (!isClosed) {
              controller.close();
              isClosed = true;
              console.log(`🔒 API: Controller closed (error) for session ${sessionId}`);
            }
          } catch (error: unknown) {
             console.error('Error processing scrape request:', error);
             console.error('Failed to send error:', error);
          }
        }
        isScraperRunning = false;
      }
    },
    cancel() {
      stopUnifiedScraper();
      isScraperRunning = false;
      if (sessionId) {
        db.completeScrapeSession(sessionId, 'stopped').catch((error) => console.error(error));
      }
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Cache-Control',
    },
  });
}

