import { scrapeEdgePropMCP } from '../src/lib/scraper/edgeprop-mcp-scraper';

async function testFixedMCPScraper() {
  console.log('🧪 Testing Fixed MCP Scraper...');
  console.log('=' .repeat(50));
  
  try {
    const articles = await scrapeEdgePropMCP(1, (progress) => {
      console.log(`📊 Progress: ${progress.message}`);
      console.log(`   📄 Page: ${progress.currentPage}/${progress.totalPages}`);
      console.log(`   📰 Articles: ${progress.articlesDiscovered} discovered, ${progress.articlesScraped} scraped`);
      console.log(`   ❌ Failed: ${progress.articlesFailed}`);
      console.log(`   🔄 Status: ${progress.status}`);
      console.log('---');
    });

    console.log('\n🎉 SCRAPER COMPLETED!');
    console.log('=' .repeat(50));
    
    if (articles.length > 0) {
      console.log(`✅ SUCCESS: Found ${articles.length} articles`);
      console.log('\n📋 SAMPLE ARTICLES:');
      console.log('-'.repeat(30));
      
      articles.slice(0, 3).forEach((article, index) => {
        console.log(`${index + 1}. ${article.title}`);
        console.log(`   👤 Author: ${article.author}`);
        console.log(`   🖼️  Thumbnail: ${article.thumbnail}`);
        console.log(`   🆔 NID: ${article.nid}`);
        console.log(`   📝 Content length: ${article.text_content?.length || 0} chars`);
        console.log(`   🔗 Path: ${article.path}`);
        console.log('');
      });
      
      // Check for improvements
      const realAuthors = articles.filter(a => 
        a.author && 
        a.author !== 'Cloudflare' && 
        a.author !== 'Unknown' && 
        a.author !== 'EdgeProp Staff'
      );
      
      const realThumbnails = articles.filter(a => 
        a.thumbnail && 
        !a.thumbnail.includes('via.placeholder')
      );
      
      console.log('📊 IMPROVEMENTS CHECK:');
      console.log(`   ✅ Real Authors: ${realAuthors.length}/${articles.length} (${Math.round(realAuthors.length/articles.length*100)}%)`);
      console.log(`   ✅ Real Thumbnails: ${realThumbnails.length}/${articles.length} (${Math.round(realThumbnails.length/articles.length*100)}%)`);
      
      if (realAuthors.length > articles.length * 0.5) {
        console.log('🎉 Author extraction is working well!');
      } else {
        console.log('⚠️  Author extraction needs more work');
      }
      
      if (realThumbnails.length > articles.length * 0.5) {
        console.log('🎉 Thumbnail extraction is working well!');
      } else {
        console.log('⚠️  Thumbnail extraction needs more work');
      }
      
    } else {
      console.warn('⚠️  WARNING: No articles were returned.');
    }
    
  } catch (error) {
    console.error('❌ ERROR: MCP scraper failed:', error);
  }
}

testFixedMCPScraper();
