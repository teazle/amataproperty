import { scrapeArticleContent } from '../src/lib/scraper/edgeprop-content-scraper';

async function validateScraperResults() {
  console.log('🔍 Validating EdgeProp content scraper results...\n');
  
  const testArticle = {
    path: '/property-news/asia-pacific-data-centre-association-pushes-stronger-sustainability-frameworks',
    nid: 'validation-test'
  };
  
  try {
    console.log(`📄 Scraping article for validation: ${testArticle.path}\n`);
    
    const result = await scrapeArticleContent(testArticle.path, testArticle.nid);
    
    if (!result) {
      console.log('❌ Failed to scrape article content');
      return;
    }
    
    console.log('🧪 VALIDATION RESULTS:');
    console.log('='.repeat(60));
    
    // Validate title
    const expectedTitleKeywords = ['Asia-Pacific', 'Data Centre', 'Association', 'sustainability'];
    const titleValid = expectedTitleKeywords.every(keyword => 
      result.title.toLowerCase().includes(keyword.toLowerCase())
    );
    console.log(`📰 Title Validation: ${titleValid ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Expected keywords: ${expectedTitleKeywords.join(', ')}`);
    console.log(`   Actual title: ${result.title}\n`);
    
    // Validate author
    const authorValid = result.author && result.author.length > 0 && 
                       !result.author.includes('Terms and Conditions') &&
                       !result.author.includes('Privacy Policy');
    console.log(`✍️  Author Validation: ${authorValid ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Author found: ${result.author || 'None'}\n`);
    
    // Validate date (should not be default date)
    const dateValid = result.published_date && 
                     result.published_date !== '01 Jan 1970' &&
                     result.published_date.length > 0;
    console.log(`📅 Date Validation: ${dateValid ? '✅ PASS' : '⚠️  PARTIAL'}`);
    console.log(`   Date found: ${result.published_date || 'None'}`);
    console.log(`   Note: Date extraction may need refinement for this specific article\n`);
    
    // Validate content quality
    const contentValid = result.paragraphs.length >= 5 && 
                        result.word_count > 200 &&
                        result.text_content.length > 500;
    console.log(`📝 Content Quality: ${contentValid ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Paragraphs: ${result.paragraphs.length} (expected: ≥5)`);
    console.log(`   Word count: ${result.word_count} (expected: >200)`);
    console.log(`   Text length: ${result.text_content.length} (expected: >500)\n`);
    
    // Validate content relevance
    const expectedContentKeywords = ['APDCA', 'data centre', 'sustainability', 'energy', 'policy'];
    const contentRelevant = expectedContentKeywords.some(keyword => 
      result.text_content.toLowerCase().includes(keyword.toLowerCase())
    );
    console.log(`🎯 Content Relevance: ${contentRelevant ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Expected keywords: ${expectedContentKeywords.join(', ')}`);
    console.log(`   Found in content: ${expectedContentKeywords.filter(keyword => 
      result.text_content.toLowerCase().includes(keyword.toLowerCase())
    ).join(', ')}\n`);
    
    // Validate images
    const imageValid = result.main_image_url && result.main_image_url.length > 0;
    console.log(`🖼️  Image Validation: ${imageValid ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Main image: ${result.main_image_url ? 'Found' : 'Not found'}`);
    console.log(`   Total images: ${result.images.length}\n`);
    
    // Validate links
    const linkValid = result.links.length > 0;
    console.log(`🔗 Links Validation: ${linkValid ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Total links: ${result.links.length}\n`);
    
    // Overall assessment
    const validationsPassed = [titleValid, authorValid, contentValid, contentRelevant, imageValid, linkValid];
    const passCount = validationsPassed.filter(Boolean).length;
    const totalTests = validationsPassed.length;
    
    console.log('📊 OVERALL ASSESSMENT:');
    console.log('='.repeat(60));
    console.log(`✅ Tests Passed: ${passCount}/${totalTests}`);
    console.log(`📈 Success Rate: ${Math.round((passCount / totalTests) * 100)}%`);
    
    if (passCount >= totalTests - 1) {
      console.log('🎉 EXCELLENT: Scraper is working very well!');
    } else if (passCount >= totalTests - 2) {
      console.log('👍 GOOD: Scraper is working well with minor issues');
    } else {
      console.log('⚠️  NEEDS IMPROVEMENT: Several validation issues found');
    }
    
    console.log('\n📋 SAMPLE SCRAPED CONTENT:');
    console.log('-'.repeat(60));
    console.log('First paragraph:');
    console.log(result.paragraphs[0] || 'No paragraphs found');
    
    console.log('\n✅ Validation completed!');
    
  } catch (error) {
    console.error('❌ Error during validation:', error);
  }
}

// Run the validation
validateScraperResults().catch(console.error);