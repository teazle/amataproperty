#!/usr/bin/env bun

import { createClient } from '@supabase/supabase-js';

// Load environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.log('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✅ Set' : '❌ Missing');
  console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing');
  console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function selectTestArticle() {
  console.log('🔍 Selecting representative EdgeProp article for testing...\n');

  try {
    // Query for EdgeProp articles with substantial content
    const { data: articles, error } = await supabase
      .from('scraped_articles')
      .select(`
        nid,
        title,
        path,
        author,
        created,
        category,
        description,
        thumbnail,
        source,
        first_scraped_at
      `)
      .eq('source', 'EdgeProp')
      .not('description', 'is', null)
      .gte('description', 100) // Description length >= 100 chars
      .order('first_scraped_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('❌ Database query error:', error);
      return;
    }

    if (!articles || articles.length === 0) {
      console.log('❌ No EdgeProp articles found');
      return;
    }

    console.log(`✅ Found ${articles.length} representative EdgeProp articles:\n`);

    articles.forEach((article, index) => {
      console.log(`${index + 1}. ${article.title}`);
      console.log(`   📰 NID: ${article.nid}`);
      console.log(`   🔗 Path: ${article.path}`);
      console.log(`   👤 Author: ${article.author || 'N/A'}`);
      console.log(`   📅 Created: ${article.created}`);
      console.log(`   🏷️  Category: ${article.category || 'N/A'}`);
      console.log(`   📝 Description: ${article.description?.substring(0, 100)}...`);
      console.log(`   🖼️  Thumbnail: ${article.thumbnail ? '✅ Available' : '❌ None'}`);
      console.log(`   ⏰ First Scraped: ${article.first_scraped_at}\n`);
    });

    // Select the most recent article with good content
    const selectedArticle = articles[0];
    console.log(`🎯 Selected article for testing: "${selectedArticle.title}"`);
    console.log(`📋 Test URL: https://www.edgeprop.sg${selectedArticle.path}`);
    
    return selectedArticle;

  } catch (err) {
    console.error('❌ Error selecting test article:', err);
  }
}

// Run the selection
selectTestArticle().then((article) => {
  if (article) {
    console.log('\n✅ Article selection complete!');
    console.log('🚀 Ready to proceed with MCP scraper validation test');
  }
});