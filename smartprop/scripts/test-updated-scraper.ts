import { scrapeArticleContent } from '../src/lib/scraper/edgeprop-content-scraper';

async function testUpdatedScraper() {
  console.log('🧪 Testing updated EdgeProp content scraper...\n');
  
  // Test with the article we analyzed
  const testArticle = {
    path: '/property-news/asia-pacific-data-centre-association-pushes-stronger-sustainability-frameworks',
    nid: 'test-article-1'
  };
  
  try {
    console.log(`📄 Scraping article: ${testArticle.path}`);
    console.log(`🔗 Full URL: https://www.edgeprop.sg${testArticle.path}\n`);
    
    const result = await scrapeArticleContent(testArticle.path, testArticle.nid);
    
    if (!result) {
      console.log('❌ Failed to scrape article content');
      return;
    }
    
    console.log('✅ Successfully scraped article!\n');
    
    // Display results
    console.log('📊 SCRAPING RESULTS:');
    console.log('='.repeat(50));
    console.log(`📰 Title: ${result.title}`);
    console.log(`✍️  Author: ${result.author}`);
    console.log(`📅 Date: ${result.published_date}`);
    console.log(`🖼️  Main Image: ${result.main_image_url ? 'Found' : 'Not found'}`);
    console.log(`📝 Paragraphs: ${result.paragraphs.length}`);
    console.log(`🔗 Links: ${result.links.length}`);
    console.log(`🖼️  Images: ${result.images.length}`);
    console.log(`📊 Word Count: ${result.word_count}`);
    console.log(`⏱️  Reading Time: ${result.reading_time_minutes} minutes\n`);
    
    // Show first few paragraphs
    console.log('📄 CONTENT PREVIEW:');
    console.log('-'.repeat(50));
    result.paragraphs.slice(0, 3).forEach((para, index) => {
      console.log(`${index + 1}. ${para.substring(0, 150)}${para.length > 150 ? '...' : ''}\n`);
    });
    
    // Show links
    if (result.links.length > 0) {
      console.log('🔗 LINKS FOUND:');
      console.log('-'.repeat(50));
      result.links.slice(0, 5).forEach((link, index) => {
        console.log(`${index + 1}. ${link.text} (${link.type})`);
        console.log(`   ${link.url}\n`);
      });
    }
    
    // Show images
    if (result.images.length > 0) {
      console.log('🖼️  IMAGES FOUND:');
      console.log('-'.repeat(50));
      result.images.slice(0, 3).forEach((img, index) => {
        console.log(`${index + 1}. ${img}\n`);
      });
    }
    
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error testing scraper:', error);
  }
}

// Run the test
testUpdatedScraper().catch(console.error);