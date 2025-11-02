#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkScrapedArticles() {
  console.log('🔍 Checking scraped articles in database...');
  
  try {
    // Get recent articles
    const { data: articles, error } = await supabase
      .from('articles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('❌ Error fetching articles:', error);
      return;
    }

    if (!articles || articles.length === 0) {
      console.log('📭 No articles found in database');
      return;
    }

    console.log(`📊 Found ${articles.length} recent articles:`);
    console.log('='.repeat(60));

    articles.forEach((article, index) => {
      console.log(`\n📰 Article ${index + 1}:`);
      console.log(`📄 Title: ${article.title}`);
      console.log(`👤 Author: ${article.author}`);
      console.log(`🏷️ Category: ${article.category}`);
      console.log(`🔗 URL: ${article.url}`);
      console.log(`📊 Word Count: ${article.word_count || 'N/A'}`);
      console.log(`⏱️ Reading Time: ${article.reading_time_minutes || 'N/A'} minutes`);
      console.log(`📝 Content Length: ${article.text_content?.length || 0} characters`);
      console.log(`📅 Scraped: ${new Date(article.created_at).toLocaleString()}`);
      
      if (article.text_content) {
        console.log(`📝 Content Preview: ${article.text_content.substring(0, 200)}...`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkScrapedArticles();