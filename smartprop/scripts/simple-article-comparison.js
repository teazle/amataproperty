const fs = require('fs');

async function simpleArticleComparison() {
    console.log('🧪 Simple article comparison test...');
    
    try {
        // Step 1: Use the MCP scraper to get one article
        console.log('🤖 Running MCP scraper to get first article...');
        
        // Import the scraper
        const { scrapeEdgePropMCP } = require('../src/lib/scraper/edgeprop-mcp-scraper.ts');
        
        const scrapedResult = await scrapeEdgePropMCP(1);
        
        if (!scrapedResult.articles || scrapedResult.articles.length === 0) {
            throw new Error('MCP scraper returned no articles');
        }

        const scrapedArticle = scrapedResult.articles[0];
        console.log('✅ MCP scraper found article:', scrapedArticle.title);
        console.log('🔗 Article URL:', scrapedArticle.url);
        
        // Step 2: Display the scraped data
        console.log('\n📊 SCRAPED ARTICLE DATA:');
        console.log('=' .repeat(60));
        console.log('Title:', scrapedArticle.title);
        console.log('Author:', scrapedArticle.author || 'Not extracted');
        console.log('Date:', scrapedArticle.publishDate || 'Not extracted');
        console.log('Category:', scrapedArticle.category || 'Not extracted');
        console.log('URL:', scrapedArticle.url);
        console.log('Content length:', scrapedArticle.content?.length || 0, 'characters');
        console.log('Images count:', scrapedArticle.images?.length || 0);
        
        if (scrapedArticle.content) {
            console.log('\nContent preview (first 200 chars):');
            console.log(scrapedArticle.content.substring(0, 200) + '...');
        }
        
        if (scrapedArticle.images && scrapedArticle.images.length > 0) {
            console.log('\nFirst image:', scrapedArticle.images[0]);
        }

        // Step 3: Save the scraped data for manual comparison
        const comparisonData = {
            timestamp: new Date().toISOString(),
            scraped: scrapedArticle,
            instructions: {
                step1: "Open a browser and navigate to: " + scrapedArticle.url,
                step2: "Compare the scraped data above with the actual article",
                step3: "Check if title, content, images, and metadata match",
                step4: "The scraped content should match the article content on the page"
            }
        };

        fs.writeFileSync(
            '/Users/vincent/propertydemo/smartprop/scripts/scraped-article-data.json',
            JSON.stringify(comparisonData, null, 2)
        );

        console.log('\n💾 Scraped data saved to scraped-article-data.json');
        console.log('\n🌐 MANUAL COMPARISON INSTRUCTIONS:');
        console.log('1. Open your browser and navigate to:', scrapedArticle.url);
        console.log('2. Compare the scraped data above with the actual article');
        console.log('3. Check if the title, content, images, and metadata match');
        console.log('4. The scraped content should match what you see on the page');
        
        return scrapedArticle;

    } catch (error) {
        console.error('❌ Error during comparison:', error.message);
        throw error;
    }
}

// Run the test
simpleArticleComparison().then(article => {
    console.log('\n✅ Test completed successfully!');
    console.log('📋 Article URL for manual verification:', article.url);
}).catch(console.error);