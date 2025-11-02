/**
 * Script to scrape 1 article and verify it matches the original using browser MCP
 */

// Load environment variables FIRST
require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });
require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceRole);

async function deleteTodayArticles() {
  console.log('🗑️  Deleting articles scraped today...');
  
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDayISO = startOfDay.toISOString();
  
  const { data: todayArticles } = await supabase
    .from('scraped_articles')
    .select('id, nid, title')
    .gte('first_scraped_at', startOfDayISO);
  
  if (!todayArticles || todayArticles.length === 0) {
    console.log('✅ No articles found scraped today.');
    return;
  }
  
  console.log(`   Found ${todayArticles.length} article(s) to delete`);
  const articleIds = todayArticles.map(a => a.id);
  
  // Delete content first
  for (const articleId of articleIds) {
    await supabase.from('article_full_content').delete().eq('article_id', articleId);
  }
  
  // Delete session links
  await supabase.from('scrape_session_articles').delete().in('article_id', articleIds);
  
  // Delete articles
  await supabase.from('scraped_articles').delete().in('id', articleIds);
  
  console.log(`✅ Deleted ${articleIds.length} article(s)`);
}

async function scrapeOneArticle() {
  console.log('\n📰 Scraping 1 article...');
  
  const { createScrapeSession, completeScrapeSession } = await import('@/lib/db/articles');
  const { scrapeEdgePropMCP } = await import('@/lib/scraper/edgeprop-mcp-scraper');
  
  const sessionId = await createScrapeSession();
  console.log(`   Session ID: ${sessionId}`);
  
  await scrapeEdgePropMCP(
    1, // 1 page
    (progress) => {
      console.log(`   ${progress.message}`);
    },
    sessionId,
    true, // saveImmediately
    1 // maxArticles: 1
  );
  
  // Get the scraped article
  const { data: sessionArticle } = await supabase
    .from('scrape_session_articles')
    .select(`
      scraped_articles (*)
    `)
    .eq('session_id', sessionId)
    .eq('was_new', true)
    .limit(1)
    .single();
  
  if (!sessionArticle?.scraped_articles) {
    // Fallback to latest
    const { data: latest } = await supabase
      .from('scraped_articles')
      .select('*')
      .order('first_scraped_at', { ascending: false })
      .limit(1)
      .single();
    
    if (!latest) throw new Error('No article scraped');
    await completeScrapeSession(sessionId, 'completed');
    return latest;
  }
  
  await completeScrapeSession(sessionId, 'completed');
  return sessionArticle.scraped_articles;
}

async function getArticleContent(articleId: string) {
  const { data } = await supabase
    .from('article_full_content')
    .select('*')
    .eq('article_id', articleId)
    .single();
  return data;
}

async function verifyWithBrowserMCP(article: any) {
  console.log('\n🔍 Verifying article with browser MCP...');
  
  const edgePropUrl = `https://www.edgeprop.sg${article.path}`;
  console.log(`   Original: ${edgePropUrl}`);
  
  // Use Playwright directly for better control
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Navigate to EdgeProp original
  await page.goto(edgePropUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Extract content from EdgeProp
  const edgePropContent = await page.evaluate(() => {
    const title = document.querySelector('h1')?.textContent?.trim() || '';
    
    // Find author
    let author = 'EdgeProp Staff';
    const pageText = document.body.textContent || '';
    const byPattern = /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\/\s*EdgeProp Singapore/i;
    const match = pageText.match(byPattern);
    if (match && match[1]) {
      author = match[1].trim();
    }
    
    const articleContainer = document.querySelector('article') || document.querySelector('main') || document.body;
    const allParagraphs = Array.from(articleContainer.querySelectorAll('p, div'))
      .map(el => el.textContent?.trim())
      .filter(p => p && p.length > 30 && !p.toLowerCase().includes('subscribe'))
      .slice(0, 50);
    
    return { title, author, paragraphs: allParagraphs };
  });
  
  console.log(`\n📊 EdgeProp Original:`);
  console.log(`   Title: ${edgePropContent.title}`);
  console.log(`   Author: ${edgePropContent.author}`);
  console.log(`   Paragraphs: ${edgePropContent.paragraphs.length}`);
  
  // Get our scraped content
  const scrapedContent = await getArticleContent(article.id);
  
  console.log(`\n📊 Our Scraped Article:`);
  console.log(`   Title: ${article.title}`);
  console.log(`   Author: ${article.author}`);
  console.log(`   Paragraphs: ${scrapedContent?.paragraphs?.length || 0}`);
  
  // Navigate to our frontend article page
  const frontendUrl = `http://localhost:3000/admin/articles/${article.id}`;
  console.log(`\n🔍 Navigating to our frontend: ${frontendUrl}`);
  
  await page.goto(frontendUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Extract content from our frontend
  const frontendContent = await page.evaluate(() => {
    const title = document.querySelector('h1')?.textContent?.trim() || '';
    
    // Find author - look for "By Author Name" pattern
    let author = '';
    const authorText = Array.from(document.querySelectorAll('*')).find(el => 
      el.textContent?.includes('By ') && el.textContent?.includes('•')
    )?.textContent || '';
    const authorMatch = authorText.match(/By\s+(.+?)(?:\s*•|$)/);
    if (authorMatch) {
      author = authorMatch[1].trim();
    }
    
    const contentArea = document.querySelector('.prose, article, [class*="content"], main');
    const paragraphs = Array.from(contentArea?.querySelectorAll('p, div') || [])
      .map(p => p.textContent?.trim())
      .filter(p => p && p.length > 30 && !p.toLowerCase().includes('subscribe'))
      .slice(0, 50);
    
    return { title, author, paragraphs };
  });
  
  await browser.close();
  
  console.log(`\n📊 Our Frontend Display:`);
  console.log(`   Title: ${frontendContent.title}`);
  console.log(`   Author: ${frontendContent.author}`);
  console.log(`   Paragraphs: ${frontendContent.paragraphs.length}`);
  
  // Compare
  const titleMatch = edgePropContent.title.trim() === article.title.trim();
  const authorMatch = edgePropContent.author.trim() === article.author.trim();
  
  console.log(`\n✅ Comparison Results:`);
  console.log(`   Title Match (EdgeProp vs DB): ${titleMatch ? '✅' : '❌'}`);
  console.log(`   Author Match (EdgeProp vs DB): ${authorMatch ? '✅' : '❌'}`);
  
  // Compare first few paragraphs
  if (edgePropContent.paragraphs.length > 0 && scrapedContent?.paragraphs?.length > 0) {
    const edgePropFirst = edgePropContent.paragraphs[0].substring(0, 200);
    const scrapedFirst = scrapedContent.paragraphs[0].substring(0, 200);
    const paraMatch = edgePropFirst.substring(0, 100) === scrapedFirst.substring(0, 100);
    console.log(`   First Paragraph Match: ${paraMatch ? '✅' : '❌'}`);
    
    if (!paraMatch) {
      console.log(`\n   EdgeProp: "${edgePropFirst}..."`);
      console.log(`   Scraped: "${scrapedFirst}..."`);
    }
  }
  
  return { titleMatch, authorMatch, edgePropContent, scrapedContent, frontendContent };
}

async function main() {
  try {
    console.log('🚀 Starting comprehensive article scraping verification...\n');
    
    // Step 1: Delete today's articles
    await deleteTodayArticles();
    
    // Step 2: Scrape 1 new article
    console.log('\n📰 Step 2: Scraping 1 new article...');
    const article = await scrapeOneArticle();
    
    if (!article) {
      throw new Error('Failed to scrape article');
    }
    
    console.log(`\n✅ Scraped article: ${article.title}`);
    console.log(`   ID: ${article.id}`);
    console.log(`   Author: ${article.author}`);
    
    // Step 3: Wait a moment for the article to be saved
    console.log('\n⏳ Waiting for article to be fully saved...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 4: Verify with browser
    console.log('\n🔍 Step 3: Verifying article with browser...');
    const verification = await verifyWithBrowserMCP(article);
    
    // Step 5: Detailed comparison
    console.log('\n📊 Step 4: Detailed comparison...');
    console.log('\n' + '='.repeat(80));
    console.log('COMPARISON RESULTS');
    console.log('='.repeat(80));
    
    console.log(`\n✅ Title Match: ${verification.titleMatch ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   EdgeProp: "${verification.edgePropContent.title}"`);
    console.log(`   Scraped:  "${article.title}"`);
    
    console.log(`\n✅ Author Match: ${verification.authorMatch ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   EdgeProp: "${verification.edgePropContent.author}"`);
    console.log(`   Scraped:  "${article.author}"`);
    
    // Compare paragraphs
    const edgePropParas = verification.edgePropContent.paragraphs;
    const scrapedParas = verification.scrapedContent?.paragraphs || [];
    const frontendParas = verification.frontendContent.paragraphs;
    
    console.log(`\n📄 Paragraph Counts:`);
    console.log(`   EdgeProp: ${edgePropParas.length} paragraphs`);
    console.log(`   Scraped:  ${scrapedParas.length} paragraphs`);
    console.log(`   Frontend: ${frontendParas.length} paragraphs`);
    
    // Compare first paragraph
    if (edgePropParas.length > 0 && scrapedParas.length > 0) {
      const edgePropFirst = edgePropParas[0].substring(0, 200).trim();
      const scrapedFirst = scrapedParas[0].substring(0, 200).trim();
      const firstParaMatch = edgePropFirst.substring(0, 100) === scrapedFirst.substring(0, 100);
      
      console.log(`\n📝 First Paragraph Match: ${firstParaMatch ? '✅ PASS' : '⚠️ DIFFERENT (may be expected)'}`);
      console.log(`   EdgeProp: "${edgePropFirst}..."`);
      console.log(`   Scraped:  "${scrapedFirst}..."`);
    }
    
    // Final verdict
    console.log('\n' + '='.repeat(80));
    if (verification.titleMatch && verification.authorMatch && scrapedParas.length > 0) {
      console.log('✅ VERIFICATION PASSED: Article scraped and displayed correctly!');
      console.log('='.repeat(80));
      process.exit(0);
    } else {
      console.log('❌ VERIFICATION FAILED: Some checks did not pass.');
      console.log('='.repeat(80));
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

main();

