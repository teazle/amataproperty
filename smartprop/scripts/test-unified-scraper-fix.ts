#!/usr/bin/env bun

/**
 * Test script for the fixed EdgeProp unified scraper
 * This will test the API intercept method improvements
 */

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';

async function testUnifiedScraper() {
  console.log('🧪 Testing EdgeProp Unified Scraper with API intercept fixes...\n');
  
  let progressCount = 0;
  const progressCallback = (progress: any) => {
    progressCount++;
    console.log(`[${progressCount}] ${progress.message}`);
    console.log(`   Status: ${progress.status}`);
    console.log(`   Page: ${progress.currentPage}/${progress.totalPages}`);
    console.log(`   Articles: ${progress.articlesScraped} scraped, ${progress.articlesFailed} failed`);
    console.log(`   Discovered: ${progress.articlesDiscovered}`);
    console.log('');
  };
  
  try {
    // Test with just 1 page to verify the fixes work
    const articles = await scrapeEdgePropUnified(1, progressCallback);
    
    console.log('✅ Test completed successfully!');
    console.log(`📊 Results:`);
    console.log(`   Total articles scraped: ${articles.length}`);
    
    if (articles.length > 0) {
      console.log(`   Sample article: ${articles[0].title}`);
      console.log(`   Content length: ${articles[0].text_content?.length || 0} characters`);
      console.log(`   Word count: ${articles[0].word_count}`);
      console.log(`   Reading time: ${articles[0].reading_time_minutes} minutes`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run the test
testUnifiedScraper().catch(console.error);
