#!/usr/bin/env bun

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';

async function testImprovedScraper() {
  console.log('🚀 Testing Improved EdgeProp Unified Scraper...\n');
  console.log('✨ New Features:');
  console.log('  - Discovery Method Tracking (API/DOM)');
  console.log('  - Clean Category Extraction');
  console.log('  - Better Author Extraction\n');

  const onProgress = (progress: any) => {
    // Minimal progress output for cleaner results
  };

  try {
    const result = await scrapeEdgePropUnified(
      1, // maxPages
      onProgress,
      null // sessionId - no database save for this test
    );

    if (result && result.length > 0) {
      console.log('\n🎯 Improved Scraper Results:');
      console.log('=' .repeat(80));
      
      result.forEach((article, index) => {
        console.log(`\n${index + 1}. ${article.title.substring(0, 60)}...`);
        console.log(`   👤 Author: "${article.author}"`);
        console.log(`   🏷️  Category: ${Array.isArray(article.category) ? article.category.join(', ') : article.category}`);
        console.log(`   🔍 Discovery Method: ${article.discovery_method?.toUpperCase()}`);
        console.log(`   📅 Created: ${article.created}`);
        console.log(`   📊 Word Count: ${article.word_count} words`);
        console.log(`   ⏱️  Reading Time: ${article.reading_time_minutes} minutes`);
        console.log(`   🔗 Links: ${article.links?.length || 0} links found`);
        console.log(`   📝 Content: ${article.text_content?.length || 0} characters`);
      });
      
      console.log('\n📈 Summary:');
      console.log('=' .repeat(50));
      const apiCount = result.filter(a => a.discovery_method === 'api').length;
      const domCount = result.filter(a => a.discovery_method === 'dom').length;
      const unknownCount = result.filter(a => a.discovery_method === 'unknown').length;
      
      console.log(`Total Articles: ${result.length}`);
      console.log(`API Discovery: ${apiCount} articles`);
      console.log(`DOM Discovery: ${domCount} articles`);
      console.log(`Unknown Method: ${unknownCount} articles`);
      
      // Show category distribution
      const allCategories = result.flatMap(a => Array.isArray(a.category) ? a.category : [a.category]);
      const categoryCounts = allCategories.reduce((acc, cat) => {
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log('\n🏷️ Category Distribution:');
      Object.entries(categoryCounts).forEach(([category, count]) => {
        console.log(`  "${category}": ${count} article(s)`);
      });
      
    } else {
      console.log('❌ No articles found');
    }

  } catch (err) {
    console.error('❌ Test failed:', err instanceof Error ? err.message : String(err));
  }
}

testImprovedScraper();
