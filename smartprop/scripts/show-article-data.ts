#!/usr/bin/env bun

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';

async function showArticleData() {
  console.log('📄 Showing Complete Article Data from EdgeProp Unified Scraper...\n');

  const onProgress = (progress: any) => {
    // Minimal progress output for cleaner results
  };

  try {
    const result = await scrapeEdgePropUnified(
      1, // maxPages
      onProgress,
      null // sessionId - no database save for this test
    );

    if (result && result.length > 0) {
      const firstArticle = result[0];
      
      console.log('🎯 Complete Article Data:');
      console.log('=' .repeat(80));
      console.log(`Title: ${firstArticle.title}`);
      console.log(`Author: ${firstArticle.author}`);
      console.log(`NID: ${firstArticle.nid}`);
      console.log(`Path: ${firstArticle.path}`);
      console.log(`Thumbnail: ${firstArticle.thumbnail}`);
      console.log(`Created: ${firstArticle.created}`);
      console.log(`Created On: ${firstArticle.created_on}`);
      console.log(`Category: ${Array.isArray(firstArticle.category) ? firstArticle.category.join(', ') : firstArticle.category}`);
      console.log(`Description: ${firstArticle.description}`);
      console.log(`Keywords: ${firstArticle.keywords}`);
      console.log(`Word Count: ${firstArticle.word_count}`);
      console.log(`Reading Time: ${firstArticle.reading_time_minutes} minutes`);
      console.log(`Text Content Length: ${firstArticle.text_content?.length} characters`);
      console.log(`Paragraphs Count: ${firstArticle.paragraphs?.length}`);
      console.log(`Links Count: ${firstArticle.links?.length}`);
      console.log(`Scraped At: ${firstArticle.scraped_at}`);
      
      console.log('\n📝 Full Text Content (first 500 chars):');
      console.log('-'.repeat(50));
      console.log(firstArticle.text_content?.substring(0, 500) + '...');
      
      console.log('\n🔗 Links Found:');
      firstArticle.links?.forEach((link, index) => {
        console.log(`  ${index + 1}. ${link.text} (${link.type}): ${link.url}`);
      });
      
      console.log('\n📊 JSON Output:');
      console.log(JSON.stringify(firstArticle, null, 2));
      
    } else {
      console.log('❌ No articles found');
    }

  } catch (err) {
    console.error('❌ Test failed:', err instanceof Error ? err.message : String(err));
  }
}

showArticleData();
