import { scrapeEdgePropMCP, MCPArticle } from '../src/lib/scraper/edgeprop-mcp-scraper';

async function testActualScraper() {
  console.log('🚀 Testing Actual MCP Scraper with Enhanced Cloudflare Bypass...\n');
  
  try {
    console.log('📍 Running EdgeProp scraper for latest news (page 1)...');
    
    const startTime = Date.now();
    const articles = await scrapeEdgePropMCP(
      1, // maxPages
      (progress) => {
        console.log(`📊 Progress: ${progress.message}`);
        console.log(`   📄 Page: ${progress.currentPage}/${progress.totalPages}`);
        console.log(`   📰 Articles: ${progress.articlesDiscovered} discovered, ${progress.articlesScraped} scraped`);
        console.log(`   ❌ Failed: ${progress.articlesFailed}`);
        console.log(`   🔄 Status: ${progress.status}`);
        console.log('---');
      },
      'test-actual-scraper-session', // sessionId
      false, // saveImmediately
      20 // maxArticles - limit to exactly 20
    );
    const endTime = Date.now();
    
    console.log(`\n⏱️ Scraping completed in ${(endTime - startTime) / 1000}s`);
    
    console.log(`\n📈 Scraper Results:`);
    console.log(`   Total articles found: ${articles.length}`);
    console.log(`   Expected: exactly 20 articles`);
    console.log(`   Status: ${articles.length === 20 ? '✅ CORRECT' : articles.length > 20 ? '⚠️ TOO MANY' : '❌ TOO FEW'}`);
    
    if (articles.length > 0) {
      console.log(`\n📋 Article List (first 25):`);
      articles.slice(0, 25).forEach((article: MCPArticle, index: number) => {
        console.log(`   ${index + 1}. ${article.title.substring(0, 80)}${article.title.length > 80 ? '...' : ''}`);
        console.log(`      URL: https://www.edgeprop.sg${article.path}`);
      });
    }
    
    // Check for Cloudflare bypass success indicators
    const hasValidTitles = articles.every((article: MCPArticle) => article.title && article.title.length > 5);
    const hasValidPaths = articles.every((article: MCPArticle) => article.path && article.path.length > 0);
    
    console.log(`\n🔍 Quality Checks:`);
    console.log(`   Valid titles: ${hasValidTitles ? '✅' : '❌'}`);
    console.log(`   Valid paths: ${hasValidPaths ? '✅' : '❌'}`);
    
    // Final assessment
    const isSuccess = articles.length === 20 && hasValidTitles && hasValidPaths;
    console.log(`\n🎯 Final Result: ${isSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);
    
    if (isSuccess) {
      console.log('✅ Enhanced Cloudflare bypass is working correctly!');
      console.log('✅ Article count is exactly 20 as expected!');
      console.log('✅ All articles have valid titles and paths!');
    } else {
      console.log('❌ Issues detected:');
      if (articles.length !== 20) {
        console.log(`   - Article count: ${articles.length} (expected: 20)`);
      }
      if (!hasValidTitles) {
        console.log('   - Some articles have invalid titles');
      }
      if (!hasValidPaths) {
        console.log('   - Some articles have invalid paths');
      }
    }
    
  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
    
    if (error instanceof Error) {
      if (error.message.includes('Cloudflare') || error.message.includes('challenge')) {
        console.error('🚫 Cloudflare protection detected - bypass failed');
      } else if (error.message.includes('timeout')) {
        console.error('⏱️ Timeout error - may need longer wait times');
      }
    }
  }
}

// Run the test
testActualScraper().catch(console.error);