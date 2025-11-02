/**
 * Test to verify MCP scraper correctly limits articles to exactly 20 per page
 */

import { scrapeEdgePropMCP, MCPArticle } from './src/lib/scraper/edgeprop-mcp-scraper';

async function testMCPArticleLimit() {
  console.log('🧪 Testing MCP Scraper Article Limit...\n');
  
  try {
    console.log('📍 Running EdgeProp MCP scraper (1 page, expecting exactly 20 articles)...');
    
    const startTime = Date.now();
    let progressCount = 0;
    
    const articles = await scrapeEdgePropMCP(
      1, // maxPages - only test 1 page
      (progress) => {
        progressCount++;
        console.log(`📊 Progress ${progressCount}: ${progress.message}`);
        console.log(`   📄 Page: ${progress.currentPage}/${progress.totalPages}`);
        console.log(`   📰 Articles: ${progress.articlesDiscovered} discovered, ${progress.articlesScraped} scraped`);
        console.log(`   ❌ Failed: ${progress.articlesFailed}`);
        console.log(`   🔄 Status: ${progress.status}`);
        console.log('---');
      },
      'test-article-limit-session', // sessionId
      false, // saveImmediately - don't save to DB
      undefined // maxArticles - let it use default behavior
    );
    
    const endTime = Date.now();
    
    console.log(`\n⏱️ Scraping completed in ${(endTime - startTime) / 1000}s`);
    
    // Detailed analysis
    console.log(`\n📈 MCP Scraper Results:`);
    console.log(`   Total articles returned: ${articles.length}`);
    console.log(`   Expected: exactly 20 articles`);
    
    if (articles.length === 20) {
      console.log(`   ✅ CORRECT: Scraper returned exactly 20 articles`);
    } else if (articles.length > 20) {
      console.log(`   ⚠️ TOO MANY: Scraper returned ${articles.length - 20} extra articles`);
    } else {
      console.log(`   ❌ TOO FEW: Scraper returned ${20 - articles.length} fewer articles than expected`);
    }
    
    // Show first few articles for verification
    if (articles.length > 0) {
      console.log(`\n📋 First 5 Articles Found:`);
      articles.slice(0, 5).forEach((article: MCPArticle, index: number) => {
        console.log(`   ${index + 1}. ${article.title.substring(0, 60)}...`);
        console.log(`      Path: ${article.path}`);
        console.log(`      Category: ${article.category.join(', ')}`);
        console.log(`      Thumbnail: ${article.thumbnail ? 'Yes' : 'No'}`);
        console.log('');
      });
      
      if (articles.length > 5) {
        console.log(`   ... and ${articles.length - 5} more articles`);
      }
    }
    
    // Validation tests
    console.log(`\n🧪 Validation Tests:`);
    
    const tests = [
      {
        name: 'Article count is exactly 20',
        condition: articles.length === 20,
        expected: 20,
        actual: articles.length
      },
      {
        name: 'All articles have titles',
        condition: articles.every(a => a.title && a.title.length > 0),
        expected: 'All articles',
        actual: `${articles.filter(a => a.title && a.title.length > 0).length}/${articles.length} articles`
      },
      {
        name: 'All articles have valid paths',
        condition: articles.every(a => a.path && a.path.length > 0),
        expected: 'All articles',
        actual: `${articles.filter(a => a.path && a.path.length > 0).length}/${articles.length} articles`
      },
      {
        name: 'All articles have categories',
        condition: articles.every(a => a.category && a.category.length > 0),
        expected: 'All articles',
        actual: `${articles.filter(a => a.category && a.category.length > 0).length}/${articles.length} articles`
      }
    ];
    
    let passedTests = 0;
    tests.forEach((test, index) => {
      const status = test.condition ? '✅ PASS' : '❌ FAIL';
      console.log(`   ${index + 1}. ${test.name}: ${status}`);
      console.log(`      Expected: ${test.expected}, Actual: ${test.actual}`);
      if (test.condition) passedTests++;
    });
    
    console.log(`\n📊 Test Summary: ${passedTests}/${tests.length} tests passed (${Math.round(passedTests/tests.length*100)}%)`);
    
    if (articles.length === 20 && passedTests === tests.length) {
      console.log(`\n🎉 SUCCESS: MCP scraper is correctly limiting articles to exactly 20 per page!`);
    } else {
      console.log(`\n⚠️ ISSUES DETECTED: MCP scraper needs adjustment for proper article limiting.`);
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run the test
testMCPArticleLimit().catch(console.error);