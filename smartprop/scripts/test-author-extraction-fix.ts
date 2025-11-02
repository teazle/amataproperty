#!/usr/bin/env bun

import { scrapeEdgePropMCP } from '../src/lib/scraper/edgeprop-mcp-scraper';

async function testAuthorExtractionFix() {
  console.log('🧪 Testing author extraction fix...\n');

  try {
    const results = await scrapeEdgePropMCP(
      1, // maxPages
      (progress) => {
        console.log(`📊 Progress: ${progress.currentPage}/${progress.totalPages} - ${progress.message}`);
      }
    );

    console.log('\n📊 Author Extraction Results:');
    console.log('=' .repeat(80));
    
    let validAuthors = 0;
    let invalidAuthors = 0;
    
    results.forEach((article, index) => {
      const hasValidAuthor = article.author !== 'EdgeProp Staff' && 
                            article.author !== 'Unknown' && 
                            article.author.length > 3 && 
                            article.author.length < 50 &&
                            !article.author.includes('amenities') &&
                            !article.author.includes('Market Watch') &&
                            !article.author.includes('Premium Tools');
      
      if (hasValidAuthor) validAuthors++;
      else invalidAuthors++;
      
      console.log(`\n${index + 1}. ${article.title.substring(0, 60)}...`);
      console.log(`   👤 Author: "${article.author}"`);
      console.log(`   📝 Description: "${article.description.substring(0, 100)}..."`);
      console.log(`   ✅ Valid Author: ${hasValidAuthor ? 'YES' : 'NO'}`);
      
      if (!hasValidAuthor) {
        console.log(`   ❌ Issue: Author contains unwanted text`);
      }
    });

    const authorSuccessRate = (validAuthors / results.length) * 100;
    
    console.log('\n' + '=' .repeat(80));
    console.log(`📈 Author Success Rate: ${validAuthors}/${results.length} (${authorSuccessRate.toFixed(1)}%)`);
    console.log(`❌ Invalid Authors: ${invalidAuthors}`);
    
    if (authorSuccessRate >= 80) {
      console.log('🎉 Author extraction is working well!');
    } else if (authorSuccessRate >= 50) {
      console.log('⚠️  Author extraction is partially working.');
    } else {
      console.log('❌ Author extraction still needs improvement.');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testAuthorExtractionFix();
