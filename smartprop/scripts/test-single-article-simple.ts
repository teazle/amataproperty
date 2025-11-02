#!/usr/bin/env bun

import { scrapeEdgePropUnified } from '../src/lib/scraper/edgeprop-unified-scraper';

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

async function testSingleArticle(): Promise<TestResult | null> {
    console.log('🚀 Testing single article scraping...\n');
    
    const onProgress = (progress: ProgressInfo) => {
        console.log(`📊 Progress: ${progress.message}`);
        console.log(`   Articles scraped: ${progress.articlesScraped}`);
        console.log(`   Articles failed: ${progress.articlesFailed}`);
    };

    try {
        // Scrape articles using the unified scraper
        const articles = await scrapeEdgePropUnified(
            1, // maxPages
            onProgress
        );
        
        if (!articles || articles.length === 0) {
            console.error('❌ No articles scraped');
            return null;
        }
        
        const article = articles[0];
        console.log('✅ Article scraped successfully!');
        console.log(`📰 Title: ${article.title}`);
        console.log(`👤 Author: ${article.author}`);
        console.log(`📅 Published: ${article.created}`);
        console.log(`📊 Content length: ${article.text_content?.length || 0} characters`);
        console.log(`📊 Word count: ${article.word_count || 0} words`);
        console.log(`🖼️  Images: ${article.images?.length || 0}`);
        console.log(`🔗 Links: ${article.links?.length || 0}`);
        console.log(`📄 Paragraphs: ${article.paragraphs?.length || 0}`);
        
        // Display some paragraphs
        if (article.paragraphs && article.paragraphs.length > 0) {
            console.log(`\n📝 First few paragraphs:`);
            article.paragraphs.slice(0, 3).forEach((para: string, i: number) => {
                console.log(`   ${i + 1}. ${para.substring(0, 100)}...`);
            });
        }

        // Generate URLs for comparison
        const originalUrl = `https://www.edgeprop.sg${article.path}`;
        const scrapedUrl = `http://localhost:3002/admin/articles/${article.nid}`;
        
        console.log('\n🔍 Comparison URLs:');
        console.log(`📰 Original: ${originalUrl}`);
        console.log(`💾 Scraped: ${scrapedUrl}`);
        console.log(`🔄 Compare: http://localhost:3002/admin/articles/${article.nid}/compare`);
        console.log(`📊 NID: ${article.nid}`);
        
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
testSingleArticle()
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