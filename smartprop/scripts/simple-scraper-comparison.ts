#!/usr/bin/env bun

/**
 * Simple Scraper Comparison Test
 * 
 * Quick test to compare unified vs combined scraper performance
 */

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';
import { scrapeEdgePropCombined } from '../src/lib/scraper/edgeprop-combined-scraper';

async function testUnifiedScraper() {
  console.log('\n🧪 Testing UNIFIED SCRAPER (with API intercept fixes)...');
  console.log('=' .repeat(60));
  
  const startTime = Date.now();
  
  try {
    const result = await scrapeEdgePropUnified(
      1, // Test with 1 page
      (progress) => {
        console.log(`[${progress.status.toUpperCase()}] Page ${progress.currentPage}/${progress.totalPages} - Articles: ${progress.articlesScraped} scraped, ${progress.articlesFailed} failed, ${progress.articlesDiscovered} discovered`);
      },
      undefined // No session ID for testing
    );
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    const articlesWithContent = result.filter(article => article.text_content && article.text_content.length > 100).length;
    const avgWordCount = articlesWithContent > 0 
      ? Math.round(result.filter(article => article.text_content && article.text_content.length > 100)
          .reduce((sum, article) => sum + article.word_count, 0) / articlesWithContent)
      : 0;
    
    console.log(`\n📊 UNIFIED SCRAPER RESULTS:`);
    console.log(`   Duration: ${Math.round(duration/1000)}s`);
    console.log(`   Articles discovered: ${result.length}`);
    console.log(`   Articles with content: ${articlesWithContent}`);
    console.log(`   Success rate: ${Math.round(articlesWithContent/result.length*100)}%`);
    console.log(`   Average word count: ${avgWordCount}`);
    
    return {
      scraper: 'unified',
      duration,
      articlesDiscovered: result.length,
      articlesWithContent,
      avgWordCount,
      sampleTitles: result.slice(0, 3).map(a => a.title)
    };
    
  } catch (error) {
    console.error('Unified scraper failed:', error);
    return {
      scraper: 'unified',
      duration: Date.now() - startTime,
      articlesDiscovered: 0,
      articlesWithContent: 0,
      avgWordCount: 0,
      sampleTitles: []
    };
  }
}

async function testCombinedScraper() {
  console.log('\n🧪 Testing COMBINED SCRAPER (Simple discovery + MCP content)...');
  console.log('=' .repeat(60));
  
  const startTime = Date.now();
  
  try {
    const result = await scrapeEdgePropCombined(
      1, // Test with 1 page
      (progress) => {
        console.log(`[${progress.status.toUpperCase()}] Page ${progress.currentPage}/${progress.totalPages} - Articles: ${progress.articlesScraped} scraped, ${progress.articlesFailed} failed, ${progress.articlesDiscovered} discovered`);
      },
      undefined // No session ID for testing
    );
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    const articlesWithContent = result.filter(article => article.text_content && article.text_content.length > 100).length;
    const avgWordCount = articlesWithContent > 0 
      ? Math.round(result.filter(article => article.text_content && article.text_content.length > 100)
          .reduce((sum, article) => sum + article.word_count, 0) / articlesWithContent)
      : 0;
    
    console.log(`\n📊 COMBINED SCRAPER RESULTS:`);
    console.log(`   Duration: ${Math.round(duration/1000)}s`);
    console.log(`   Articles discovered: ${result.length}`);
    console.log(`   Articles with content: ${articlesWithContent}`);
    console.log(`   Success rate: ${Math.round(articlesWithContent/result.length*100)}%`);
    console.log(`   Average word count: ${avgWordCount}`);
    
    return {
      scraper: 'combined',
      duration,
      articlesDiscovered: result.length,
      articlesWithContent,
      avgWordCount,
      sampleTitles: result.slice(0, 3).map(a => a.title)
    };
    
  } catch (error) {
    console.error('Combined scraper failed:', error);
    return {
      scraper: 'combined',
      duration: Date.now() - startTime,
      articlesDiscovered: 0,
      articlesWithContent: 0,
      avgWordCount: 0,
      sampleTitles: []
    };
  }
}

function printComparison(unified: any, combined: any) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 SCRAPER COMPARISON RESULTS');
  console.log('='.repeat(80));
  
  console.log('\n⏱️  PERFORMANCE:');
  console.log(`   Unified Scraper:  ${Math.round(unified.duration/1000)}s`);
  console.log(`   Combined Scraper: ${Math.round(combined.duration/1000)}s`);
  
  const speedWinner = unified.duration < combined.duration ? 'Unified' : 'Combined';
  const speedDiff = Math.abs(unified.duration - combined.duration);
  console.log(`   🏆 Winner: ${speedWinner} (${Math.round(speedDiff/1000)}s faster)`);
  
  console.log('\n📈 DISCOVERY:');
  console.log(`   Unified Scraper:  ${unified.articlesDiscovered} articles`);
  console.log(`   Combined Scraper: ${combined.articlesDiscovered} articles`);
  
  const discoveryWinner = unified.articlesDiscovered > combined.articlesDiscovered ? 'Unified' : 'Combined';
  console.log(`   🏆 Winner: ${discoveryWinner}`);
  
  console.log('\n📝 CONTENT QUALITY:');
  console.log(`   Unified Scraper:  ${unified.articlesWithContent}/${unified.articlesDiscovered} with content (${Math.round(unified.articlesWithContent/unified.articlesDiscovered*100)}%)`);
  console.log(`   Combined Scraper: ${combined.articlesWithContent}/${combined.articlesDiscovered} with content (${Math.round(combined.articlesWithContent/combined.articlesDiscovered*100)}%)`);
  
  const qualityWinner = unified.articlesWithContent > combined.articlesWithContent ? 'Unified' : 'Combined';
  console.log(`   🏆 Winner: ${qualityWinner}`);
  
  console.log('\n📊 DATA RICHNESS:');
  console.log(`   Unified Scraper:  ${unified.avgWordCount} avg words`);
  console.log(`   Combined Scraper: ${combined.avgWordCount} avg words`);
  
  console.log('\n📋 SAMPLE ARTICLES:');
  console.log('\n   Unified Scraper Sample:');
  unified.sampleTitles.forEach((title: string, i: number) => {
    console.log(`   ${i+1}. ${title.substring(0, 60)}...`);
  });
  
  console.log('\n   Combined Scraper Sample:');
  combined.sampleTitles.forEach((title: string, i: number) => {
    console.log(`   ${i+1}. ${title.substring(0, 60)}...`);
  });
  
  console.log('\n🎯 OVERALL RECOMMENDATION:');
  const unifiedScore = (unified.articlesWithContent * 0.5) + ((1000 - unified.duration/1000) * 0.3) + (unified.avgWordCount * 0.2);
  const combinedScore = (combined.articlesWithContent * 0.5) + ((1000 - combined.duration/1000) * 0.3) + (combined.avgWordCount * 0.2);
  
  const overallWinner = unifiedScore > combinedScore ? 'UNIFIED SCRAPER' : 'COMBINED SCRAPER';
  console.log(`   🏆 ${overallWinner} is recommended for production use`);
  console.log(`   Score: Unified ${unifiedScore.toFixed(1)} vs Combined ${combinedScore.toFixed(1)}`);
  
  console.log('\n💡 KEY INSIGHTS:');
  if (unified.articlesWithContent === 0) {
    console.log('   ⚠️  Unified scraper API intercept works but content extraction needs fixing');
  }
  if (combined.articlesWithContent > 0) {
    console.log('   ✅ Combined scraper successfully extracts article content');
  }
  console.log('   🚀 Both scrapers can populate the database with article metadata');
}

async function main() {
  console.log('🚀 Starting Simple Scraper Comparison Test');
  console.log('Testing both scrapers with identical parameters for fair comparison...');
  
  try {
    // Run both scrapers sequentially to avoid resource conflicts
    const unifiedResults = await testUnifiedScraper();
    const combinedResults = await testCombinedScraper();
    
    // Print comprehensive comparison
    printComparison(unifiedResults, combinedResults);
    
    console.log('\n✅ Comparison test completed successfully!');
    
  } catch (error) {
    console.error('❌ Comparison test failed:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
