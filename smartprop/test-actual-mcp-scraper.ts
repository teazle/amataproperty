import { scrapeEdgePropMCP, MCPArticle } from './src/lib/scraper/edgeprop-mcp-scraper';

/**
 * Simple test to validate the actual MCP scraper is working correctly
 * This will scrape 1 article from EdgeProp and verify the content
 */
async function testActualMCPScraper() {
  console.log('🚀 Testing Actual EdgeProp MCP Scraper...\n');
  
  try {
    console.log('📍 Running EdgeProp scraper for 1 article...');
    
    const startTime = Date.now();
    const articles = await scrapeEdgePropMCP(
      1, // maxPages - just 1 page
      (progress) => {
        console.log(`📊 ${progress.message}`);
        console.log(`   📄 Page: ${progress.currentPage}/${progress.totalPages}`);
        console.log(`   📰 Articles: ${progress.articlesDiscovered} discovered, ${progress.articlesScraped} scraped`);
        console.log(`   ❌ Failed: ${progress.articlesFailed}`);
        console.log(`   🔄 Status: ${progress.status}\n`);
      },
      'test-mcp-scraper-session', // sessionId
      false, // saveImmediately
      1 // maxArticles - limit to exactly 1 article for testing
    );
    const endTime = Date.now();
    
    console.log(`\n⏱️ Scraping completed in ${(endTime - startTime) / 1000}s`);
    
    if (articles.length === 0) {
      console.error('❌ No articles were scraped');
      return;
    }
    
    const article = articles[0];
    console.log(`\n✅ Successfully scraped 1 article!`);
    console.log(`\n📋 Article Details:`);
    console.log(`   📰 Title: ${article.title}`);
    console.log(`   👤 Author: ${article.author}`);
    console.log(`   🔗 URL: https://www.edgeprop.sg${article.path}`);
    console.log(`   📅 Published: ${article.created_on}`);
    console.log(`   🏷️  Categories: ${Array.isArray(article.category) ? article.category.join(', ') : article.category}`);
    console.log(`   📝 Description: ${article.description.substring(0, 100)}...`);
    console.log(`   📊 Content Length: ${article.text_content.length} characters`);
    console.log(`   📄 Paragraphs: ${article.paragraphs.length}`);
    console.log(`   🖼️  Images: ${article.images.length}`);
    console.log(`   🔗 Links: ${article.links.length}`);
    console.log(`   📖 Word Count: ${article.word_count}`);
    console.log(`   ⏱️  Reading Time: ${article.reading_time_minutes} minutes`);
    
    // Validate content quality
    console.log(`\n🔍 Content Quality Validation:`);
    
    const validations = [
      { test: 'Title exists', pass: article.title && article.title.length > 10 },
      { test: 'Author exists', pass: article.author && article.author.length > 0 },
      { test: 'Content substantial', pass: article.text_content.length > 500 },
      { test: 'Has paragraphs', pass: article.paragraphs.length > 3 },
      { test: 'Has images', pass: article.images.length > 0 },
      { test: 'Word count reasonable', pass: article.word_count > 100 },
      { test: 'Reading time calculated', pass: article.reading_time_minutes > 0 },
      { test: 'Categories exist', pass: article.category && (Array.isArray(article.category) ? article.category.length > 0 : (article.category as string).length > 0) },
      { test: 'Description exists', pass: article.description && article.description.length > 50 }
    ];
    
    validations.forEach(v => {
      console.log(`   ${v.pass ? '✅' : '❌'} ${v.test}`);
    });
    
    const passedTests = validations.filter(v => v.pass).length;
    const totalTests = validations.length;
    
    console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed (${Math.round(passedTests/totalTests*100)}%)`);
    
    if (passedTests === totalTests) {
      console.log('\n🎉 ALL TESTS PASSED! MCP scraper is working perfectly.');
    } else if (passedTests >= totalTests * 0.8) {
      console.log('\n⚠️  Most tests passed, minor issues detected.');
    } else {
      console.log('\n❌ Multiple issues detected with MCP scraper.');
    }
    
    // Show sample content
    console.log(`\n📄 Sample Content (first 300 characters):`);
    console.log(`"${article.text_content.substring(0, 300)}..."`);
    
    // Show sample images
    if (article.images.length > 0) {
      console.log(`\n🖼️  Sample Images (first 3):`);
      article.images.slice(0, 3).forEach((img, i) => {
        console.log(`   ${i + 1}. ${img.url}`);
        if (img.alt) console.log(`      Alt: ${img.alt}`);
        if (img.caption) console.log(`      Caption: ${img.caption}`);
      });
    }
    
    return article;
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

// Run the test
testActualMCPScraper()
  .then(() => {
    console.log('\n✅ Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });