import { scrapeEdgePropMCP } from './src/lib/scraper/edgeprop-mcp-scraper';

async function testActualMCPScraper() {
  console.log('🧪 Testing Actual MCP Scraper with Fixed Content Extraction');
  console.log('=' .repeat(60));

  try {
    const articles = await scrapeEdgePropMCP(
      1, // Just test 1 page
      (progress) => {
        console.log(`📊 Progress: Page ${progress.currentPage}/${progress.totalPages}, Articles: ${progress.articlesScraped}/${progress.articlesDiscovered}`);
      },
      'test-session',
      false, // Don't save to database
      3 // Limit to 3 articles for testing
    );

    console.log(`\n✅ Successfully scraped ${articles.length} articles`);

    // Test each article
    let passedTests = 0;
    let totalTests = 0;

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      console.log(`\n📰 Article ${i + 1}: ${article.title}`);
      console.log(`🔗 URL: ${article.path}`);
      
      // Test 1: Content Length
      totalTests++;
      const hasGoodContent = article.text_content && article.text_content.length > 500;
      console.log(`📝 Content Length: ${article.text_content?.length || 0} chars ${hasGoodContent ? '✅' : '❌'}`);
      if (hasGoodContent) passedTests++;

      // Test 2: Word Count
      totalTests++;
      const hasGoodWordCount = article.word_count > 50;
      console.log(`📊 Word Count: ${article.word_count} words ${hasGoodWordCount ? '✅' : '❌'}`);
      if (hasGoodWordCount) passedTests++;

      // Test 3: Paragraphs
      totalTests++;
      const hasGoodParagraphs = article.paragraphs && article.paragraphs.length > 3;
      console.log(`📄 Paragraphs: ${article.paragraphs?.length || 0} ${hasGoodParagraphs ? '✅' : '❌'}`);
      if (hasGoodParagraphs) passedTests++;

      // Test 4: Images
      totalTests++;
      const hasImages = article.images && article.images.length > 0;
      console.log(`🖼️  Images: ${article.images?.length || 0} ${hasImages ? '✅' : '❌'}`);
      if (hasImages) passedTests++;

      // Test 5: Author
      totalTests++;
      const hasAuthor = article.author && article.author.length > 0;
      console.log(`👤 Author: ${article.author || 'N/A'} ${hasAuthor ? '✅' : '❌'}`);
      if (hasAuthor) passedTests++;

      // Show content sample
      if (article.text_content) {
        const sample = article.text_content.substring(0, 200) + '...';
        console.log(`📖 Content Sample: ${sample}`);
      }

      // Show image info
      if (article.images && article.images.length > 0) {
        console.log(`🖼️  First Image: ${article.images[0].url}`);
        if (article.images[0].alt) {
          console.log(`   Alt Text: ${article.images[0].alt}`);
        }
      }
    }

    // Overall Results
    console.log('\n' + '='.repeat(60));
    console.log(`🎯 FINAL RESULTS:`);
    console.log(`✅ Tests Passed: ${passedTests}/${totalTests} (${Math.round(passedTests/totalTests*100)}%)`);
    console.log(`📰 Articles Scraped: ${articles.length}`);
    
    if (passedTests / totalTests >= 0.8) {
      console.log(`🎉 SUCCESS: MCP Scraper is working well!`);
    } else {
      console.log(`⚠️  WARNING: MCP Scraper needs improvement`);
    }

  } catch (error) {
    console.error('❌ Error testing MCP scraper:', error);
  }
}

testActualMCPScraper();