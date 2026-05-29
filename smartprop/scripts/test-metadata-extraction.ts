#!/usr/bin/env bun

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';

async function testMetadataExtraction() {
  console.log('🧪 Testing Metadata Extraction from EdgeProp Unified Scraper...\n');

  let capturedArticles: unknown[] = [];

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
      capturedArticles = result;
      
      console.log('✅ Metadata Extraction Test Results:\n');
      
      // Show detailed metadata for first article
      const firstArticle = capturedArticles[0];
      console.log('📊 First Article Metadata:');
      console.log('=' .repeat(50));
      console.log(`Title: ${firstArticle.title}`);
      console.log(`NID: ${firstArticle.nid}`);
      console.log(`Path: ${firstArticle.path}`);
      console.log(`Author: ${firstArticle.author || 'Not found'}`);
      console.log(`Created: ${firstArticle.created || 'Not found'}`);
      console.log(`Created On: ${firstArticle.created_on || 'Not found'}`);
      console.log(`Category: ${JSON.stringify(firstArticle.category) || 'Not found'}`);
      console.log(`Description: ${firstArticle.description ? firstArticle.description.substring(0, 100) + '...' : 'Not found'}`);
      console.log(`Keywords: ${JSON.stringify(firstArticle.keywords) || 'Not found'}`);
      console.log(`Thumbnail: ${firstArticle.thumbnail ? 'Present' : 'Not found'}`);
      console.log('');
      
      // Show content metadata
      console.log('📝 Content Metadata:');
      console.log('=' .repeat(50));
      console.log(`Text Content Length: ${firstArticle.text_content?.length || 0} characters`);
      console.log(`Word Count: ${firstArticle.word_count || 0} words`);
      console.log(`Reading Time: ${firstArticle.reading_time_minutes || 0} minutes`);
      console.log(`Paragraphs: ${firstArticle.paragraphs?.length || 0} paragraphs`);
      console.log(`Links: ${firstArticle.links?.length || 0} links`);
      console.log('');
      
      // Show sample content
      if (firstArticle.paragraphs && firstArticle.paragraphs.length > 0) {
        console.log('📖 Sample Content (First Paragraph):');
        console.log('=' .repeat(50));
        console.log(firstArticle.paragraphs[0].substring(0, 200) + '...');
        console.log('');
      }
      
      // Summary for all articles
      console.log('📈 Summary for All Articles:');
      console.log('=' .repeat(50));
      console.log(`Total Articles: ${capturedArticles.length}`);
      
      const articlesWithAuthor = capturedArticles.filter(a => a.author && a.author !== 'EdgeProp Staff').length;
      const articlesWithDate = capturedArticles.filter(a => a.created || a.created_on).length;
      const articlesWithCategory = capturedArticles.filter(a => a.category && a.category.length > 0).length;
      const articlesWithDescription = capturedArticles.filter(a => a.description && a.description.length > 10).length;
      
      console.log(`Articles with Author: ${articlesWithAuthor}/${capturedArticles.length} (${Math.round(articlesWithAuthor/capturedArticles.length*100)}%)`);
      console.log(`Articles with Date: ${articlesWithDate}/${capturedArticles.length} (${Math.round(articlesWithDate/capturedArticles.length*100)}%)`);
      console.log(`Articles with Category: ${articlesWithCategory}/${capturedArticles.length} (${Math.round(articlesWithCategory/capturedArticles.length*100)}%)`);
      console.log(`Articles with Description: ${articlesWithDescription}/${capturedArticles.length} (${Math.round(articlesWithDescription/capturedArticles.length*100)}%)`);
      
      const avgWordCount = Math.round(capturedArticles.reduce((sum, a) => sum + (a.word_count || 0), 0) / capturedArticles.length);
      const avgReadingTime = Math.round(capturedArticles.reduce((sum, a) => sum + (a.reading_time_minutes || 0), 0) / capturedArticles.length);
      
      console.log(`Average Word Count: ${avgWordCount} words`);
      console.log(`Average Reading Time: ${avgReadingTime} minutes`);
      console.log('');
      
      // Check database requirements
      console.log('🗄️ Database Requirements Check:');
      console.log('=' .repeat(50));
      
      const requiredFields = [
        'nid', 'title', 'path', 'author', 'created', 'category', 
        'description', 'created_on', 'keywords', 'thumbnail'
      ];
      
      const contentFields = [
        'text_content', 'paragraphs', 'links', 'word_count', 
        'reading_time_minutes'
      ];
      
      console.log('Required Article Fields:');
      requiredFields.forEach(field => {
        const hasField = capturedArticles.every(a => a[field] !== undefined && a[field] !== null);
        console.log(`  ${field}: ${hasField ? '✅' : '❌'} ${hasField ? 'Present' : 'Missing'}`);
      });
      
      console.log('\nRequired Content Fields:');
      contentFields.forEach(field => {
        const hasField = capturedArticles.every(a => a[field] !== undefined && a[field] !== null);
        console.log(`  ${field}: ${hasField ? '✅' : '❌'} ${hasField ? 'Present' : 'Missing'}`);
      });
      
    } else {
      console.log('❌ No articles captured');
    }

  } catch (err) {
    console.error('❌ Test failed:', err instanceof Error ? err.message : String(err));
  }
}

// Run the test
testMetadataExtraction().then(() => {
  console.log('🏁 Metadata extraction test completed');
}).catch(console.error);
