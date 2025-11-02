#!/usr/bin/env bun

/**
 * Test script to scrape a single article and save it to the database
 * This is part of the comprehensive testing workflow
 */

import { scrapeArticleContent } from '../src/lib/scraper/edgeprop-content-scraper';
import { upsertArticles } from '../src/lib/db/articles';
import { upsertArticleContent } from '../src/lib/db/article-content';
import { createScrapeSession, completeScrapeSession } from '../src/lib/db/articles';

// Target article for testing
const TEST_ARTICLE = {
  nid: 'test-001',
  path: 'property-news/singapore-property-market-outlook-2024-experts-weigh-in-on-trends-and-predictions',
  title: 'Singapore property market outlook 2024: Experts weigh in on trends and predictions',
  thumbnail: '',
  author: 'EdgeProp Singapore',
  created: '1704067200',
  category: ['Market Analysis'],
  description: 'Industry experts share their insights on what to expect in Singapore\'s property market for 2024',
  created_on: 'January 1, 2024',
  keywords: ['property market', 'singapore', '2024', 'outlook', 'trends'],
  discovery_method: 'test'
};

async function testSingleArticleScrape() {
  console.log('🚀 Starting single article scrape test...');
  console.log(`📄 Target article: ${TEST_ARTICLE.title}`);
  console.log(`🔗 Path: ${TEST_ARTICLE.path}`);
  
  try {
    // Create a scrape session
    console.log('\n📊 Creating scrape session...');
    const sessionId = await createScrapeSession();
    console.log(`✅ Session created: ${sessionId}`);
    
    // Step 1: Scrape the article metadata and save to database
    console.log('\n📝 Saving article metadata to database...');
    const { newArticles, duplicates } = await upsertArticles([TEST_ARTICLE], sessionId);
    console.log(`✅ Articles saved - New: ${newArticles}, Duplicates: ${duplicates}`);
    
    // Step 2: Scrape full content
    console.log('\n🔍 Scraping full article content...');
    const articleContent = await scrapeArticleContent(TEST_ARTICLE.path, TEST_ARTICLE.nid);
    
    if (!articleContent) {
      throw new Error('Failed to scrape article content');
    }
    
    console.log('✅ Article content scraped successfully!');
    console.log(`📊 Content stats:`);
    console.log(`   - Title: ${articleContent.title}`);
    console.log(`   - Author: ${articleContent.author}`);
    console.log(`   - Word count: ${articleContent.word_count}`);
    console.log(`   - Reading time: ${articleContent.reading_time_minutes} minutes`);
    console.log(`   - Paragraphs: ${articleContent.paragraphs.length}`);
    console.log(`   - Images: ${articleContent.images.length}`);
    console.log(`   - Links: ${articleContent.links.length}`);
    console.log(`   - Tags: ${articleContent.tags.length}`);
    
    // Step 3: Save full content to database
    console.log('\n💾 Saving full content to database...');
    await upsertArticleContent(articleContent);
    console.log('✅ Full content saved to database!');
    
    // Complete the session
    await completeScrapeSession(sessionId, 'completed');
    console.log('✅ Scrape session completed!');
    
    // Display sample content
    console.log('\n📖 Sample content preview:');
    console.log('─'.repeat(50));
    console.log(`Title: ${articleContent.title}`);
    console.log(`Author: ${articleContent.author}`);
    console.log(`Published: ${articleContent.published_date}`);
    console.log('─'.repeat(50));
    
    if (articleContent.paragraphs.length > 0) {
      console.log('First paragraph:');
      console.log(articleContent.paragraphs[0].substring(0, 200) + '...');
    }
    
    if (articleContent.images.length > 0) {
      console.log(`\nMain image: ${articleContent.main_image_url}`);
      console.log(`Other images: ${articleContent.images.slice(0, 3).join(', ')}${articleContent.images.length > 3 ? '...' : ''}`);
    }
    
    if (articleContent.tags.length > 0) {
      console.log(`\nTags: ${articleContent.tags.join(', ')}`);
    }
    
    console.log('\n🎉 Single article scrape test completed successfully!');
    console.log(`📄 Article ID: ${TEST_ARTICLE.nid}`);
    console.log(`📊 Session ID: ${sessionId}`);
    
    return {
      success: true,
      sessionId,
      articleContent,
      stats: {
        wordCount: articleContent.word_count,
        readingTime: articleContent.reading_time_minutes,
        paragraphs: articleContent.paragraphs.length,
        images: articleContent.images.length,
        links: articleContent.links.length,
        tags: articleContent.tags.length
      }
    };
    
  } catch (error) {
    console.error('❌ Error during single article scrape test:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Run the test if this script is executed directly
if (import.meta.main) {
  testSingleArticleScrape()
    .then(result => {
      if (result.success) {
        console.log('\n✅ Test completed successfully!');
        process.exit(0);
      } else {
        console.log('\n❌ Test failed:', result.error);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('❌ Unexpected error:', error);
      process.exit(1);
    });
}

export { testSingleArticleScrape, TEST_ARTICLE };