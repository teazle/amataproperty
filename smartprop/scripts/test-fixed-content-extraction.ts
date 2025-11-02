#!/usr/bin/env bun

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';

async function testFixedContentExtraction() {
  console.log('🔧 Testing Fixed Content Extraction...\n');

  const onProgress = (progress: any) => {
    // console.log(`[${progress.step}] ${progress.message}`); // Commented out for cleaner output
  };

  try {
    const result = await scrapeEdgePropUnified(
      1, // maxPages
      onProgress,
      null, // sessionId - no database save for this test
      1 // maxArticlesToScrapeContent - limit to 1 for detailed analysis
    );

    if (result && result.length > 0) {
      const article = result[0];
      console.log('\n🎯 FIXED CONTENT EXTRACTION RESULTS:');
      console.log('================================================================================\n');
      
      // Basic Metadata
      console.log('📋 BASIC METADATA:');
      console.log('────────────────────────────────────────────────────────────────────────────────');
      console.log(`🆔 NID: ${article.nid}`);
      console.log(`📰 Title: ${article.title}`);
      console.log(`👤 Author: "${article.author}"`);
      console.log(`📅 Created: ${article.created}`);
      console.log(`🏷️  Categories: ${Array.isArray(article.category) ? article.category.join(', ') : article.category}`);
      console.log(`🔍 Discovery Method: ${article.discovery_method}`);
      
      // Content Analysis
      console.log(`\n📝 CONTENT ANALYSIS:`);
      console.log('────────────────────────────────────────────────────────────────────────────────');
      console.log(`📊 Text Content Length: ${article.text_content?.length} characters`);
      console.log(`📊 Word Count: ${article.word_count} words`);
      console.log(`⏱️  Reading Time: ${article.reading_time_minutes} minutes`);
      console.log(`📋 Paragraphs Count: ${article.paragraphs?.length}`);
      console.log(`🔗 Links Count: ${article.links?.length}`);

      // Full Text Content (first 1000 chars)
      console.log(`\n📖 FULL TEXT CONTENT (first 1000 characters):`);
      console.log('────────────────────────────────────────────────────────────────────────────────');
      console.log(article.text_content?.substring(0, 1000) + '...\n');

      // Paragraphs
      console.log(`\n📋 PARAGRAPHS (first 5):`);
      console.log('────────────────────────────────────────────────────────────────────────────────');
      if (article.paragraphs && article.paragraphs.length > 0) {
        article.paragraphs.slice(0, 5).forEach((paragraph, index) => {
          console.log(`${index + 1}. ${paragraph.substring(0, 150)}...`);
        });
        if (article.paragraphs.length > 5) {
          console.log(`   ... and ${article.paragraphs.length - 5} more paragraphs`);
        }
      } else {
        console.log('   No paragraphs found');
      }

      // Check if content looks like actual article content
      console.log(`\n🔍 CONTENT QUALITY CHECK:`);
      console.log('────────────────────────────────────────────────────────────────────────────────');
      const hasRealContent = article.text_content && 
        !article.text_content.includes('Whether you are looking to buy, sell or rent') &&
        !article.text_content.includes('Make data-driven property decisions') &&
        !article.text_content.includes('Our whole new Research tool') &&
        article.text_content.length > 1000;
      
      console.log(`✅ Has Real Article Content: ${hasRealContent ? 'YES' : 'NO'}`);
      console.log(`✅ Content Length Adequate: ${(article.text_content?.length || 0) > 1000 ? 'YES' : 'NO'}`);
      console.log(`✅ No Footer Content: ${!article.text_content?.includes('Whether you are looking to buy, sell or rent') ? 'YES' : 'NO'}`);

      if (hasRealContent) {
        console.log('\n🎉 SUCCESS: Content extraction is now working correctly!');
      } else {
        console.log('\n⚠️  ISSUE: Content extraction still needs improvement.');
      }

    } else {
      console.log('⚠️ No articles captured during fixed content extraction test.');
    }
  } catch (err) {
    console.error('❌ Test failed:', err instanceof Error ? err.message : String(err));
  }
}

testFixedContentExtraction();
