#!/usr/bin/env tsx

/**
 * Test MCP scraper with minimal Cloudflare detection
 * Since user confirmed no Cloudflare blocking, we'll bypass most checks
 */

import { scrapeEdgePropMCP } from '../src/lib/scraper/edgeprop-mcp-scraper';

async function testMCPNoCloudflare() {
  console.log('🧪 Testing MCP scraper with minimal Cloudflare detection...');
  console.log('🎯 Goal: Scrape 1 article and verify content matches original');
  
  let progressCount = 0;
  
  const onProgress = (progress: any) => {
    progressCount++;
    console.log(`📊 Progress ${progressCount}: ${progress.message}`);
    console.log(`   📄 Page: ${progress.currentPage}/${progress.totalPages}`);
    console.log(`   📰 Articles: ${progress.articlesDiscovered} discovered, ${progress.articlesScraped} scraped`);
    console.log(`   ❌ Failed: ${progress.articlesFailed}`);
    console.log(`   🔄 Status: ${progress.status}`);
    console.log('---');
  };

  try {
    console.log('🚀 Starting MCP scraper test (1 page, max 1 article)...');
    
    const startTime = Date.now();
    // Limit to 1 article for testing
    const articles = await scrapeEdgePropMCP(1, onProgress, 'test-no-cf-session', true, 1);
    const endTime = Date.now();
    
    console.log('\n🎉 TEST COMPLETED!');
    console.log(`⏱️  Duration: ${Math.round((endTime - startTime) / 1000)} seconds`);
    console.log(`📰 Articles scraped: ${articles.length}`);
    
    if (articles.length > 0) {
      const article = articles[0];
      console.log('\n📋 Scraped article details:');
      console.log(`📰 Title: ${article.title}`);
      console.log(`👤 Author: ${article.author}`);
      console.log(`📝 Content length: ${article.text_content?.length || 0} chars`);
      console.log(`🔗 Path: ${article.path}`);
      console.log(`🖼️  Thumbnail: ${article.thumbnail}`);
      console.log(`📅 Created: ${article.created}`);
      console.log(`📂 Category: ${article.category?.join(', ')}`);
      console.log(`📄 Description: ${article.description?.substring(0, 200)}...`);
      console.log(`🔗 Full URL: https://www.edgeprop.sg${article.path}`);
      
      // Show first few paragraphs
      if (article.paragraphs && article.paragraphs.length > 0) {
        console.log('\n📝 First few paragraphs:');
        article.paragraphs.slice(0, 3).forEach((para, idx) => {
          console.log(`${idx + 1}. ${para.substring(0, 150)}...`);
        });
      }
      
      console.log('\n✅ SUCCESS: Article scraped successfully!');
      console.log('🔍 Next: Check this article in browser to compare with original');
      
    } else {
      console.log('⚠️  WARNING: No articles found');
    }
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:');
    console.error('Error:', error);
  }
}

// Run the test
testMCPNoCloudflare().catch((error) => console.error(error));