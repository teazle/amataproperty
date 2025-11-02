#!/usr/bin/env bun

import { chromium } from 'playwright';

async function debugDescriptionExtraction() {
  console.log('🔍 Debugging Description Extraction from EdgeProp...\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const articleUrl = 'https://www.edgeprop.sg/property-news/penrith-over-41-times-subscribed-ahead-weekend-launch-oct-18';

  try {
    await page.goto(articleUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    const debugData = await page.evaluate(() => {
      console.log('🔍 Starting article content extraction...');
      
      // Use document.body as the content container
      const contentContainer = document.body;
      console.log(`Using document.body as content container`);
      console.log(`Page title: ${document.title}`);
      console.log(`Page URL: ${window.location.href}`);
      
      // Get all text content from the page
      const allText = contentContainer.textContent || '';
      console.log(`Total text length: ${allText.length}`);
      console.log(`First 500 chars: ${allText.substring(0, 500)}`);
      
      // Extract text content and paragraphs
      let paragraphs: string[] = [];
      
      if (allText.length > 100) {
        // Split by common paragraph boundaries and filter
        paragraphs = allText
          .split(/\n\s*\n|\.\s+(?=[A-Z])/)
          .map(p => p.trim())
          .filter(text => 
            text && 
            text.length > 50 && // Longer paragraphs
            text.length < 1500 && // Not too long
            !text.includes('EdgeProp') && // Filter out navigation
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
            !text.includes('Login') &&
            !text.includes('Be the first to work out') &&
            !text.includes('Prospecting') &&
            !text.includes('Featured Enquiries') &&
            !text.includes('Real daily leads') &&
            !text.includes('FSBO') &&
            !text.includes('HDB MOP') &&
            !text.includes('Check all HDB units') &&
            !text.includes('Market Watch') &&
            !text.includes('Premium Tools') &&
            !text.includes('Presentation Tool') &&
            !text.includes('LandLens') &&
            !text.includes('Inspector') &&
            !text.includes('amenities from any location')
          )
          .slice(0, 20); // Limit to first 20 meaningful paragraphs
      }
      
      console.log(`Found ${paragraphs.length} paragraphs from article content`);
      
      // Create a proper description from the first meaningful paragraph
      let description = '';
      if (paragraphs.length > 0) {
        // Find the first paragraph that looks like article content (not navigation)
        const contentParagraph = paragraphs.find(p => 
          p.length > 50 && 
          !p.toLowerCase().includes('be the first to work out') &&
          !p.toLowerCase().includes('prospecting') &&
          !p.toLowerCase().includes('featured enquiries') &&
          !p.toLowerCase().includes('real daily leads') &&
          !p.toLowerCase().includes('fsbo') &&
          !p.toLowerCase().includes('hdb mop') &&
          !p.toLowerCase().includes('check all hdb units') &&
          !p.toLowerCase().includes('click into any listing') &&
          !p.toLowerCase().includes('make data-driven property') &&
          !p.toLowerCase().includes('the edge fair value') &&
          !p.toLowerCase().includes('en bloc calculator') &&
          !p.toLowerCase().includes('check out our insightful') &&
          !p.toLowerCase().includes('we also provide fruitful') &&
          !p.toLowerCase().includes('window._peq=window._peq') &&
          !p.toLowerCase().includes('get the latest details') &&
          !p.toLowerCase().includes('penrith, which previewed') &&
          (p.includes('$') || // Look for price information (likely article content)
           p.toLowerCase().includes('unit') || // Look for unit information
           p.toLowerCase().includes('project') || // Look for project information
           p.toLowerCase().includes('development')) // Look for development information
        );
        
        if (contentParagraph) {
          description = contentParagraph.substring(0, 200);
          console.log(`Found good description: ${description.substring(0, 100)}...`);
        } else {
          // Fallback to first paragraph if no good content found
          description = paragraphs[0].substring(0, 200);
          console.log(`Using fallback description: ${description.substring(0, 100)}...`);
        }
      }

      return {
        title: document.title,
        url: window.location.href,
        totalTextLength: allText.length,
        first500Chars: allText.substring(0, 500),
        paragraphsFound: paragraphs.length,
        paragraphs: paragraphs.slice(0, 5), // First 5 paragraphs for debugging
        finalDescription: description,
        descriptionLength: description.length
      };
    });

    console.log('\n📊 Description Extraction Debug Results:');
    console.log('================================================================================');
    console.log(`Page Title: ${debugData.title}`);
    console.log(`Page URL: ${debugData.url}`);
    console.log(`Total Text Length: ${debugData.totalTextLength}`);
    console.log(`\n--- First 500 Characters ---\n${debugData.first500Chars}\n`);
    console.log(`Paragraphs Found: ${debugData.paragraphsFound}`);
    console.log(`\n--- First 5 Paragraphs ---`);
    debugData.paragraphs.forEach((p, index) => {
      console.log(`${index + 1}. ${p.substring(0, 100)}...`);
    });
    console.log(`\n--- Final Description ---`);
    console.log(`Length: ${debugData.descriptionLength}`);
    console.log(`Content: ${debugData.finalDescription}`);

  } catch (error) {
    console.error('❌ Debugging failed:', error);
  } finally {
    await browser.close();
  }
}

debugDescriptionExtraction();
