#!/usr/bin/env node

import { scrapeEdgePropMCP, MCPArticle, MCPProgress } from './edgeprop-mcp-scraper';

async function testMCPScraper() {
  console.log('🚀 Testing MCP Scraper with improved content extraction...\n');

  const progressCallback = (progress: MCPProgress) => {
    console.log(`📊 Progress: Page ${progress.currentPage}/${progress.totalPages}, Articles: ${progress.articlesScraped}/${progress.articlesDiscovered}, Status: ${progress.status}`);
  };

  try {
    // Test with just 1 page and 1 article to verify content extraction
    console.log('🔍 Scraping 1 page, max 1 article...');
    const articles = await scrapeEdgePropMCP(1, progressCallback, undefined, false, 1);
    
    console.log(`\n✅ Scraping completed! Found ${articles.length} articles\n`);

    if (articles.length > 0) {
      const article = articles[0];
      console.log('📄 Article Details:');
      console.log(`   Title: ${article.title}`);
      console.log(`   Author: ${article.author}`);
      console.log(`   Category: ${Array.isArray(article.category) ? article.category.join(', ') : article.category}`);
      console.log(`   Text Content Length: ${article.text_content?.length || 0} characters`);
      console.log(`   Word Count: ${article.word_count}`);
      console.log(`   Paragraphs: ${article.paragraphs?.length || 0}`);
      console.log(`   Reading Time: ${article.reading_time_minutes} minutes`);
      console.log(`   Links: ${article.links?.length || 0}`);
      console.log(`   Images: ${article.images?.length || 0}`);

      // Validation tests
      console.log('\n🧪 Running Validation Tests:');
      let passedTests = 0;
      const totalTests = 9;

      // Test 1: Article has title
      if (article.title && article.title.length > 0) {
        console.log('✅ 1. Article has title');
        passedTests++;
      } else {
        console.log('❌ 1. Article missing title');
      }

      // Test 2: Article has author
      if (article.author && article.author.length > 0) {
        console.log('✅ 2. Article has author');
        passedTests++;
      } else {
        console.log('❌ 2. Article missing author');
      }

      // Test 3: Article has category
      if (article.category && (Array.isArray(article.category) ? article.category.length > 0 : (article.category as string).length > 0)) {
        console.log('✅ 3. Article has category');
        passedTests++;
      } else {
        console.log('❌ 3. Article missing category');
      }

      // Test 4: Article has substantial text content
      if (article.text_content && article.text_content.length > 1000) {
        console.log('✅ 4. Article has substantial text content');
        passedTests++;
      } else {
        console.log(`❌ 4. Article text content too short (${article.text_content?.length || 0} chars, need > 1000)`);
      }

      // Test 5: Article has reasonable word count
      if (article.word_count && article.word_count > 100) {
        console.log('✅ 5. Article has reasonable word count');
        passedTests++;
      } else {
        console.log(`❌ 5. Article word count too low (${article.word_count}, need > 100)`);
      }

      // Test 6: Article has paragraphs
      if (article.paragraphs && article.paragraphs.length > 5) {
        console.log('✅ 6. Article has multiple paragraphs');
        passedTests++;
      } else {
        console.log(`❌ 6. Article has too few paragraphs (${article.paragraphs?.length || 0}, need > 5)`);
      }

      // Test 7: Article has reading time
      if (article.reading_time_minutes && article.reading_time_minutes > 0) {
        console.log('✅ 7. Article has reading time');
        passedTests++;
      } else {
        console.log('❌ 7. Article missing reading time');
      }

      // Test 8: Article has creation date
      if (article.created && article.created.length > 0) {
        console.log('✅ 8. Article has creation date');
        passedTests++;
      } else {
        console.log('❌ 8. Article missing creation date');
      }

      // Test 9: Article has scraped timestamp
      if (article.scraped_at) {
        console.log('✅ 9. Article has scraped timestamp');
        passedTests++;
      } else {
        console.log('❌ 9. Article missing scraped timestamp');
      }

      const successRate = Math.round((passedTests / totalTests) * 100);
      console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed (${successRate}%)`);

      if (successRate >= 90) {
        console.log('🎉 EXCELLENT! MCP Scraper is working perfectly!');
      } else if (successRate >= 75) {
        console.log('✅ GOOD! MCP Scraper is working well with minor issues.');
      } else {
        console.log('⚠️ NEEDS IMPROVEMENT! MCP Scraper has significant issues.');
      }

      // Show content sample
      if (article.text_content && article.text_content.length > 0) {
        console.log('\n📝 Content Sample (first 300 chars):');
        console.log(`"${article.text_content.substring(0, 300)}..."`);
      }

    } else {
      console.log('❌ No articles were scraped!');
    }

  } catch (error) {
    console.error('❌ Error testing MCP scraper:', error);
  }
}

// Run the test
testMCPScraper().catch(console.error);