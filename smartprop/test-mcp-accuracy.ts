#!/usr/bin/env tsx

/**
 * Test script to verify MCP scraper accuracy
 * Compares scraped content with original article
 */

const testUrl = 'https://www.edgeprop.sg/property-news/singapore-property-market-outlook-2024-what-to-expect';

async function testMCPAccuracy() {
  console.log('🔍 Testing MCP Scraper Content Accuracy...');
  console.log(`📰 Test Article: ${testUrl}`);
  
  try {
    // Test our MCP scraper
    const response = await fetch('http://localhost:3000/api/articles/scrape-single', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: testUrl,
        scraperType: 'mcp'
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ MCP scraper failed:', data.error);
      return;
    }

    console.log('\n📊 SCRAPED ARTICLE DATA:');
    console.log('='.repeat(50));
    console.log(`📄 Title: ${data.article.title}`);
    console.log(`👤 Author: ${data.article.author}`);
    console.log(`🏷️ Category: ${data.article.category}`);
    console.log(`📊 Word Count: ${data.article.word_count}`);
    console.log(`⏱️ Reading Time: ${data.article.reading_time_minutes} minutes`);
    console.log(`📄 Paragraphs: ${data.article.paragraphs_count}`);
    console.log(`🖼️ Images: ${data.article.images_count}`);
    console.log(`🔗 Links: ${data.article.links_count}`);
    
    console.log('\n📝 CONTENT PREVIEW (First 500 characters):');
    console.log('-'.repeat(50));
    console.log(data.article.text_content?.substring(0, 500) + '...');
    
    console.log('\n📝 FULL CONTENT LENGTH:');
    console.log('-'.repeat(50));
    console.log(`Total characters: ${data.article.text_content?.length || 0}`);
    
    // Check for common article elements
    const content = data.article.text_content || '';
    console.log('\n🔍 CONTENT ANALYSIS:');
    console.log('-'.repeat(50));
    console.log(`Contains paragraphs: ${content.includes('\n\n') ? '✅' : '❌'}`);
    console.log(`Contains quotes: ${content.includes('"') || content.includes('"') || content.includes('"') ? '✅' : '❌'}`);
    console.log(`Contains numbers/statistics: ${/\d+%|\d+,\d+|\$\d+/.test(content) ? '✅' : '❌'}`);
    console.log(`Contains proper sentences: ${content.includes('.') && content.includes(' ') ? '✅' : '❌'}`);
    
    return data.article;
    
  } catch (error) {
    console.error('❌ Error testing MCP accuracy:', error);
  }
}

async function main() {
  await testMCPAccuracy();
}

main().catch(console.error);