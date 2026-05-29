/**
 * Full browser-based test: Delete today's articles, scrape new one, verify with browser MCP
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
  console.log('🗑️  Step 1: Deleting articles scraped today...\n');
  
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDayISO = startOfDay.toISOString();
  
  const { data: todayArticles } = await supabase
    .from('scraped_articles')
    .select('id, nid, title')
    .gte('first_scraped_at', startOfDayISO);
  
  if (!todayArticles || todayArticles.length === 0) {
    console.log('✅ No articles found scraped today.\n');
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
  
  console.log(`✅ Deleted ${articleIds.length} article(s)\n`);
}

async function scrapeOneArticle() {
  console.log('📰 Step 2: Scraping 1 new article...\n');
  
  const { createScrapeSession, completeScrapeSession } = await import('@/lib/db/articles');
  const { scrapeEdgePropMCP } = await import('@/lib/scraper/edgeprop-mcp-scraper');
  
  const sessionId = await createScrapeSession();
  console.log(`   Session ID: ${sessionId}\n`);
  
  let scrapedArticle: unknown = null;
  
  await scrapeEdgePropMCP(
    1, // 1 page
    (progress) => {
      console.log(`   ${progress.message}`);
      if (progress.articlesScraped > 0 && !scrapedArticle) {
        // Try to get the article
        setTimeout(async () => {
          const { data } = await supabase
            .from('scraped_articles')
            .select('*')
            .eq('session_id', sessionId)
            .order('first_scraped_at', { ascending: false })
            .limit(1)
            .single();
          if (data) scrapedArticle = data;
        }, 1000);
      }
    },
    sessionId,
    true, // saveImmediately
    1 // maxArticles: 1
  );
  
  // Get the scraped article
  await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for save
  
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
  console.log(`✅ Scraped: ${sessionArticle.scraped_articles.title}\n`);
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

async function verifyWithBrowser(article: unknown) {
  console.log('🔍 Step 3: Verifying with browser (this will open a browser window)...\n');
  
  const edgePropUrl = `https://www.edgeprop.sg${article.path}`;
  console.log(`   EdgeProp URL: ${edgePropUrl}`);
  
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Navigate to EdgeProp original
  console.log('\n   📄 Loading EdgeProp original article...');
  await page.goto(edgePropUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  
  // Extract content from EdgeProp - use same approach as scraper
  const edgePropContent = await page.evaluate(() => {
    const title = document.querySelector('h1')?.textContent?.trim() || '';
    
    // Find author - more robust pattern
    let author = 'EdgeProp Staff';
    const allText = document.body.textContent || '';
    
    // Try multiple patterns
    const patterns = [
      /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*\/\s*EdgeProp/i,
      /By\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*EdgeProp/i,
      /Author:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
    ];
    
    for (const pattern of patterns) {
      const match = allText.match(pattern);
      if (match && match[1]) {
        author = match[1].trim();
        break;
      }
    }
    
    // Find main content area - try same selectors as scraper
    let articleContainer = document.querySelector('article');
    if (!articleContainer) {
      articleContainer = document.querySelector('main') || 
                        document.querySelector('[class*="content"]') ||
                        document.body;
    }
    
    // Try to find specific EdgeProp content area (same as scraper)
    const contentAreaSelectors = [
      '.jsx-2128998887.detail-content',
      '.jsx-4217446631.article-detail',
      '[class*="detail-content"]',
      '[class*="article-content"]',
      'article > div'
    ];
    
    let mainContentArea = articleContainer;
    for (const selector of contentAreaSelectors) {
      const area = articleContainer.querySelector(selector);
      if (area && area.textContent && area.textContent.length > 500) {
        mainContentArea = area;
        break;
      }
    }
    
    // Extract paragraphs - same approach as scraper
    let paragraphElements = Array.from(mainContentArea.querySelectorAll('p'));
    
    // If not enough, also try divs
    if (paragraphElements.length < 5) {
      const articleDivs = Array.from(mainContentArea.querySelectorAll('div')).filter(el => {
        const text = el.textContent || '';
        return text.length > 100 && 
               text.split(/\s+/).length > 10 &&
               !el.querySelector('div div div') &&
               !text.toLowerCase().includes('subscribe') &&
               !text.toLowerCase().includes('www.edgeprop');
      });
      paragraphElements = paragraphElements.concat(articleDivs);
    }
    
    const allParagraphs = paragraphElements
      .map(el => el.textContent?.trim())
      .filter(text => {
        if (!text || text.length < 30) return false;
        const lower = text.toLowerCase();
        return !lower.includes('subscribe') && 
               !lower.includes('cookie policy') &&
               !lower.includes('www.edgeprop') &&
               !lower.includes('follow us') &&
               !lower.startsWith('http');
      })
      .slice(0, 100);
    
    // Get first meaningful paragraph (not title)
    let firstPara = '';
    for (const para of allParagraphs) {
      if (para && para.length > 50 && !para.toLowerCase().includes(title.toLowerCase())) {
        firstPara = para;
        break;
      }
    }
    if (!firstPara && allParagraphs.length > 0) {
      firstPara = allParagraphs[0];
    }
    
    return { title, author, paragraphs: allParagraphs, firstParagraph: firstPara };
  });
  
  console.log(`   ✅ Title: ${edgePropContent.title}`);
  console.log(`   ✅ Author: ${edgePropContent.author}`);
  console.log(`   ✅ Paragraphs: ${edgePropContent.paragraphs.length}`);
  console.log(`   ✅ First paragraph: "${edgePropContent.firstParagraph.substring(0, 100)}..."`);
  
  // Get our scraped content
  const scrapedContent = await getArticleContent(article.id);
  
  console.log('\n   📊 Our Scraped Article (from database):');
  console.log(`      Title: ${article.title}`);
  console.log(`      Author: ${article.author}`);
  console.log(`      Paragraphs: ${scrapedContent?.paragraphs?.length || 0}`);
  
  // Navigate to our frontend
  const frontendUrl = `http://localhost:3000/admin/articles/${article.id}`;
  console.log(`\n   📄 Loading our frontend: ${frontendUrl}`);
  
  await page.goto(frontendUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Extract content from our frontend
  const frontendContent = await page.evaluate(() => {
    const title = document.querySelector('h1')?.textContent?.trim() || '';
    
    // Find author
    let author = '';
    const authorText = Array.from(document.querySelectorAll('*')).find(el => 
      el.textContent?.includes('By ') && el.textContent?.includes('•')
    )?.textContent || '';
    const authorMatch = authorText.match(/By\s+(.+?)(?:\s*•|$)/);
    if (authorMatch) {
      author = authorMatch[1].trim();
    }
    
    const contentArea = document.querySelector('.prose') || 
                       document.querySelector('article') || 
                       document.querySelector('[class*="content"]');
    
    const paragraphs = Array.from(contentArea?.querySelectorAll('p') || [])
      .map(p => p.textContent?.trim())
      .filter(p => p && p.length > 30 && !p.toLowerCase().includes('subscribe'))
      .slice(0, 100);
    
    const firstPara = paragraphs.length > 0 ? paragraphs[0] : '';
    
    return { title, author, paragraphs, firstParagraph: firstPara };
  });
  
  console.log(`\n   ✅ Our Frontend Display:`);
  console.log(`      Title: ${frontendContent.title}`);
  console.log(`      Author: ${frontendContent.author}`);
  console.log(`      Paragraphs: ${frontendContent.paragraphs.length}`);
  console.log(`      First paragraph: "${frontendContent.firstParagraph.substring(0, 100)}..."`);
  
  // Detailed comparison
  console.log('\n' + '='.repeat(80));
  console.log('📊 DETAILED COMPARISON');
  console.log('='.repeat(80));
  
  const titleMatch = edgePropContent.title.trim() === article.title.trim();
  const authorMatch = edgePropContent.author.trim().toLowerCase() === article.author.trim().toLowerCase();
  
  console.log(`\n✅ Title Match: ${titleMatch ? '✅ PASS' : '❌ FAIL'}`);
  if (!titleMatch) {
    console.log(`   EdgeProp: "${edgePropContent.title}"`);
    console.log(`   Scraped:  "${article.title}"`);
  }
  
  console.log(`\n✅ Author Match: ${authorMatch ? '✅ PASS' : '❌ FAIL'}`);
  if (!authorMatch) {
    console.log(`   EdgeProp: "${edgePropContent.author}"`);
    console.log(`   Scraped:  "${article.author}"`);
  }
  
  // Compare paragraph counts
  const edgePropParaCount = edgePropContent.paragraphs.length;
  const scrapedParaCount = scrapedContent?.paragraphs?.length || 0;
  const frontendParaCount = frontendContent.paragraphs.length;
  
  console.log(`\n✅ Paragraph Count:`);
  console.log(`   EdgeProp: ${edgePropParaCount}`);
  console.log(`   Scraped:   ${scrapedParaCount} ${scrapedParaCount === edgePropParaCount ? '✅' : '❌'}`);
  console.log(`   Frontend:  ${frontendParaCount} ${frontendParaCount === edgePropParaCount ? '✅' : '❌'}`);
  
  // Compare first paragraph
  if (edgePropContent.firstParagraph && scrapedContent?.paragraphs?.[0]) {
    const edgePropFirst = edgePropContent.firstParagraph.substring(0, 150).trim();
    const scrapedFirst = scrapedContent.paragraphs[0].substring(0, 150).trim();
    
    // Check if first 50 chars match (to account for slight variations)
    const first50Match = edgePropFirst.substring(0, 50) === scrapedFirst.substring(0, 50);
    
    console.log(`\n✅ First Paragraph Match: ${first50Match ? '✅ PASS' : '⚠️ DIFFERENT'}`);
    if (!first50Match) {
      console.log(`   EdgeProp: "${edgePropFirst}..."`);
      console.log(`   Scraped:  "${scrapedFirst}..."`);
    }
  }
  
  // Check if frontend displays correctly
  const frontendTitleMatch = frontendContent.title.trim() === article.title.trim();
  const frontendParaCountMatch = frontendParaCount === scrapedParaCount;
  
  console.log(`\n✅ Frontend Display:`);
  console.log(`   Title matches: ${frontendTitleMatch ? '✅' : '❌'}`);
  console.log(`   Paragraph count matches: ${frontendParaCountMatch ? '✅' : '❌'}`);
  
  // Final verdict
  const allMatch = titleMatch && authorMatch && 
                  scrapedParaCount > 0 && scrapedParaCount >= edgePropParaCount * 0.8 && // Allow 80% match
                  frontendTitleMatch && frontendParaCountMatch;
  
  console.log('\n' + '='.repeat(80));
  if (allMatch) {
    console.log('✅ VERIFICATION PASSED! Everything matches correctly.');
    console.log('='.repeat(80));
  } else {
    console.log('❌ VERIFICATION FAILED! Some checks did not pass.');
    console.log('='.repeat(80));
  }
  
  await browser.close();
  
  return {
    allMatch,
    edgePropUrl,
    frontendUrl,
    titleMatch,
    authorMatch,
    paragraphCount: { edgeProp: edgePropParaCount, scraped: scrapedParaCount, frontend: frontendParaCount },
    edgePropContent,
    scrapedContent,
    frontendContent
  };
}

async function main() {
  try {
    console.log('🚀 Starting Full Browser Test\n');
    console.log('='.repeat(80));
    
    // Step 1: Delete today's articles
    await deleteTodayArticles();
    
    // Step 2: Scrape 1 new article
    const article = await scrapeOneArticle();
    
    if (!article) {
      throw new Error('Failed to scrape article');
    }
    
    console.log(`\n📋 Scraped Article Details:`);
    console.log(`   ID: ${article.id}`);
    console.log(`   Title: ${article.title}`);
    console.log(`   Author: ${article.author}`);
    console.log(`   Path: ${article.path}\n`);
    
    // Step 3: Verify with browser
    const verification = await verifyWithBrowser(article);
    
    // Final report
    console.log('\n' + '='.repeat(80));
    console.log('📋 FINAL REPORT');
    console.log('='.repeat(80));
    console.log('\n🔗 URLs to Check Manually:');
    console.log(`\n   1. EdgeProp Original:`);
    console.log(`      ${verification.edgePropUrl}`);
    console.log(`\n   2. Our Frontend:`);
    console.log(`      ${verification.frontendUrl}`);
    
    console.log('\n✅ Comparison Summary:');
    console.log(`   Title Match: ${verification.titleMatch ? '✅' : '❌'}`);
    console.log(`   Author Match: ${verification.authorMatch ? '✅' : '❌'}`);
    console.log(`   Paragraphs: EdgeProp=${verification.paragraphCount.edgeProp}, Scraped=${verification.paragraphCount.scraped}, Frontend=${verification.paragraphCount.frontend}`);
    
    if (verification.allMatch) {
      console.log('\n✅ ALL TESTS PASSED! The article matches the original EdgeProp article.');
      console.log('\n📝 You can verify by opening both URLs above and comparing:');
      console.log('   - Title should be identical');
      console.log('   - Author should be identical');
      console.log('   - Content paragraphs should match');
      process.exit(0);
    } else {
      console.log('\n❌ SOME TESTS FAILED. Please review the detailed comparison above.');
      console.log('\n💡 The scraper may need adjustments. Please check:');
      console.log('   - Title extraction');
      console.log('   - Author extraction');
      console.log('   - Paragraph extraction logic');
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

