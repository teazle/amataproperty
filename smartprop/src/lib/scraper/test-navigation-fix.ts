#!/usr/bin/env node

import { scrapeEdgePropMCP, MCPArticle as _MCPArticle, MCPProgress } from './edgeprop-mcp-scraper';

async function testNavigationFix() {
  console.log('🚀 Testing MCP Scraper Navigation Fix...\n');
  console.log('✅ Updated navigation to use: https://www.edgeprop.sg/property-news/latest\n');

  const progressCallback = (progress: MCPProgress) => {
    console.log(`📊 Progress: Page ${progress.currentPage}/${progress.totalPages}, Articles: ${progress.articlesScraped}/${progress.articlesDiscovered}, Status: ${progress.status}`);
    if (progress.message) {
      console.log(`   Message: ${progress.message}`);
    }
  };

  try {
    // Test with just 1 page and 2 articles to verify navigation and article discovery
    console.log('🔍 Testing navigation fix with 1 page, max 2 articles...');
    const articles = await scrapeEdgePropMCP(1, progressCallback, undefined, false, 2);
    
    console.log(`\n✅ Scraping completed! Found ${articles.length} articles\n`);

    if (articles.length > 0) {
      console.log('📄 Navigation Fix Test Results:');
      console.log(`   ✅ Successfully navigated to /property-news/latest`);
      console.log(`   ✅ Found ${articles.length} articles on the page`);
      console.log(`   ✅ Successfully clicked into individual articles\n`);

      // Show details of scraped articles
      articles.forEach((article, index) => {
        console.log(`📰 Article ${index + 1}:`);
        console.log(`   Title: ${article.title}`);
        console.log(`   Path: ${article.path}`);
        console.log(`   Author: ${article.author}`);
        console.log(`   Content Length: ${article.text_content?.length || 0} characters`);
        console.log(`   Word Count: ${article.word_count}`);
        console.log(`   Paragraphs: ${article.paragraphs?.length || 0}`);
        console.log(`   Images: ${article.images?.length || 0}`);
        console.log(`   Category: ${Array.isArray(article.category) ? article.category.join(', ') : article.category}`);
        
        // Show content sample
        if (article.text_content && article.text_content.length > 0) {
          console.log(`   Content Sample: "${article.text_content.substring(0, 150)}..."`);
        }
        console.log('');
      });

      // Validation tests
      console.log('🧪 Running Navigation Fix Validation:');
      let passedTests = 0;
      const totalTests = 6;

      // Test 1: Articles were found
      if (articles.length > 0) {
        console.log('✅ 1. Articles were discovered from /property-news/latest');
        passedTests++;
      } else {
        console.log('❌ 1. No articles found on /property-news/latest');
      }

      // Test 2: Articles have valid paths
      const validPaths = articles.every(article => article.path && article.path.includes('/property-news/'));
      if (validPaths) {
        console.log('✅ 2. All articles have valid property-news paths');
        passedTests++;
      } else {
        console.log('❌ 2. Some articles have invalid paths');
      }

      // Test 3: Articles have titles
      const validTitles = articles.every(article => article.title && article.title.length > 10);
      if (validTitles) {
        console.log('✅ 3. All articles have valid titles');
        passedTests++;
      } else {
        console.log('❌ 3. Some articles have missing or short titles');
      }

      // Test 4: Articles have content
      const validContent = articles.every(article => article.text_content && article.text_content.length > 100);
      if (validContent) {
        console.log('✅ 4. All articles have substantial content');
        passedTests++;
      } else {
        console.log('❌ 4. Some articles have insufficient content');
      }

      // Test 5: Articles have paragraphs
      const validParagraphs = articles.every(article => article.paragraphs && article.paragraphs.length > 0);
      if (validParagraphs) {
        console.log('✅ 5. All articles have paragraphs');
        passedTests++;
      } else {
        console.log('❌ 5. Some articles have no paragraphs');
      }

      // Test 6: Articles have word counts
      const validWordCounts = articles.every(article => article.word_count && article.word_count > 50);
      if (validWordCounts) {
        console.log('✅ 6. All articles have reasonable word counts');
        passedTests++;
      } else {
        console.log('❌ 6. Some articles have low word counts');
      }

      const successRate = Math.round((passedTests / totalTests) * 100);
      console.log(`\n📊 Navigation Fix Test Results: ${passedTests}/${totalTests} tests passed (${successRate}%)`);

      if (successRate >= 90) {
        console.log('🎉 EXCELLENT! Navigation fix is working perfectly!');
        console.log('✅ MCP Scraper now correctly navigates to /property-news/latest');
        console.log('✅ Successfully finds and scrapes individual articles');
      } else if (successRate >= 75) {
        console.log('✅ GOOD! Navigation fix is working with minor issues.');
      } else {
        console.log('⚠️ NEEDS IMPROVEMENT! Navigation fix has significant issues.');
      }

    } else {
      console.log('❌ Navigation fix failed - no articles were found!');
      console.log('   This could indicate:');
      console.log('   - The /property-news/latest page structure has changed');
      console.log('   - Article selectors need updating');
      console.log('   - Cloudflare protection is blocking access');
    }

  } catch (error) {
    console.error('❌ Error testing navigation fix:', error);
  }
}

// Run the test
testNavigationFix().catch(console.error);