/**
 * Script to:
 * 1. Delete articles scraped today
 * 2. Scrape a new article
 * 3. Use browser to verify it matches the original
 */

// Load environment variables FIRST before any other imports (use require for immediate execution)
// Load from .env.local only
require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  throw new Error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE');
}

const supabase = createClient(supabaseUrl, supabaseServiceRole);

async function deleteTodayArticles() {
  console.log('🗑️  Deleting articles scraped today...');
  
  // Get today's date range (start of day to now) in ISO format
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDayISO = startOfDay.toISOString();
  
  console.log(`   Date range: ${startOfDayISO} to ${now.toISOString()}`);
  
  // Find articles scraped today (using first_scraped_at)
  const { data: todayArticles, error: fetchError } = await supabase
    .from('scraped_articles')
    .select('id, nid, title, first_scraped_at')
    .gte('first_scraped_at', startOfDayISO);
  
  if (fetchError) {
    console.error('❌ Error fetching articles:', fetchError);
    throw fetchError;
  }
  
  if (!todayArticles || todayArticles.length === 0) {
    console.log('✅ No articles found scraped today.');
    return { deleted: 0, articleIds: [] };
  }
  
  console.log(`   Found ${todayArticles.length} article(s) scraped today:`);
  todayArticles.forEach(article => {
    console.log(`   - ${article.title.substring(0, 60)}... (${article.nid})`);
  });
  
  // Get article IDs
  const articleIds = todayArticles.map(a => a.id);
  
  // Delete article content first (if exists)
  for (const articleId of articleIds) {
    await supabase
      .from('article_full_content')
      .delete()
      .eq('article_id', articleId);
  }
  
  // Delete from scrape_session_articles (cascade should handle this, but being explicit)
  await supabase
    .from('scrape_session_articles')
    .delete()
    .in('article_id', articleIds);
  
  // Delete articles
  const { error: deleteError } = await supabase
    .from('scraped_articles')
    .delete()
    .in('id', articleIds);
  
  if (deleteError) {
    console.error('❌ Error deleting articles:', deleteError);
    throw deleteError;
  }
  
  console.log(`✅ Deleted ${articleIds.length} article(s) and their content.`);
  return { deleted: articleIds.length, articleIds };
}

async function scrapeNewArticle() {
  console.log('\n📰 Scraping a new article...');
  
  // Use dynamic imports for modules that depend on env vars
  const { createScrapeSession, completeScrapeSession } = await import('@/lib/db/articles');
  const { scrapeEdgePropMCP } = await import('@/lib/scraper/edgeprop-mcp-scraper');
  
  // Create a scrape session
  const sessionId = await createScrapeSession();
  console.log(`   Session ID: ${sessionId}`);
  
  let scrapedArticle: unknown = null;
  
  // Scrape only 1 page - we'll limit to 1 article in the loop
  await scrapeEdgePropMCP(
    1, // maxPages: 1
    (progress) => {
      console.log(`   Progress: ${progress.message}`);
      console.log(`   Articles discovered: ${progress.articlesDiscovered}, scraped: ${progress.articlesScraped}`);
    },
    sessionId,
    true, // saveImmediately
    1 // limit to 1 article for testing
  );
  
  // Get the newly scraped article from the session
  const { data: sessionArticles } = await supabase
    .from('scrape_session_articles')
    .select(`
      was_new,
      scraped_articles (*)
    `)
    .eq('session_id', sessionId)
    .eq('was_new', true)
    .limit(1)
    .single();
  
  if (sessionArticles && sessionArticles.scraped_articles) {
    scrapedArticle = sessionArticles.scraped_articles;
    console.log(`✅ Scraped article: ${scrapedArticle.title}`);
    console.log(`   Path: ${scrapedArticle.path}`);
    console.log(`   NID: ${scrapedArticle.nid}`);
  } else {
    // Fallback: get the most recently scraped article
    const { data: latestArticle } = await supabase
      .from('scraped_articles')
      .select('*')
      .order('first_scraped_at', { ascending: false })
      .limit(1)
      .single();
    
    if (latestArticle) {
      scrapedArticle = latestArticle;
      console.log(`✅ Using latest article: ${scrapedArticle.title}`);
    } else {
      throw new Error('No article was scraped');
    }
  }
  
  // Complete the session
  await completeScrapeSession(sessionId, 'completed');
  
  return scrapedArticle;
}

async function verifyWithBrowser(article: unknown) {
  console.log('\n🔍 Verifying article with browser...');
  
  const articleUrl = `https://www.edgeprop.sg/${article.path}`;
  console.log(`   URL: ${articleUrl}`);
  
  // Use Playwright to navigate and verify
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000); // Wait for content to load
    
    // Extract content from the page
    const pageContent = await page.evaluate(() => {
      // Get title
      const title = document.querySelector('h1')?.textContent?.trim() || '';
      
      // Get author (try multiple methods)
      let author = 'EdgeProp Staff';
      const metaAuthor = document.querySelector('meta[name="author"]');
      if (metaAuthor) {
        const metaValue = metaAuthor.getAttribute('content');
        if (metaValue && metaValue.trim() && !metaValue.toLowerCase().includes('edgeprop')) {
          author = metaValue.trim();
        }
      }
      
      // Try to find "By Author Name" pattern
      if (author === 'EdgeProp Staff') {
        const pageText = document.body.textContent || '';
        const byPattern = /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\/\s*EdgeProp Singapore/i;
        const match = pageText.match(byPattern);
        if (match && match[1]) {
          author = match[1].trim();
        } else {
          // Fallback: simpler pattern
          const bySimple = /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s|$)/i;
          const simpleMatch = pageText.substring(0, 5000).match(bySimple);
          if (simpleMatch && simpleMatch[1] && !simpleMatch[1].toLowerCase().includes('edgeprop')) {
            author = simpleMatch[1].trim();
          }
        }
      }
      
      // Get main content container
      const contentSelectors = [
        '.jsx-4217446631.article-detail.left-section',
        '.jsx-2128998887.detail-content',
        '.jsx-4217446631',
        '.jsx-2128998887',
        'main article',
        'article'
      ];
      
      let contentContainer = null;
      for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent && element.textContent.length > 500) {
          contentContainer = element;
          break;
        }
      }
      
      if (!contentContainer) {
        contentContainer = document.body;
      }
      
      // Extract paragraphs
      const paragraphs = Array.from(contentContainer.querySelectorAll('p'))
        .map(p => p.textContent?.trim())
        .filter(p => p && p.length > 20)
        .slice(0, 50); // Limit to first 50 paragraphs
      
      // Get main image
      const mainImageEl = contentContainer.querySelector('img[src*="s3fs-public"], img[alt]') as HTMLImageElement;
      const mainImage = mainImageEl?.src || '';
      
      return {
        title,
        author,
        paragraphs: paragraphs.slice(0, 10), // First 10 paragraphs for comparison
        paragraphCount: paragraphs.length,
        mainImage,
        fullTextLength: contentContainer.textContent?.length || 0
      };
    });
    
    console.log('\n📊 Original Article (from database):');
    console.log(`   Title: ${article.title}`);
    console.log(`   Author: ${article.author}`);
    console.log(`   Path: ${article.path}`);
    
    console.log('\n📊 Live Article (from EdgeProp):');
    console.log(`   Title: ${pageContent.title}`);
    console.log(`   Author: ${pageContent.author}`);
    console.log(`   Paragraphs: ${pageContent.paragraphCount}`);
    console.log(`   Text Length: ${pageContent.fullTextLength}`);
    
    // Get the scraped content from database
    const { data: scrapedContent } = await supabase
      .from('article_full_content')
      .select('*')
      .eq('article_id', article.id)
      .single();
    
    console.log('\n📊 Scraped Content (from database):');
    if (scrapedContent) {
      console.log(`   Paragraphs: ${scrapedContent.paragraphs?.length || 0}`);
      console.log(`   Text Length: ${scrapedContent.text_content?.length || 0}`);
      if (scrapedContent.paragraphs && scrapedContent.paragraphs.length > 0) {
        console.log(`   First paragraph: ${scrapedContent.paragraphs[0].substring(0, 100)}...`);
      }
    } else {
      console.log('   ⚠️  No full content stored in database');
    }
    
    // Compare
    const titleMatch = article.title.trim() === pageContent.title.trim();
    const authorMatch = article.author.trim() === pageContent.author.trim();
    
    console.log('\n✅ Verification Results:');
    console.log(`   Title Match: ${titleMatch ? '✅' : '❌'}`);
    console.log(`   Author Match: ${authorMatch ? '✅' : '❌'}`);
    
    if (!titleMatch) {
      console.log(`   Title Mismatch:`);
      console.log(`     DB: "${article.title}"`);
      console.log(`     Live: "${pageContent.title}"`);
    }
    
    if (!authorMatch) {
      console.log(`   Author Mismatch:`);
      console.log(`     DB: "${article.author}"`);
      console.log(`     Live: "${pageContent.author}"`);
    }
    
    // Check if content paragraphs match
    if (scrapedContent && scrapedContent.paragraphs) {
      console.log(`\n   Content Comparison:`);
      const firstScrapedPara = scrapedContent.paragraphs[0]?.substring(0, 200) || '';
      const firstLivePara = pageContent.paragraphs[0]?.substring(0, 200) || '';
      
      if (firstScrapedPara && firstLivePara) {
        const paraSimilar = firstScrapedPara.substring(0, 100) === firstLivePara.substring(0, 100);
        console.log(`   First paragraph similarity: ${paraSimilar ? '✅ Similar' : '❌ Different'}`);
        
        if (!paraSimilar) {
          console.log(`     Scraped: "${firstScrapedPara.substring(0, 100)}..."`);
          console.log(`     Live: "${firstLivePara.substring(0, 100)}..."`);
        }
      }
    }
    
    const allMatch = titleMatch && authorMatch;
    
    // Close browser
    await browser.close();
    
    if (!allMatch) {
      console.log('\n⚠️  Mismatch detected! Article may need fixing.');
      return { match: false, article, pageContent, scrapedContent };
    } else {
      console.log('\n✅ All checks passed!');
      return { match: true, article, pageContent, scrapedContent };
    }
  } catch (error) {
    await browser.close();
    console.error('❌ Error during browser verification:', error);
    throw error;
  }
}

async function main() {
  try {
    // Step 1: Delete today's articles
    const _deleteResult = await deleteTodayArticles();
    
    // Step 2: Scrape a new article
    const newArticle = await scrapeNewArticle();
    
    // Step 3: Verify with browser
    const verification = await verifyWithBrowser(newArticle);
    
    if (!verification.match) {
      console.log('\n❌ Verification failed. Please review the differences above.');
      console.log('   You may need to fix the scraper.');
      process.exit(1);
    } else {
      console.log('\n✅ All verification checks passed!');
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();

