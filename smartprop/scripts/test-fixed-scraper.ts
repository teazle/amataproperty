#!/usr/bin/env bun

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';
import { getSupabaseClient } from '../src/workers/supa';

async function testFixedScraper() {
  console.log('🔧 Testing Fixed Scraper with Database Save...\n');

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
      sessionId // Pass session ID to enable database save
    );

    if (result && result.length > 0) {
      console.log('\n✅ Fixed Scraper Test Completed Successfully!');
      console.log(`Total articles processed: ${result.length}`);
      console.log(`Session ID: ${sessionId}`);

      // Check the articles in the database
      const { data: dbArticles, error: fetchArticlesError } = await supabase
        .from('scraped_articles')
        .select('nid, title, author, discovery_method, category, created')
        .order('first_scraped_at', { ascending: false })
        .limit(5);

      if (fetchArticlesError) {
        console.error('❌ Failed to fetch articles from DB:', fetchArticlesError.message);
      } else {
        console.log('\n📚 Latest Articles in Database:');
        console.log('=' .repeat(80));
        dbArticles?.forEach((article, index) => {
          console.log(`\n${index + 1}. ${article.title?.substring(0, 60)}...`);
          console.log(`   👤 Author: "${article.author?.substring(0, 50)}..."`);
          console.log(`   🔍 Discovery Method: ${article.discovery_method}`);
          console.log(`   🏷️  Category: ${Array.isArray(article.category) ? article.category.slice(0, 2).join(', ') : article.category}`);
          console.log(`   📅 Created: ${article.created?.substring(0, 50)}...`);
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

testFixedScraper();
