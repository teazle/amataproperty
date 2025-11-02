#!/usr/bin/env bun

/**
 * Test Single Article Scraping and Comparison
 * Scrapes one article, saves it to database, and creates comparison view
 */

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';
import * as db from '../src/lib/db/articles';
import { upsertArticleContent } from '../src/lib/db/article-content';

interface ProgressInfo {
    message: string;
    articlesScraped: number;
    articlesFailed: number;
}

interface TestResult {
    article: any;
    originalUrl: string;
    scrapedUrl: string;
}

async function testSingleArticleComparison(): Promise<TestResult | null> {
    console.log('🚀 Starting single article scraping test...\n');

    try {
        const articles = await scrapeEdgePropUnified(
            1, // maxPages
            (progress: ProgressInfo) => {
                console.log(`📊 Progress: ${progress.message}`);
                console.log(`   Articles scraped: ${progress.articlesScraped}`);
                console.log(`   Articles failed: ${progress.articlesFailed}`);
            }
        );

        if (!articles || articles.length === 0) {
            console.error('❌ No articles scraped');
            return null;
        }

        const article = articles[0];
        console.log('✅ Article scraped successfully!');
        console.log(`📰 Title: ${article.title}`);
        console.log(`🔗 Path: ${article.path}`);
        console.log(`📝 Content length: ${article.text_content?.length || 0} characters`);
        console.log(`📊 Word count: ${article.word_count}`);
        console.log(`📷 Images: ${article.images?.length || 0}`);
        console.log(`🔗 Links: ${article.links?.length || 0}`);
        console.log(`📄 Paragraphs: ${article.paragraphs?.length || 0}`);

        // Save the article to database
        const sessionId = await db.createScrapeSession();
        const savedResult = await db.upsertArticles([{
            nid: article.nid || '',
            title: article.title || '',
            path: article.path || '',
            thumbnail: article.thumbnail || '',
            author: article.author || '',
            created: article.created || '',
            category: Array.isArray(article.category) ? article.category.join(', ') : (article.category || ''),
            description: article.description || '',
            created_on: article.created_on || '',
            discovery_method: 'unified_scraper'
        }], sessionId);
        
        console.log('✅ Article saved to database');
        
        // Then save the full content with all required fields
        await upsertArticleContent({
            nid: article.nid || '',
            path: article.path || '',
            title: article.title || '',
            author: article.author || '',
            published_date: article.created || '',
            scraped_at: new Date(),
            html_content: article.html_content || '',
            text_content: article.text_content || '',
            paragraphs: article.paragraphs || [],
            images: article.images || [],
            links: article.links || [],
            main_image_url: article.main_image_url || '',
            main_image_caption: article.main_image_caption || '',
            tags: article.tags || [],
            word_count: article.word_count || 0,
            reading_time_minutes: article.reading_time_minutes || 0
        });
        console.log('✅ Article content saved to database');

        // Generate URLs for comparison
        const originalUrl = `https://www.edgeprop.sg${article.path}`;
        const scrapedUrl = `http://localhost:3002/admin/articles/${article.nid}`;
        
        console.log('\n🔍 Comparison URLs:');
        console.log(`📰 Original: ${originalUrl}`);
        console.log(`💾 Scraped: ${scrapedUrl}`);
        console.log(`🔄 Compare: http://localhost:3002/admin/articles/${article.nid}/compare`);
        
        return {
            article,
            originalUrl,
            scrapedUrl
        };

    } catch (error) {
        console.error('❌ Error during test:', error);
        return null;
    }
}

// Run the test
testSingleArticleComparison()
    .then((result) => {
        if (result) {
            console.log('\n✅ Test completed successfully!');
            console.log(`🔗 Original: ${result.originalUrl}`);
            console.log(`💾 Scraped: ${result.scrapedUrl}`);
        }
    })
    .catch((error) => {
        console.error('❌ Test failed:', error);
        process.exit(1);
    });