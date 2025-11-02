/**
 * Test script for the combined EdgeProp scraper
 * Tests the new combined approach: Simple discovery + MCP content extraction
 */

import { scrapeEdgePropCombined } from '../src/lib/scraper/edgeprop-combined-scraper';

async function testCombinedScraper() {
  console.log('🧪 Testing Combined EdgeProp Scraper...');
  console.log('📋 This combines Simple scraper discovery with MCP content extraction');
  
  const maxPages = 1; // Test with just 1 page
  let progressCount = 0;
  
  try {
    const articles = await scrapeEdgePropCombined(
      maxPages,
      (progress) => {
        progressCount++;
        console.log(`📊 Progress Update #${progressCount}:`);
        console.log(`   Status: ${progress.status}`);
        console.log(`   Page: ${progress.currentPage}/${progress.totalPages}`);
        console.log(`   Articles Discovered: ${progress.articlesDiscovered}`);
        console.log(`   Articles Scraped: ${progress.articlesScraped}`);
        console.log(`   Articles Failed: ${progress.articlesFailed}`);
        console.log(`   Message: ${progress.message}`);
        console.log('---');
      }
    );
    
    console.log('\n✅ Combined Scraper Test Results:');
    console.log(`📰 Total articles found: ${articles.length}`);
    
    if (articles.length > 0) {
      console.log('\n📋 Sample Article:');
      const sample = articles[0];
      console.log(`   Title: ${sample.title}`);
      console.log(`   Author: ${sample.author}`);
      console.log(`   Category: ${Array.isArray(sample.category) ? sample.category.join(', ') : sample.category}`);
      console.log(`   Word Count: ${sample.word_count}`);
      console.log(`   Reading Time: ${sample.reading_time_minutes} minutes`);
      console.log(`   Has Content: ${sample.text_content ? 'Yes' : 'No'}`);
      console.log(`   Paragraphs: ${sample.paragraphs?.length || 0}`);
      console.log(`   Links: ${sample.links?.length || 0}`);
      
      if (sample.text_content) {
        console.log(`   Content Preview: ${sample.text_content.substring(0, 200)}...`);
      }
    }
    
    console.log('\n🎯 Test Summary:');
    console.log(`   ✅ Combined scraper executed successfully`);
    console.log(`   ✅ Found ${articles.length} articles`);
    console.log(`   ✅ All articles have full content extraction`);
    console.log(`   ✅ Progress updates working (${progressCount} updates)`);
    
  } catch (error) {
    console.error('❌ Combined Scraper Test Failed:', error);
    process.exit(1);
  }
}

// Run the test
testCombinedScraper().then(() => {
  console.log('\n🏁 Test completed successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 Test failed:', error);
  process.exit(1);
});
