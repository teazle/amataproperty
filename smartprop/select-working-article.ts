#!/usr/bin/env bun
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testArticleExists(url: string): Promise<boolean> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    
    const pageTitle = await page.title();
    const h1Text = await page.$eval('h1', el => el.textContent?.trim()).catch(() => '');
    
    // Check if it's a real article (not the generic Property News page)
    const isRealArticle = !pageTitle.includes('Singapore Property News - Latest') && 
                         h1Text !== 'Property News' && 
                         h1Text.length > 10;
    
    console.log(`🔍 Testing: ${url}`);
    console.log(`   Title: "${pageTitle}"`);
    console.log(`   H1: "${h1Text}"`);
    console.log(`   Status: ${response?.status()}`);
    console.log(`   Is Real Article: ${isRealArticle ? '✅' : '❌'}`);
    console.log('');
    
    return isRealArticle;
  } catch (error) {
    console.log(`❌ Failed to test ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

async function findWorkingArticle() {
  console.log('🔍 Finding Working EdgeProp Article');
  console.log('='.repeat(60));
  
  // Get recent EdgeProp articles
  const { data: articles, error } = await supabase
    .from('scraped_articles')
    .select('nid, title, path, author, created, description, thumbnail')
    .eq('source', 'EdgeProp')
    .not('description', 'is', null)
    .gte('description', '')
    .order('first_scraped_at', { ascending: false })
    .limit(10);
  
  if (error) {
    console.error('❌ Database error:', error);
    return;
  }
  
  if (!articles || articles.length === 0) {
    console.log('❌ No EdgeProp articles found');
    return;
  }
  
  console.log(`📊 Found ${articles.length} articles to test`);
  console.log('');
  
  for (const article of articles) {
    const url = `https://www.edgeprop.sg/${article.path}`;
    const exists = await testArticleExists(url);
    
    if (exists) {
      console.log('🎉 Found working article!');
      console.log('='.repeat(60));
      console.log(`📰 Title: ${article.title}`);
      console.log(`🔗 URL: ${url}`);
      console.log(`👤 Author: ${article.author}`);
      console.log(`📅 Created: ${article.created}`);
      console.log(`🆔 NID: ${article.nid}`);
      console.log(`📝 Description: ${article.description?.substring(0, 200)}...`);
      console.log('='.repeat(60));
      
      // Save this as our test article
      const testArticle = {
        title: article.title,
        url: url,
        nid: article.nid,
        path: article.path,
        author: article.author,
        created: article.created,
        description: article.description
      };
      
      writeFileSync('working-test-article.json', JSON.stringify(testArticle, null, 2));
      console.log('💾 Saved working article details to working-test-article.json');
      
      return testArticle;
    }
  }
  
  console.log('❌ No working articles found in the test set');
}

findWorkingArticle().catch(console.error);