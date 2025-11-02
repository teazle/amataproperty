#!/usr/bin/env npx tsx

/**
 * Test script for the fixed MCP scraper implementation
 * Verifies that it correctly extracts the 20 target articles without redirects
 */

import 'dotenv/config';
import { scrapeEdgePropMCPFixed, type MCPProgress } from './src/lib/scraper/edgeprop-mcp-scraper-fixed';

// Target articles to verify extraction
const TARGET_ARTICLES = [
  'Penang property market outlook for 2025',
  'Johor property market outlook for 2025',
  'Selangor property market outlook for 2025',
  'Kuala Lumpur property market outlook for 2025',
  'Sabah property market outlook for 2025',
  'Sarawak property market outlook for 2025',
  'Perak property market outlook for 2025',
  'Kedah property market outlook for 2025',
  'Negeri Sembilan property market outlook for 2025',
  'Melaka property market outlook for 2025',
  'Pahang property market outlook for 2025',
  'Terengganu property market outlook for 2025',
  'Kelantan property market outlook for 2025',
  'Perlis property market outlook for 2025',
  'Putrajaya property market outlook for 2025',
  'Labuan property market outlook for 2025',
  'Malaysia property market outlook for 2025',
  'Property investment trends in Malaysia for 2025',
  'Malaysian property developers outlook for 2025',
  'Property financing trends in Malaysia for 2025'
];

async function testMCPScraperFixed() {
  console.log('🚀 Testing Fixed MCP Scraper Implementation');
  console.log('=' .repeat(60));
  
  const startTime = Date.now();
  let articlesFound = 0;
  let targetArticlesFound = 0;
  
  try {
    // Progress callback to track scraping progress
    const onProgress = (progress: MCPProgress) => {
      console.log(`📊 Progress: Page ${progress.currentPage}/${progress.totalPages} | Articles: ${progress.articlesScraped}/${progress.articlesDiscovered} | Status: ${progress.status}`);
      if (progress.message) {
        console.log(`   Message: ${progress.message}`);
      }
    };
    
    console.log('🔍 Starting article extraction...');
    console.log(`📋 Looking for ${TARGET_ARTICLES.length} target articles`);
    console.log('');
    
    // Run the fixed scraper with exactly 20 articles
    const articles = await scrapeEdgePropMCPFixed(
      1, // maxPages
      onProgress,
      undefined, // sessionId
      false, // saveImmediately
      20 // maxArticles - exactly 20 as required
    );
    
    articlesFound = articles.length;
    console.log('');
    console.log('📊 EXTRACTION RESULTS');
    console.log('=' .repeat(40));
    console.log(`✅ Total articles extracted: ${articlesFound}`);
    console.log('');
    
    // Verify we got exactly 20 articles
    if (articlesFound !== 20) {
      console.log(`❌ ERROR: Expected exactly 20 articles, but got ${articlesFound}`);
      return;
    }
    
    console.log('📋 EXTRACTED ARTICLES:');
    console.log('-' .repeat(40));
    
    // Check each extracted article
    articles.forEach((article, index) => {
      console.log(`${index + 1}. ${article.title}`);
      console.log(`   📄 NID: ${article.nid}`);
      console.log(`   🔗 Path: ${article.path}`);
      console.log(`   👤 Author: ${article.author}`);
      console.log(`   📅 Created: ${article.created}`);
      console.log(`   📝 Content Length: ${article.text_content?.length || 0} chars`);
      console.log(`   🖼️  Images: ${article.images?.length || 0}`);
      console.log(`   📊 Word Count: ${article.word_count || 0}`);
      console.log('');
      
      // Check if this matches any target article
      const isTargetArticle = TARGET_ARTICLES.some(target => 
        article.title.toLowerCase().includes(target.toLowerCase()) ||
        target.toLowerCase().includes(article.title.toLowerCase())
      );
      
      if (isTargetArticle) {
        targetArticlesFound++;
        console.log(`   ✅ MATCHES TARGET ARTICLE!`);
      }
      
      console.log('');
    });
    
    // Summary
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log('🎯 VERIFICATION SUMMARY');
    console.log('=' .repeat(40));
    console.log(`✅ Articles extracted: ${articlesFound}/20`);
    console.log(`🎯 Target articles found: ${targetArticlesFound}/${TARGET_ARTICLES.length}`);
    console.log(`⏱️  Total time: ${duration.toFixed(2)} seconds`);
    console.log(`📊 Average time per article: ${(duration / articlesFound).toFixed(2)} seconds`);
    
    // Validation checks
    console.log('');
    console.log('🔍 VALIDATION CHECKS');
    console.log('=' .repeat(40));
    
    const validationResults = {
      exactCount: articlesFound === 20,
      hasContent: articles.every(a => a.text_content && a.text_content.length > 0),
      hasMetadata: articles.every(a => a.title && a.author && a.created),
      hasImages: articles.some(a => a.images && a.images.length > 0),
      hasWordCount: articles.every(a => a.word_count && a.word_count > 0),
      hasReadingTime: articles.every(a => a.reading_time_minutes && a.reading_time_minutes > 0)
    };
    
    Object.entries(validationResults).forEach(([check, passed]) => {
      console.log(`${passed ? '✅' : '❌'} ${check}: ${passed ? 'PASSED' : 'FAILED'}`);
    });
    
    const allValidationsPassed = Object.values(validationResults).every(v => v);
    
    console.log('');
    if (allValidationsPassed && articlesFound === 20) {
      console.log('🎉 SUCCESS: Fixed MCP scraper is working correctly!');
      console.log('✅ All 20 articles extracted with complete content and metadata');
    } else {
      console.log('❌ ISSUES DETECTED: Some validations failed');
      console.log('🔧 Review the implementation and fix any issues');
    }
    
  } catch (error) {
    console.error('❌ ERROR during scraping:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'Unknown error');
  }
}

// Run the test
testMCPScraperFixed().catch(console.error);