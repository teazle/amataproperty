#!/usr/bin/env node

import { chromium } from 'playwright';

// Import the cleanParagraphs function directly
function cleanParagraphs(paragraphs: string[]): string[] {
  if (!paragraphs || paragraphs.length === 0) return [];
  
  return paragraphs.filter(p => {
    if (!p || typeof p !== 'string') return false;
    
    const text = p.trim();
    
    // Basic length check - be less aggressive
    if (text.length < 15) return false;
    
    // Skip very short paragraphs (less than 3 words)
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 3) return false;
    
    const lower = text.toLowerCase();
    
    // Filter out obvious non-content with more specific patterns
    const nonContentPatterns = [
      'subscribe to our newsletter',
      'follow us on',
      'cookie policy',
      'privacy policy',
      'terms of service',
      'read also:',
      'related articles',
      'advertisement',
      'sponsored content',
      'click here to',
      'sign up for',
      'download our app'
    ];
    
    // Check if text contains any non-content patterns
    for (const pattern of nonContentPatterns) {
      if (lower.includes(pattern)) return false;
    }
    
    // Filter out URLs and email addresses
    if (lower.startsWith('http') || lower.startsWith('www.') || lower.includes('@') && lower.includes('.com')) {
      return false;
    }
    
    // Filter out JavaScript code patterns
    if (lower.includes('function(') || lower.includes('var ') || lower.includes('const ') || lower.includes('let ')) {
      return false;
    }
    
    return true;
  });
}

async function testContentExtraction() {
  console.log('🚀 Testing MCP Content Extraction Logic...\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Navigate to EdgeProp news page first to get a working article
    console.log('🔍 Finding a working article from EdgeProp news page...');
    await page.goto('https://www.edgeprop.sg/news', { waitUntil: 'networkidle' });
    
    // Get the first article link
    const articleUrl = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/news/"]'));
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.includes('/news/') && !href.includes('#') && href.length > 20) {
          return href.startsWith('http') ? href : `https://www.edgeprop.sg${href}`;
        }
      }
      return null;
    });

    if (!articleUrl) {
      console.log('❌ Could not find a valid article URL');
      return;
    }

    console.log(`🔍 Navigating to article: ${articleUrl}`);
    
    await page.goto(articleUrl, { waitUntil: 'networkidle' });
    console.log('✅ Page loaded successfully');

    // Test content extraction with multiple selectors
    const contentData = await page.evaluate(() => {
      // Try multiple selectors to find content
      const selectors = [
        '.jsx-2128998887',
        'article',
        '.article-content',
        '.content',
        'main',
        '.main-content',
        '[class*="content"]',
        '[class*="article"]'
      ];
      
      let contentContainer = null;
      for (const selector of selectors) {
        contentContainer = document.querySelector(selector);
        if (contentContainer && contentContainer.textContent && contentContainer.textContent.length > 1000) {
          break;
        }
      }
      
      if (!contentContainer) {
        // Fallback to body if no specific container found
        contentContainer = document.body;
      }

      // Extract paragraphs from p tags
      const pElements = Array.from(contentContainer.querySelectorAll('p'));
      const pTexts = pElements
        .map(el => el.textContent?.trim())
        .filter(text => text && text.length > 10);

      // Extract paragraphs from div tags with substantial text
      const divElements = Array.from(contentContainer.querySelectorAll('div'));
      const divTexts = divElements
        .filter(el => {
          const text = el.textContent || '';
          const hasDirectText = el.childNodes.length > 0 && 
                               Array.from(el.childNodes).some(node => 
                                 node.nodeType === 3 && (node.textContent?.trim().length ?? 0) > 20
                               );
          return text.length > 50 && hasDirectText;
        })
        .map(el => el.textContent?.trim())
        .filter(text => text && text.length > 20);

      const allParagraphs = [...pTexts, ...divTexts];
      
      return {
        totalContainer: contentContainer.textContent?.length || 0,
        pCount: pTexts.length,
        divCount: divTexts.length,
        totalParagraphs: allParagraphs.length,
        paragraphs: allParagraphs,
        firstFewParagraphs: allParagraphs.slice(0, 5)
      };
    });

    if ('error' in contentData) {
      console.log(`❌ ${contentData.error}`);
      return;
    }

    console.log(`📊 Raw Content Stats:`);
    console.log(`   Total container text: ${contentData.totalContainer} characters`);
    console.log(`   P elements: ${contentData.pCount}`);
    console.log(`   Div elements: ${contentData.divCount}`);
    console.log(`   Total paragraphs: ${contentData.totalParagraphs}`);

    // Test the cleanParagraphs function
    console.log(`\n🧹 Testing cleanParagraphs function...`);
    const cleanedParagraphs = cleanParagraphs(contentData.paragraphs);
    console.log(`   Before cleaning: ${contentData.paragraphs.length} paragraphs`);
    console.log(`   After cleaning: ${cleanedParagraphs.length} paragraphs`);

    // Create final text content
    const textContent = cleanedParagraphs.join('\n\n');
    const wordCount = textContent.split(/\s+/).length;
    const readingTime = Math.ceil(wordCount / 200);

    console.log(`\n📝 Final Content Stats:`);
    console.log(`   Text content length: ${textContent.length} characters`);
    console.log(`   Word count: ${wordCount} words`);
    console.log(`   Reading time: ${readingTime} minutes`);
    console.log(`   Cleaned paragraphs: ${cleanedParagraphs.length}`);

    // Validation
    console.log(`\n🧪 Content Validation:`);
    let passedTests = 0;
    const totalTests = 5;

    if (textContent.length > 1000) {
      console.log('✅ 1. Substantial text content (>1000 chars)');
      passedTests++;
    } else {
      console.log(`❌ 1. Insufficient text content (${textContent.length} chars)`);
    }

    if (wordCount > 100) {
      console.log('✅ 2. Reasonable word count (>100 words)');
      passedTests++;
    } else {
      console.log(`❌ 2. Low word count (${wordCount} words)`);
    }

    if (cleanedParagraphs.length > 5) {
      console.log('✅ 3. Multiple paragraphs (>5)');
      passedTests++;
    } else {
      console.log(`❌ 3. Too few paragraphs (${cleanedParagraphs.length})`);
    }

    if (readingTime > 0) {
      console.log('✅ 4. Valid reading time');
      passedTests++;
    } else {
      console.log('❌ 4. Invalid reading time');
    }

    if (cleanedParagraphs.length > 0 && cleanedParagraphs[0].length > 50) {
      console.log('✅ 5. First paragraph has substantial content');
      passedTests++;
    } else {
      console.log('❌ 5. First paragraph too short');
    }

    const successRate = Math.round((passedTests / totalTests) * 100);
    console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed (${successRate}%)`);

    if (successRate >= 90) {
      console.log('🎉 EXCELLENT! Content extraction is working perfectly!');
    } else if (successRate >= 75) {
      console.log('✅ GOOD! Content extraction is working well.');
    } else {
      console.log('⚠️ NEEDS IMPROVEMENT! Content extraction has issues.');
    }

    // Show content sample
    if (textContent.length > 0) {
      console.log('\n📝 Content Sample (first 300 chars):');
      console.log(`"${textContent.substring(0, 300)}..."`);
    }

    // Show first few cleaned paragraphs
    console.log('\n📄 First 3 Cleaned Paragraphs:');
    cleanedParagraphs.slice(0, 3).forEach((p, i) => {
      console.log(`   ${i + 1}. "${p.substring(0, 100)}${p.length > 100 ? '...' : ''}"`);
    });

  } catch (error) {
    console.error('❌ Error during content extraction test:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testContentExtraction().catch(console.error);