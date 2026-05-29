#!/usr/bin/env bun

/**
 * Comprehensive Scraper Comparison Test
 * 
 * Tests both the unified scraper (with API intercept fixes) and the combined scraper
 * to compare:
 * 1. Speed/Performance
 * 2. Data quality and completeness
 * 3. Database population effectiveness
 * 4. Article discovery accuracy
 */

import { scrapeEdgePropCombined } from '../src/lib/scraper/edgeprop-combined-scraper';
import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';
import { getSupabaseClient } from '../src/workers/supa';

interface ComparisonResults {
  scraper: 'unified' | 'combined';
  startTime: number;
  endTime: number;
  duration: number;
  articlesDiscovered: number;
  articlesWithContent: number;
  articlesFailed: number;
  averageWordCount: number;
  averageReadingTime: number;
  uniqueAuthors: number;
  categories: string[];
  databaseInserts: number;
  databaseErrors: number;
  sampleArticles: Array<{
    title: string;
    wordCount: number;
    author: string;
    hasContent: boolean;
  }>;
}

async function runUnifiedScraper(): Promise<ComparisonResults> {
  console.log('\n🧪 Testing UNIFIED SCRAPER (with API intercept fixes)...');
  console.log('=' .repeat(60));
  
  const startTime = Date.now();
  let articlesDiscovered = 0;
  let articlesWithContent = 0;
  let articlesFailed = 0;
  let databaseInserts = 0;
  let databaseErrors = 0;
  const avgWordCount = 0;
  const avgReadingTime = 0;
  const uniqueAuthors = 0;
  const categories: string[] = [];
  const sampleArticles: Array<{title: string; wordCount: number; author: string; hasContent: boolean}> = [];
  
  const supabase = getSupabaseClient();
  
  try {
    const result = await scrapeEdgePropUnified(
      1, // Test with 1 page
      (progress) => {
        console.log(`[${progress.status.toUpperCase()}] Page ${progress.currentPage}/${progress.totalPages} - Articles: ${progress.articlesScraped} scraped, ${progress.articlesFailed} failed, ${progress.articlesDiscovered} discovered`);
      },
      undefined // No session ID for testing
    );
    
    articlesDiscovered = result.length;
    articlesWithContent = result.filter(article => article.text_content && article.text_content.length > 100).length;
    articlesFailed = result.length - articlesWithContent;
    
    // Calculate averages
    const validArticles = result.filter(article => article.text_content && article.text_content.length > 100);
    const _avgWordCount = validArticles.length > 0
      ? Math.round(validArticles.reduce((sum, article) => sum + article.word_count, 0) / validArticles.length)
      : 0;
    const _avgReadingTime = validArticles.length > 0
      ? Math.round(validArticles.reduce((sum, article) => sum + article.reading_time_minutes, 0) / validArticles.length)
      : 0;
    
    // Get unique authors and categories
    const _uniqueAuthors = new Set(result.map(article => article.author)).size;
    const allCategories = result.flatMap(article => Array.isArray(article.category) ? article.category : [article.category]);
    const _categories = Array.from(new Set(allCategories));
    
    // Sample articles
    result.slice(0, 5).forEach(article => {
      sampleArticles.push({
        title: article.title,
        wordCount: article.word_count,
        author: article.author,
        hasContent: article.text_content && article.text_content.length > 100
      });
    });
    
    // Test database insertion
    console.log('\n📊 Testing database insertion for unified scraper...');
    for (const article of result.slice(0, 3)) { // Test with first 3 articles
      try {
        const { error } = await supabase
          .from('scraped_articles')
          .insert({
            source: 'edgeprop-unified',
            nid: article.nid,
            title: article.title,
            url: `https://www.edgeprop.sg/${article.path}`,
            author: article.author,
            published_date: article.created,
            category: Array.isArray(article.category) ? article.category.join(', ') : article.category,
            description: article.description,
            content: article.text_content,
            word_count: article.word_count,
            reading_time_minutes: article.reading_time_minutes,
            scraped_at: new Date().toISOString()
          });
        
        if (error) {
          console.error(`Database error for ${article.title}:`, error.message);
          databaseErrors++;
        } else {
          databaseInserts++;
        }
      } catch (err) {
        console.error(`Database insertion failed for ${article.title}:`, err);
        databaseErrors++;
      }
    }
    
  } catch (error) {
    console.error('Unified scraper failed:', error);
    articlesFailed = 1;
  }
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  return {
    scraper: 'unified',
    startTime,
    endTime,
    duration,
    articlesDiscovered,
    articlesWithContent,
    articlesFailed,
    avgWordCount,
    avgReadingTime,
    uniqueAuthors,
    categories,
    databaseInserts,
    databaseErrors,
    sampleArticles
  };
}

async function runCombinedScraper(): Promise<ComparisonResults> {
  console.log('\n🧪 Testing COMBINED SCRAPER (Simple discovery + MCP content)...');
  console.log('=' .repeat(60));
  
  const startTime = Date.now();
  let articlesDiscovered = 0;
  let articlesWithContent = 0;
  let articlesFailed = 0;
  let databaseInserts = 0;
  let databaseErrors = 0;
  const sampleArticles: Array<{title: string; wordCount: number; author: string; hasContent: boolean}> = [];
  
  const supabase = getSupabaseClient();
  
  try {
    const result = await scrapeEdgePropCombined(
      1, // Test with 1 page
      (progress) => {
        console.log(`[${progress.status.toUpperCase()}] Page ${progress.currentPage}/${progress.totalPages} - Articles: ${progress.articlesScraped} scraped, ${progress.articlesFailed} failed, ${progress.articlesDiscovered} discovered`);
      },
      undefined // No session ID for testing
    );
    
    articlesDiscovered = result.length;
    articlesWithContent = result.filter(article => article.text_content && article.text_content.length > 100).length;
    articlesFailed = result.length - articlesWithContent;
    
    // Calculate averages
    const validArticles = result.filter(article => article.text_content && article.text_content.length > 100);
    const _avgWordCount = validArticles.length > 0
      ? Math.round(validArticles.reduce((sum, article) => sum + article.word_count, 0) / validArticles.length)
      : 0;
    const _avgReadingTime = validArticles.length > 0
      ? Math.round(validArticles.reduce((sum, article) => sum + article.reading_time_minutes, 0) / validArticles.length)
      : 0;
    
    // Get unique authors and categories
    const _uniqueAuthors = new Set(result.map(article => article.author)).size;
    const allCategories = result.flatMap(article => Array.isArray(article.category) ? article.category : [article.category]);
    const _categories = Array.from(new Set(allCategories));
    
    // Sample articles
    result.slice(0, 5).forEach(article => {
      sampleArticles.push({
        title: article.title,
        wordCount: article.word_count,
        author: article.author,
        hasContent: article.text_content && article.text_content.length > 100
      });
    });
    
    // Test database insertion
    console.log('\n📊 Testing database insertion for combined scraper...');
    for (const article of result.slice(0, 3)) { // Test with first 3 articles
      try {
        const { error } = await supabase
          .from('scraped_articles')
          .insert({
            source: 'edgeprop-combined',
            nid: article.nid,
            title: article.title,
            url: `https://www.edgeprop.sg/${article.path}`,
            author: article.author,
            published_date: article.created,
            category: Array.isArray(article.category) ? article.category.join(', ') : article.category,
            description: article.description,
            content: article.text_content,
            word_count: article.word_count,
            reading_time_minutes: article.reading_time_minutes,
            scraped_at: new Date().toISOString()
          });
        
        if (error) {
          console.error(`Database error for ${article.title}:`, error.message);
          databaseErrors++;
        } else {
          databaseInserts++;
        }
      } catch (err) {
        console.error(`Database insertion failed for ${article.title}:`, err);
        databaseErrors++;
      }
    }
    
  } catch (error) {
    console.error('Combined scraper failed:', error);
    articlesFailed = 1;
  }
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  return {
    scraper: 'combined',
    startTime,
    endTime,
    duration,
    articlesDiscovered,
    articlesWithContent,
    articlesFailed,
    avgWordCount,
    avgReadingTime,
    uniqueAuthors,
    categories,
    databaseInserts,
    databaseErrors,
    sampleArticles
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function printComparison(unified: ComparisonResults, combined: ComparisonResults) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 SCRAPER COMPARISON RESULTS');
  console.log('='.repeat(80));
  
  console.log('\n⏱️  PERFORMANCE COMPARISON:');
  console.log(`   Unified Scraper:  ${formatDuration(unified.duration)}`);
  console.log(`   Combined Scraper: ${formatDuration(combined.duration)}`);
  
  const speedWinner = unified.duration < combined.duration ? 'Unified' : 'Combined';
  const speedDiff = Math.abs(unified.duration - combined.duration);
  console.log(`   🏆 Winner: ${speedWinner} (${formatDuration(speedDiff)} faster)`);
  
  console.log('\n📈 DISCOVERY COMPARISON:');
  console.log(`   Unified Scraper:  ${unified.articlesDiscovered} articles discovered`);
  console.log(`   Combined Scraper: ${combined.articlesDiscovered} articles discovered`);
  
  const discoveryWinner = unified.articlesDiscovered > combined.articlesDiscovered ? 'Unified' : 'Combined';
  console.log(`   🏆 Winner: ${discoveryWinner}`);
  
  console.log('\n📝 CONTENT QUALITY COMPARISON:');
  console.log(`   Unified Scraper:  ${unified.articlesWithContent}/${unified.articlesDiscovered} with content (${Math.round(unified.articlesWithContent/unified.articlesDiscovered*100)}%)`);
  console.log(`   Combined Scraper: ${combined.articlesWithContent}/${combined.articlesDiscovered} with content (${Math.round(combined.articlesWithContent/combined.articlesDiscovered*100)}%)`);
  
  const qualityWinner = unified.articlesWithContent > combined.articlesWithContent ? 'Unified' : 'Combined';
  console.log(`   🏆 Winner: ${qualityWinner}`);
  
  console.log('\n📊 DATA RICHNESS COMPARISON:');
  console.log(`   Unified Scraper:  ${unified.averageWordCount} avg words, ${unified.averageReadingTime} min read, ${unified.uniqueAuthors} authors`);
  console.log(`   Combined Scraper: ${combined.averageWordCount} avg words, ${combined.averageReadingTime} min read, ${combined.uniqueAuthors} authors`);
  
  console.log('\n💾 DATABASE COMPARISON:');
  console.log(`   Unified Scraper:  ${unified.databaseInserts} inserts, ${unified.databaseErrors} errors`);
  console.log(`   Combined Scraper: ${combined.databaseInserts} inserts, ${combined.databaseErrors} errors`);
  
  const dbWinner = unified.databaseInserts > combined.databaseInserts ? 'Unified' : 'Combined';
  console.log(`   🏆 Winner: ${dbWinner}`);
  
  console.log('\n📋 SAMPLE ARTICLES:');
  console.log('\n   Unified Scraper Sample:');
  unified.sampleArticles.forEach((article, i) => {
    console.log(`   ${i+1}. ${article.title.substring(0, 60)}... (${article.wordCount} words, ${article.author}) ${article.hasContent ? '✅' : '❌'}`);
  });
  
  console.log('\n   Combined Scraper Sample:');
  combined.sampleArticles.forEach((article, i) => {
    console.log(`   ${i+1}. ${article.title.substring(0, 60)}... (${article.wordCount} words, ${article.author}) ${article.hasContent ? '✅' : '❌'}`);
  });
  
  console.log('\n🎯 OVERALL RECOMMENDATION:');
  const unifiedScore = (unified.articlesWithContent * 0.4) + ((1000 - unified.duration/1000) * 0.3) + (unified.databaseInserts * 0.3);
  const combinedScore = (combined.articlesWithContent * 0.4) + ((1000 - combined.duration/1000) * 0.3) + (combined.databaseInserts * 0.3);
  
  const overallWinner = unifiedScore > combinedScore ? 'UNIFIED SCRAPER' : 'COMBINED SCRAPER';
  console.log(`   🏆 ${overallWinner} is recommended for production use`);
  console.log(`   Score: Unified ${unifiedScore.toFixed(1)} vs Combined ${combinedScore.toFixed(1)}`);
}

async function main() {
  console.log('🚀 Starting Comprehensive Scraper Comparison Test');
  console.log('Testing both scrapers with identical parameters for fair comparison...');
  
  try {
    // Run both scrapers
    const [unifiedResults, combinedResults] = await Promise.all([
      runUnifiedScraper(),
      runCombinedScraper()
    ]);
    
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
