#!/usr/bin/env tsx

/**
 * Test script for MCP scraper with stealth configuration
 * Tests if Cloudflare protection is bypassed
 */

import { scrapeEdgePropMCP } from '../src/lib/scraper/edgeprop-mcp-scraper';

async function testMCPStealth() {
  console.log('🧪 Testing MCP scraper with stealth configuration...');
  console.log('🎯 Goal: Verify Cloudflare bypass and article discovery');
  
  let progressCount = 0;
  
  const onProgress = (progress: unknown) => {
    progressCount++;
    console.log(`📊 Progress ${progressCount}: ${progress.message}`);
    console.log(`   📄 Page: ${progress.currentPage}/${progress.totalPages}`);
    console.log(`   📰 Articles: ${progress.articlesDiscovered} discovered, ${progress.articlesScraped} scraped`);
    console.log(`   ❌ Failed: ${progress.articlesFailed}`);
    console.log(`   🔄 Status: ${progress.status}`);
    console.log('---');
  };
  
  try {
    console.log('🚀 Starting MCP scraper test (1 page only)...');
    
    const startTime = Date.now();
    const articles = await scrapeEdgePropMCP(1, onProgress, 'test-stealth-session');
    const endTime = Date.now();
    
    console.log('\n🎉 TEST COMPLETED SUCCESSFULLY!');
    console.log(`⏱️  Duration: ${Math.round((endTime - startTime) / 1000)} seconds`);
    console.log(`📰 Articles found: ${articles.length}`);
    
    if (articles.length > 0) {
      console.log('\n📋 Sample articles:');
      articles.slice(0, 3).forEach((article, index) => {
        console.log(`${index + 1}. ${article.title}`);
        console.log(`   👤 Author: ${article.author}`);
        console.log(`   📝 Content length: ${article.text_content?.length || 0} chars`);
        console.log(`   🔗 Path: ${article.path}`);
        console.log('');
      });
      
      console.log('✅ SUCCESS: MCP scraper is working with stealth configuration!');
      console.log('✅ Cloudflare protection bypassed successfully!');
    } else {
      console.log('⚠️  WARNING: No articles found - may need further investigation');
    }
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:');
    console.error('Error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('Cloudflare') || error.message.includes('captcha')) {
        console.error('🚫 Cloudflare protection still active - stealth configuration needs adjustment');
      } else if (error.message.includes('timeout')) {
        console.error('⏱️  Timeout error - may need to adjust wait times');
      } else {
        console.error('🔧 Other error - check implementation');
      }
    }
  }
}

// Run the test
testMCPStealth().catch(console.error);
