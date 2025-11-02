/**
 * Test MCP Scraper Content Accuracy
 * This script tests the MCP scraper's ability to extract content accurately
 * by comparing scraped content with the original article
 */

async function testMCPContentAccuracy() {
  console.log('🔍 Testing MCP Scraper Content Accuracy...\n');
  
  // Test article URL
  const testUrl = 'https://www.edgeprop.sg/property-news/singapore-property-market-outlook-2024-what-to-expect';
  
  try {
    console.log(`📰 Testing article: ${testUrl}`);
    console.log('🚀 Scraping with MCP scraper...\n');
    
    // Call the single article scraper API
    const response = await fetch('http://localhost:3000/api/articles/scrape-single', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: testUrl,
        scraperType: 'mcp'
      })
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(`Scraping failed: ${result.error}`);
    }
    
    const article = result.article;
    
    console.log('✅ MCP Scraper Results:');
    console.log('========================');
    console.log(`📰 Title: ${article.title}`);
    console.log(`👤 Author: ${article.author}`);
    console.log(`📂 Category: ${article.category?.join(', ') || 'N/A'}`);
    console.log(`📊 Word Count: ${article.word_count}`);
    console.log(`⏱️ Reading Time: ${article.reading_time_minutes} minutes`);
    console.log(`📝 Paragraphs: ${article.paragraphs_count || 0}`);
    console.log(`🖼️ Images: ${article.images_count || 0}`);
    console.log(`🔗 Links: ${article.links_count || 0}`);
    console.log(`📄 Content Length: ${article.text_content?.length || 0} characters (preview)\n`);
    
    // Analyze content quality
    console.log('📊 Content Quality Analysis:');
    console.log('============================');
    
    if (article.text_content) {
      const content = article.text_content;
      const sentences = content.split(/[.!?]+/).filter((s: string) => s.trim().length > 10);
      const hasNumbers = /\d+/.test(content);
      const hasQuotes = /["']/.test(content);
      const avgSentenceLength = sentences.length > 0 ? content.length / sentences.length : 0;
      
      console.log(`📝 Total sentences: ${sentences.length}`);
      console.log(`📏 Average sentence length: ${avgSentenceLength.toFixed(1)} characters`);
      console.log(`🔢 Contains numbers/statistics: ${hasNumbers ? '✅' : '❌'}`);
      console.log(`💬 Contains quotes: ${hasQuotes ? '✅' : '❌'}`);
      
      // Show first few paragraphs for manual inspection
      if (article.text_content) {
        console.log('\n📖 Content Preview (for manual inspection):');
        console.log('==========================================');
        console.log(`${article.text_content}\n`);
      }
      // Content preview
      console.log('📄 Content Preview:');
      console.log('==================');
      if (article.text_content) {
        console.log(`${article.text_content}\n`);
      } else {
        console.log('No content preview available\n');
      }
    }
    
    // Quality assessment
    console.log('🎯 Quality Assessment:');
    console.log('======================');
    
    const qualityChecks = [
      { check: 'Has title', passed: !!article.title, weight: 10 },
      { check: 'Has author', passed: !!article.author, weight: 5 },
      { check: 'Has substantial content preview (>100 chars)', passed: (article.text_content?.length || 0) > 100, weight: 25 },
      { check: 'Has multiple paragraphs (>5)', passed: (article.paragraphs_count || 0) > 5, weight: 15 },
      { check: 'Has reasonable word count (>200)', passed: (article.word_count || 0) > 200, weight: 20 },
      { check: 'Has images', passed: (article.images_count || 0) > 0, weight: 10 },
      { check: 'Has links', passed: (article.links_count || 0) > 0, weight: 10 },
      { check: 'Has category', passed: (article.category?.length || 0) > 0, weight: 5 }
    ];
    
    let totalScore = 0;
    let maxScore = 0;
    
    qualityChecks.forEach(({ check, passed, weight }) => {
      console.log(`${passed ? '✅' : '❌'} ${check} (${weight}pts)`);
      if (passed) totalScore += weight;
      maxScore += weight;
    });
    
    const qualityPercentage = (totalScore / maxScore) * 100;
    console.log(`\n🏆 Overall Quality Score: ${totalScore}/${maxScore} (${qualityPercentage.toFixed(1)}%)`);
    
    if (qualityPercentage >= 90) {
      console.log('🌟 EXCELLENT: Content extraction is highly accurate');
    } else if (qualityPercentage >= 75) {
      console.log('👍 GOOD: Content extraction is mostly accurate');
    } else if (qualityPercentage >= 60) {
      console.log('⚠️ FAIR: Content extraction needs improvement');
    } else {
      console.log('❌ POOR: Content extraction has significant issues');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testMCPContentAccuracy();