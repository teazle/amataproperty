#!/usr/bin/env bun

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';

async function showDetailedArticleData() {
  console.log('📄 Showing Detailed Article Data from EdgeProp Unified Scraper...\n');

  const onProgress = (_progress: unknown) => {
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
      console.log('🎯 COMPLETE ARTICLE DATA ANALYSIS:');
      console.log('================================================================================\n');
      
      // Basic Metadata
      console.log('📋 BASIC METADATA:');
      console.log('────────────────────────────────────────────────────────────────────────────────');
      console.log(`🆔 NID (Unique ID): ${article.nid}`);
      console.log(`📰 Title: ${article.title}`);
      console.log(`🔗 Path: ${article.path}`);
      console.log(`🖼️  Thumbnail: ${article.thumbnail}`);
      console.log(`👤 Author: "${article.author}"`);
      console.log(`📅 Created: ${article.created}`);
      console.log(`📅 Created On: ${article.created_on}`);
      console.log(`🏷️  Categories: ${Array.isArray(article.category) ? article.category.join(', ') : article.category}`);
      console.log(`🔍 Discovery Method: ${article.discovery_method}`);
      console.log(`⏰ Scraped At: ${article.scraped_at}`);
      
      // Keywords
      console.log(`\n🏷️  KEYWORDS:`);
      console.log(`────────────────────────────────────────────────────────────────────────────────`);
      if (article.keywords && article.keywords.length > 0) {
        article.keywords.forEach((keyword, index) => {
          console.log(`   ${index + 1}. ${keyword}`);
        });
      } else {
        console.log('   No keywords found');
      }

      // Content Analysis
      console.log(`\n📝 CONTENT ANALYSIS:`);
      console.log(`────────────────────────────────────────────────────────────────────────────────`);
      console.log(`📄 Description: ${article.description?.substring(0, 200)}...`);
      console.log(`📊 Text Content Length: ${article.text_content?.length} characters`);
      console.log(`📊 Word Count: ${article.word_count} words`);
      console.log(`⏱️  Reading Time: ${article.reading_time_minutes} minutes`);
      console.log(`📋 Paragraphs Count: ${article.paragraphs?.length}`);
      console.log(`🔗 Links Count: ${article.links?.length}`);

      // Full Text Content (first 1000 chars)
      console.log(`\n📖 FULL TEXT CONTENT (first 1000 characters):`);
      console.log(`────────────────────────────────────────────────────────────────────────────────`);
      console.log(article.text_content?.substring(0, 1000) + '...\n');

      // Paragraphs
      console.log(`\n📋 PARAGRAPHS (first 5):`);
      console.log(`────────────────────────────────────────────────────────────────────────────────`);
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

      // Links
      console.log(`\n🔗 LINKS (first 10):`);
      console.log(`────────────────────────────────────────────────────────────────────────────────`);
      if (article.links && article.links.length > 0) {
        article.links.slice(0, 10).forEach((link, index) => {
          console.log(`${index + 1}. [${link.type}] ${link.text} → ${link.url}`);
        });
        if (article.links.length > 10) {
          console.log(`   ... and ${article.links.length - 10} more links`);
        }
      } else {
        console.log('   No links found');
      }

      // Null Fields (fields we're not extracting)
      console.log(`\n🚫 NULL FIELDS (not extracted):`);
      console.log(`────────────────────────────────────────────────────────────────────────────────`);
      console.log(`HTML Content: ${article.html_content === null ? 'null (not extracted)' : 'present'}`);
      console.log(`Images: ${article.images === null ? 'null (not extracted)' : 'present'}`);
      console.log(`Main Image URL: ${article.main_image_url === null ? 'null (not extracted)' : 'present'}`);
      console.log(`Main Image Caption: ${article.main_image_caption === null ? 'null (not extracted)' : 'present'}`);
      console.log(`Tags: ${article.tags === null ? 'null (not extracted)' : 'present'}`);

      // Complete JSON
      console.log(`\n📋 COMPLETE JSON DATA:`);
      console.log(`────────────────────────────────────────────────────────────────────────────────`);
      console.log(JSON.stringify(article, null, 2));

    } else {
      console.log('⚠️ No articles captured.');
    }
  } catch (err) {
    console.error('❌ Test failed:', err instanceof Error ? err.message : String(err));
  }
}

showDetailedArticleData();
