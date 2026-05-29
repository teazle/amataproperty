#!/usr/bin/env bun

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';

async function testAuthorExtraction() {
  console.log('🧪 Testing Author Extraction from EdgeProp Unified Scraper...\n');

  const onProgress = (progress: unknown) => {
    console.log(`[${progress.step}] ${progress.message}`);
    console.log(`   Status: ${progress.status}`);
    console.log(`   Page: ${progress.page}/${progress.totalPages}`);
    console.log(`   Articles: ${progress.articlesScraped} scraped, ${progress.articlesFailed} failed`);
    console.log(`   Discovered: ${progress.articlesDiscovered}`);
    console.log('');
  };

  try {
    const result = await scrapeEdgePropUnified(
      1, // maxPages
      onProgress,
      null // sessionId - no database save for this test
    );

    if (result && result.length > 0) {
      console.log('\n📊 Author Extraction Results:');
      console.log('=' .repeat(80));
      
      result.forEach((article, index) => {
        console.log(`\n${index + 1}. Article: ${article.title.substring(0, 60)}...`);
        console.log(`   NID: ${article.nid}`);
        console.log(`   Author: "${article.author}"`);
        console.log(`   Author Length: ${article.author.length} characters`);
        console.log(`   Created: ${article.created}`);
        console.log(`   Category: ${Array.isArray(article.category) ? article.category.join(', ') : article.category}`);
        console.log(`   Description: ${article.description?.substring(0, 100)}...`);
        console.log(`   Content Length: ${article.text_content.length} chars`);
        console.log(`   Word Count: ${article.word_count} words`);
        console.log(`   Reading Time: ${article.reading_time_minutes} minutes`);
      });
      
      console.log('\n📈 Author Analysis:');
      console.log('=' .repeat(50));
      
      const authors = result.map(a => a.author);
      const uniqueAuthors = [...new Set(authors)];
      const authorCounts = authors.reduce((acc, author) => {
        acc[author] = (acc[author] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log(`Total Articles: ${result.length}`);
      console.log(`Unique Authors: ${uniqueAuthors.length}`);
      console.log(`Author Distribution:`);
      Object.entries(authorCounts).forEach(([author, count]) => {
        console.log(`  "${author}": ${count} article(s)`);
      });
      
      // Check for potential issues
      const defaultAuthors = authors.filter(a => a === 'EdgeProp Staff' || a === 'Unknown');
      const longAuthors = authors.filter(a => a.length > 100);
      const shortAuthors = authors.filter(a => a.length < 3);
      
      console.log(`\n🔍 Quality Checks:`);
      console.log(`Default authors (EdgeProp Staff/Unknown): ${defaultAuthors.length}/${result.length}`);
      console.log(`Long authors (>100 chars): ${longAuthors.length}/${result.length}`);
      console.log(`Short authors (<3 chars): ${shortAuthors.length}/${result.length}`);
      
      if (longAuthors.length > 0) {
        console.log(`\n⚠️ Long authors found:`);
        longAuthors.forEach(author => {
          console.log(`  "${author.substring(0, 100)}..."`);
        });
      }
      
      if (shortAuthors.length > 0) {
        console.log(`\n⚠️ Short authors found:`);
        shortAuthors.forEach(author => {
          console.log(`  "${author}"`);
        });
      }
      
    } else {
      console.log('❌ No articles found');
    }

  } catch (err) {
    console.error('❌ Test failed:', err instanceof Error ? err.message : String(err));
  }
}

testAuthorExtraction();
