#!/usr/bin/env bun

import { scrapeEdgePropMCP } from '../src/lib/scraper/edgeprop-mcp-scraper';

async function testUpdatedMCPScraper() {
  console.log('🧪 Testing updated MCP scraper with improved thumbnail extraction...\n');

  try {
    const results = await scrapeEdgePropMCP(
      1, // maxPages
      (progress) => {
        console.log(`📊 Progress: ${progress.currentPage}/${progress.totalPages} - ${progress.message}`);
      }
    );

    console.log('\n📊 Results Summary:');
    console.log('=' .repeat(80));
    console.log(`✅ Total articles found: ${results.length}`);
    
    let validThumbnails = 0;
    let validAuthors = 0;
    
    results.forEach((article, index) => {
      const hasValidThumbnail = !article.thumbnail.includes('via.placeholder');
      const hasValidAuthor = article.author !== 'Unknown' && article.author.length > 3;
      
      if (hasValidThumbnail) validThumbnails++;
      if (hasValidAuthor) validAuthors++;
      
      console.log(`\n${index + 1}. ${article.title.substring(0, 60)}...`);
      console.log(`   🔗 URL: ${article.path}`);
      console.log(`   🖼️  Thumbnail: ${article.thumbnail.substring(0, 80)}...`);
      console.log(`   👤 Author: ${article.author}`);
      console.log(`   ✅ Valid Thumbnail: ${hasValidThumbnail ? 'YES' : 'NO'}`);
      console.log(`   ✅ Valid Author: ${hasValidAuthor ? 'YES' : 'NO'}`);
    });

    const thumbnailSuccessRate = (validThumbnails / results.length) * 100;
    const authorSuccessRate = (validAuthors / results.length) * 100;
    
    console.log('\n' + '=' .repeat(80));
    console.log(`📈 Thumbnail Success Rate: ${validThumbnails}/${results.length} (${thumbnailSuccessRate.toFixed(1)}%)`);
    console.log(`📈 Author Success Rate: ${validAuthors}/${results.length} (${authorSuccessRate.toFixed(1)}%)`);
    
    if (thumbnailSuccessRate >= 80) {
      console.log('🎉 Thumbnail extraction is working well!');
    } else if (thumbnailSuccessRate >= 50) {
      console.log('⚠️  Thumbnail extraction is partially working.');
    } else {
      console.log('❌ Thumbnail extraction needs improvement.');
    }
    
    if (authorSuccessRate >= 80) {
      console.log('🎉 Author extraction is working well!');
    } else if (authorSuccessRate >= 50) {
      console.log('⚠️  Author extraction is partially working.');
    } else {
      console.log('❌ Author extraction needs improvement.');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testUpdatedMCPScraper();
