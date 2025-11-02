#!/usr/bin/env bun

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';
import { getSupabaseClient } from '../src/workers/supa';

async function testDatabaseSave() {
  console.log('🧪 Testing Database Save from EdgeProp Unified Scraper...\n');

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

  let capturedArticles: any[] = [];

  const onProgress = (progress: any) => {
    console.log(`[${progress.step}] ${progress.message}`);
    console.log(`   Status: ${progress.status}`);
    console.log(`   Page: ${progress.page}/${progress.totalPages}`);
    console.log(`   Articles: ${progress.articlesScraped} scraped, ${progress.articlesFailed} failed`);
    console.log(`   Discovered: ${progress.articlesDiscovered}`);
    console.log('');
  };

  try {
    console.log('🚀 Starting unified scraper with database save...\n');
    
    const result = await scrapeEdgePropUnified(
      1, // maxPages - just test 1 page
      onProgress,
      sessionId // Enable database save
    );

    if (result && result.length > 0) {
      capturedArticles = result;
      
      console.log('✅ Scraper completed successfully!\n');
      
      // Check what was saved to database
      console.log('🔍 Checking database records...\n');
      
      // Check scrape_sessions
      const { data: sessionCheck, error: sessionCheckError } = await supabase
        .from('scrape_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionCheckError) {
        console.error('❌ Failed to check session:', sessionCheckError.message);
      } else {
        console.log('📊 Session Record:');
        console.log(`   Status: ${sessionCheck.status}`);
        console.log(`   Pages Scraped: ${sessionCheck.pages_scraped}`);
        console.log(`   Articles Scraped: ${sessionCheck.articles_scraped}`);
        console.log(`   Unique Articles: ${sessionCheck.unique_articles}`);
        console.log(`   Duplicates Found: ${sessionCheck.duplicates_found}`);
        console.log('');
      }

      // Check scraped_articles
      const { data: articlesData, error: articlesError } = await supabase
        .from('scraped_articles')
        .select('*')
        .eq('source', 'EdgeProp')
        .order('first_scraped_at', { ascending: false })
        .limit(5);

      if (articlesError) {
        console.error('❌ Failed to check articles:', articlesError.message);
      } else {
        console.log(`📚 Article Records (Latest 5):`);
        console.log(`   Total found: ${articlesData.length}`);
        
        if (articlesData.length > 0) {
          const firstArticle = articlesData[0];
          console.log('\n📄 Sample Article Record:');
          console.log(`   ID: ${firstArticle.id}`);
          console.log(`   NID: ${firstArticle.nid}`);
          console.log(`   Title: ${firstArticle.title.substring(0, 60)}...`);
          console.log(`   Author: ${firstArticle.author || 'Not set'}`);
          console.log(`   Created: ${firstArticle.created || 'Not set'}`);
          console.log(`   Category: ${JSON.stringify(firstArticle.category)}`);
          console.log(`   Description: ${firstArticle.description ? firstArticle.description.substring(0, 80) + '...' : 'Not set'}`);
          console.log(`   Thumbnail: ${firstArticle.thumbnail ? 'Present' : 'Not set'}`);
          console.log(`   First Scraped: ${firstArticle.first_scraped_at}`);
          console.log('');
        }
      }

      // Check article_full_content
      const { data: contentData, error: contentError } = await supabase
        .from('article_full_content')
        .select('*')
        .order('scraped_at', { ascending: false })
        .limit(3);

      if (contentError) {
        console.error('❌ Failed to check content:', contentError.message);
      } else {
        console.log(`📝 Content Records (Latest 3):`);
        console.log(`   Total found: ${contentData.length}`);
        
        if (contentData.length > 0) {
          const firstContent = contentData[0];
          console.log('\n📖 Sample Content Record:');
          console.log(`   Article ID: ${firstContent.article_id}`);
          console.log(`   Text Content Length: ${firstContent.text_content?.length || 0} characters`);
          console.log(`   Word Count: ${firstContent.word_count || 0} words`);
          console.log(`   Reading Time: ${firstContent.reading_time_minutes || 0} minutes`);
          console.log(`   Paragraphs: ${firstContent.paragraphs?.length || 0} paragraphs`);
          console.log(`   Links: ${firstContent.links?.length || 0} links`);
          console.log(`   Scraped At: ${firstContent.scraped_at}`);
          console.log('');
        }
      }

      // Check scrape_session_articles junction table
      const { data: junctionData, error: junctionError } = await supabase
        .from('scrape_session_articles')
        .select('*, scraped_articles(*)')
        .eq('session_id', sessionId);

      if (junctionError) {
        console.error('❌ Failed to check junction table:', junctionError.message);
      } else {
        console.log(`🔗 Session-Article Links:`);
        console.log(`   Total links: ${junctionData.length}`);
        
        if (junctionData.length > 0) {
          console.log('\n📋 Linked Articles:');
          junctionData.forEach((link, index) => {
            const article = link.scraped_articles;
            console.log(`   ${index + 1}. ${article.title.substring(0, 50)}... (NID: ${article.nid})`);
          });
          console.log('');
        }
      }

      // Summary
      console.log('📈 Database Save Summary:');
      console.log('=' .repeat(50));
      console.log(`✅ Session created and updated`);
      console.log(`✅ ${articlesData.length} articles saved to scraped_articles`);
      console.log(`✅ ${contentData.length} content records saved to article_full_content`);
      console.log(`✅ ${junctionData.length} session-article links created`);
      
      const articlesWithContent = articlesData.filter(article => 
        contentData.some(content => content.article_id === article.id)
      ).length;
      
      console.log(`✅ ${articlesWithContent}/${articlesData.length} articles have full content`);
      console.log('');

    } else {
      console.log('❌ No articles captured');
    }

  } catch (err) {
    console.error('❌ Test failed:', err instanceof Error ? err.message : String(err));
  } finally {
    // Clean up - mark session as completed
    console.log('🧹 Cleaning up test session...');
    await supabase
      .from('scrape_sessions')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', sessionId);
    
    console.log('✅ Session marked as completed');
  }
}

// Run the test
testDatabaseSave().then(() => {
  console.log('🏁 Database save test completed');
}).catch(console.error);
