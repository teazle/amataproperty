#!/usr/bin/env bun

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';
import { getSupabaseClient } from '../src/workers/supa';

async function testFixedDataExtraction() {
  console.log('🔧 Testing Fixed Data Extraction...\n');

  const supabase = getSupabaseClient();
  
  // Create a test session
  console.log('📝 Creating test scraping session...');
  const { data: sessionData, error: sessionError } = await supabase
    .from('scrape_sessions')
    .insert({
      source: 'EdgeProp',
      status: 'running',
      pages_scraped: 0,
      articles_scraped: 0,
      unique_articles: 0,
      duplicates_found: 0
    })
    .select()
    .single();

  if (sessionError) {
    console.error('❌ Failed to create session:', sessionError.message);
    return;
  }

  const sessionId = sessionData.id;
  console.log(`✅ Created session: ${sessionId}\n`);

  const onProgress = (progress: any) => {
    console.log(`[${progress.step}] ${progress.message}`);
  };

  try {
    const result = await scrapeEdgePropUnified(
      1, // maxPages
      onProgress,
      sessionId, // Pass session ID to enable database save
      3 // Limit to 3 articles for quick testing
    );

    if (result && result.length > 0) {
      console.log('\n✅ Fixed Data Extraction Test Completed Successfully!');
      console.log(`Total articles processed: ${result.length}`);

      // Check the articles in the database
      const { data: dbArticles, error: fetchArticlesError } = await supabase
        .from('scraped_articles')
        .select('nid, title, author, created, category, description, discovery_method')
        .order('first_scraped_at', { ascending: false })
        .limit(3);

      if (fetchArticlesError) {
        console.error('❌ Failed to fetch articles from DB:', fetchArticlesError.message);
      } else {
        console.log('\n📚 Fixed Articles in Database:');
        console.log('=' .repeat(80));
        dbArticles?.forEach((article, index) => {
          console.log(`\n${index + 1}. ${article.title?.substring(0, 60)}...`);
          console.log(`   👤 Author: "${article.author}"`);
          console.log(`   📅 Created: ${article.created?.substring(0, 60)}...`);
          console.log(`   🏷️  Categories: ${Array.isArray(article.category) ? article.category.join(', ') : article.category}`);
          console.log(`   📝 Description: ${article.description?.substring(0, 100)}...`);
          console.log(`   🔍 Discovery Method: ${article.discovery_method}`);
          console.log(`   🆔 NID: ${article.nid}`);
        });
      }

    } else {
      console.log('⚠️ No articles captured during test.');
    }
  } catch (err) {
    console.error('❌ Test failed:', err instanceof Error ? err.message : String(err));
  } finally {
    // Clean up the test session
    if (sessionId) {
      console.log(`\n🗑️ Cleaning up test session...`);
      await supabase.from('scrape_sessions').delete().eq('id', sessionId);
      console.log('✅ Test session cleaned up.');
    }
  }
}

testFixedDataExtraction();
