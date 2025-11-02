#!/usr/bin/env bun

import { chromium } from 'playwright';

async function debugContentExtraction() {
  console.log('🔍 Debugging Content Extraction for Specific Article...\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const articleUrl = 'https://www.edgeprop.sg/property-news/six-storey-detached-factory-pandan-avenue-sale-21-mil';

  try {
    await page.goto(articleUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    const debugData = await page.evaluate(() => {
      console.log('🔍 Starting detailed content extraction debug...');
      
      // Get the full page text
      const fullText = document.body.textContent || '';
      console.log(`Full page text length: ${fullText.length}`);
      
      // Try to find the main article content
      const articleSelectors = [
        'article',
        '.article-content',
        '.post-content',
        '.entry-content',
        'main',
        '.content',
        '[class*="article"]',
        '[class*="content"]'
      ];
      
      let mainContent = '';
      let mainContentElement = null;
      
      for (const selector of articleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const elementText = element.textContent?.trim();
          console.log(`Found element with selector "${selector}": ${elementText?.length} chars`);
          if (elementText && elementText.length > 500 && elementText.length > mainContent.length) {
            mainContent = elementText;
            mainContentElement = element;
            console.log(`Using "${selector}" as main content (${elementText.length} chars)`);
          }
        }
      }
      
      // If no main content found, try to extract from specific areas
      if (!mainContent || mainContent.length < 500) {
        console.log('No main content found, trying specific extraction...');
        
        // Look for the article body specifically
        const articleBody = document.querySelector('main, .article-body, [class*="article-body"]');
        if (articleBody) {
          mainContent = articleBody.textContent?.trim() || '';
          console.log(`Found article body: ${mainContent.length} chars`);
        }
        
        // If still no good content, try to extract paragraphs that look like article content
        if (!mainContent || mainContent.length < 500) {
          const allParagraphs = Array.from(document.querySelectorAll('p'))
            .map(p => p.textContent?.trim())
            .filter(text => text && text.length > 50)
            .filter(text => 
              !text.includes('EdgeProp') &&
              !text.includes('Follow Us') &&
              !text.includes('Subscribe') &&
              !text.includes('Download') &&
              !text.includes('Popular Projects') &&
              !text.includes('Property Research') &&
              !text.includes('Our Site') &&
              !text.includes('About Us') &&
              !text.includes('Terms') &&
              !text.includes('Privacy') &&
              !text.includes('Contact') &&
              !text.includes('Advertise')
            );
          
          mainContent = allParagraphs.join('\n\n');
          console.log(`Extracted from paragraphs: ${mainContent.length} chars`);
        }
      }
      
      // Extract clean paragraphs
      let cleanParagraphs: string[] = [];
      if (mainContent) {
        cleanParagraphs = mainContent
          .split(/\n\s*\n|\.\s+(?=[A-Z])/)
          .map(p => p.trim())
          .filter(text => 
            text && 
            text.length > 30 && 
            text.length < 1500 &&
            !text.includes('EdgeProp') &&
            !text.includes('Follow Us') &&
            !text.includes('Subscribe') &&
            !text.includes('Download') &&
            !text.includes('Popular Projects') &&
            !text.includes('Property Research') &&
            !text.includes('Properties For Sale') &&
            !text.includes('Browse Listings') &&
            !text.includes('Our Site') &&
            !text.includes('About Us') &&
            !text.includes('Terms') &&
            !text.includes('Privacy') &&
            !text.includes('Contact') &&
            !text.includes('Advertise') &&
            !text.includes('User Guide') &&
            !text.includes('We\'re Hiring') &&
            !text.includes('FAQs') &&
            !text.includes('Sale') &&
            !text.includes('Rent') &&
            !text.includes('New Launches') &&
            !text.includes('Analytics') &&
            !text.includes('News') &&
            !text.includes('Ask Buddy') &&
            !text.includes('Agent') &&
            !text.includes('Register') &&
            !text.includes('Login')
          )
          .slice(0, 20);
      }
      
      // Extract author
      let author = 'EdgeProp Staff';
      const authorPattern = /By\s+([A-Za-z\s]+?)(?:\s*\/|\s*\|)/i;
      const authorMatch = fullText.match(authorPattern);
      if (authorMatch && authorMatch[1]) {
        author = authorMatch[1].trim();
      }
      
      // Extract date
      let publishedDate = '';
      const timeElement = document.querySelector('time');
      if (timeElement) {
        publishedDate = timeElement.getAttribute('datetime') || timeElement.textContent?.trim() || '';
      }
      
      // Extract categories/tags
      const tagElements = document.querySelectorAll('a[href*="property-news-search"]');
      const categories = Array.from(tagElements)
        .map(el => el.textContent?.trim())
        .filter(Boolean)
        .filter(tag => tag !== 'Tags:');
      
      return {
        fullTextLength: fullText.length,
        mainContentLength: mainContent.length,
        cleanParagraphsCount: cleanParagraphs.length,
        cleanParagraphs: cleanParagraphs.slice(0, 10), // First 10 paragraphs
        author,
        publishedDate,
        categories,
        mainContentPreview: mainContent.substring(0, 500),
        fullTextPreview: fullText.substring(0, 1000)
      };
    });

    console.log('\n📊 CONTENT EXTRACTION DEBUG RESULTS:');
    console.log('================================================================================');
    console.log(`Full Page Text Length: ${debugData.fullTextLength}`);
    console.log(`Main Content Length: ${debugData.mainContentLength}`);
    console.log(`Clean Paragraphs Count: ${debugData.cleanParagraphsCount}`);
    console.log(`Author: "${debugData.author}"`);
    console.log(`Published Date: "${debugData.publishedDate}"`);
    console.log(`Categories: ${debugData.categories.join(', ')}`);
    
    console.log('\n📝 CLEAN PARAGRAPHS:');
    debugData.cleanParagraphs.forEach((paragraph, index) => {
      console.log(`${index + 1}. ${paragraph.substring(0, 150)}...`);
    });
    
    console.log('\n📄 MAIN CONTENT PREVIEW:');
    console.log(debugData.mainContentPreview);
    
    console.log('\n📄 FULL TEXT PREVIEW:');
    console.log(debugData.fullTextPreview);

  } catch (error) {
    console.error('❌ Debugging failed:', error);
  } finally {
    await browser.close();
  }
}

debugContentExtraction();
