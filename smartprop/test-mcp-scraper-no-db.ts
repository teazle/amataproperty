#!/usr/bin/env npx tsx

/**
 * Database-independent test for the fixed MCP scraper implementation
 * Tests core scraping functionality without database operations
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';

// Target articles to verify extraction
const TARGET_ARTICLES = [
  'Penang property market outlook for 2025',
  'Johor property market outlook for 2025',
  'Selangor property market outlook for 2025',
  'Kuala Lumpur property market outlook for 2025',
  'Sabah property market outlook for 2025',
  'Sarawak property market outlook for 2025',
  'Perak property market outlook for 2025',
  'Kedah property market outlook for 2025',
  'Negeri Sembilan property market outlook for 2025',
  'Melaka property market outlook for 2025',
  'Pahang property market outlook for 2025',
  'Terengganu property market outlook for 2025',
  'Kelantan property market outlook for 2025',
  'Perlis property market outlook for 2025',
  'Putrajaya property market outlook for 2025',
  'Labuan property market outlook for 2025',
  'Malaysia property market outlook for 2025',
  'Property investment trends in Malaysia for 2025',
  'Malaysian property developers outlook for 2025',
  'Property financing trends in Malaysia for 2025'
];

interface TestArticle {
  nid: string;
  title: string;
  path: string;
  thumbnail: string;
  author: string;
  created: string;
  category: string[];
  description: string;
  created_on: string;
}

async function testMCPScrapingCore() {
  console.log('🚀 Testing Core MCP Scraping Functionality (No Database)');
  console.log('=' .repeat(60));
  
  const startTime = Date.now();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  
  try {
    console.log('🌐 Launching browser...');
    browser = await chromium.launch({
      headless: false, // Set to true for headless mode
      channel: 'chromium'
    });
    
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'Asia/Kuala_Lumpur'
    });
    
    page = await context.newPage();
    
    // Navigate to EdgeProp news page
    console.log('🔍 Navigating to EdgeProp Singapore news page...');
    const url = 'https://www.edgeprop.sg/property-news/latest';
    
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    console.log('✅ Page loaded successfully');
    
    // Wait for content to load
    await page.waitForTimeout(3000);
    
    // Check for redirects
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);
    
    if (currentUrl !== url && !currentUrl.includes('property-news')) {
      console.log('❌ WARNING: Page was redirected away from property news!');
      console.log(`   Expected: ${url}`);
      console.log(`   Actual: ${currentUrl}`);
    } else {
      console.log('✅ No unwanted redirects detected');
    }
    
    // Extract articles from the page
    console.log('🔍 Extracting articles from page...');
    
    const articles = await page.evaluate(() => {
      // Singapore EdgeProp uses different selectors
      const articleLinks = document.querySelectorAll('a[href*="/property-news/"]');
      const results: TestArticle[] = [];
      
      articleLinks.forEach((linkElement, index) => {
        try {
          const link = linkElement as HTMLAnchorElement;
          const href = link.href;
          
          // Skip navigation links and focus on actual articles
          if (href.includes('/property-news/special-feature') || 
              href.includes('/property-news/latest') ||
              href === 'https://www.edgeprop.sg/property-news/') {
            return;
          }
          
          // Get title from link text or nearby elements
          let title = link.textContent?.trim() || '';
          
          // If link text is empty or just "PROPERTY NEWS", look for title in parent elements
          if (!title || title === 'PROPERTY NEWS' || title.length < 10) {
            const parentElement = link.closest('div, article, section');
            if (parentElement) {
              const titleElement = parentElement.querySelector('h1, h2, h3, h4, .title, [class*="title"]');
              if (titleElement) {
                title = titleElement.textContent?.trim() || title;
              }
            }
          }
          
          // Look for image in the same container
          let thumbnail = '';
          const parentContainer = link.closest('div, article, section');
          if (parentContainer) {
            const imageElement = parentContainer.querySelector('img');
            if (imageElement) {
              thumbnail = (imageElement as HTMLImageElement).src || '';
            }
          }
          
          // Look for author and date information
          let author = 'Unknown';
          let dateText = new Date().toISOString();
          
          if (parentContainer) {
            const authorElement = parentContainer.querySelector('.author, [class*="author"], .byline, [class*="byline"]');
            const dateElement = parentContainer.querySelector('.date, [class*="date"], time, [datetime]');
            
            if (authorElement) {
              author = authorElement.textContent?.trim() || 'Unknown';
            }
            if (dateElement) {
              dateText = dateElement.textContent?.trim() || dateText;
            }
          }
          
          if (title && href && title.length > 10) {
            // Extract NID from URL
            const nidMatch = href.match(/\/property-news\/([^\/\?]+)/);
            const nid = nidMatch ? nidMatch[1] : `article-${index}`;
            
            results.push({
              nid,
              title,
              path: href,
              thumbnail,
              author,
              created: dateText,
              category: ['Property News'],
              description: title,
              created_on: dateText
            });
          }
        } catch (error) {
          console.log(`Error processing article ${index}:`, error);
        }
      });
      
      return results;
    });
    
    console.log(`📊 Found ${articles.length} articles on the page`);
    
    // Limit to 20 articles as required
    const limitedArticles = articles.slice(0, 20);
    
    console.log('');
    console.log('📋 EXTRACTED ARTICLES (Limited to 20):');
    console.log('-' .repeat(50));
    
    let targetArticlesFound = 0;
    
    limitedArticles.forEach((article, index) => {
      console.log(`${index + 1}. ${article.title}`);
      console.log(`   📄 NID: ${article.nid}`);
      console.log(`   🔗 Path: ${article.path}`);
      console.log(`   👤 Author: ${article.author}`);
      console.log(`   📅 Created: ${article.created}`);
      console.log(`   🖼️  Thumbnail: ${article.thumbnail ? 'Yes' : 'No'}`);
      
      // Check if this matches any target article
      const isTargetArticle = TARGET_ARTICLES.some(target => 
        article.title.toLowerCase().includes(target.toLowerCase()) ||
        target.toLowerCase().includes(article.title.toLowerCase())
      );
      
      if (isTargetArticle) {
        targetArticlesFound++;
        console.log(`   ✅ MATCHES TARGET ARTICLE!`);
      }
      
      console.log('');
    });
    
    // Test article content extraction on first article
    if (limitedArticles.length > 0) {
      console.log('🔍 Testing content extraction on first article...');
      const firstArticle = limitedArticles[0];
      
      try {
        await page.goto(firstArticle.path, { 
          waitUntil: 'domcontentloaded',
          timeout: 60000 
        });
        
        await page.waitForTimeout(2000);
        
        // Extract content
        const content = await page.evaluate(() => {
          const contentSelectors = [
            '.article-content',
            '.content',
            '.post-content',
            '[class*="content"]',
            'main article',
            '.entry-content'
          ];
          
          let contentElement = null;
          for (const selector of contentSelectors) {
            contentElement = document.querySelector(selector);
            if (contentElement) break;
          }
          
          if (!contentElement) {
            contentElement = document.querySelector('body');
          }
          
          const textContent = contentElement?.textContent?.trim() || '';
          const images = Array.from(contentElement?.querySelectorAll('img') || [])
            .map(img => (img as HTMLImageElement).src)
            .filter(src => src && !src.includes('data:'));
          
          return {
            textLength: textContent.length,
            imageCount: images.length,
            hasContent: textContent.length > 100
          };
        });
        
        console.log(`✅ Content extraction test:`);
        console.log(`   📝 Text length: ${content.textLength} characters`);
        console.log(`   🖼️  Images found: ${content.imageCount}`);
        console.log(`   ✅ Has substantial content: ${content.hasContent ? 'Yes' : 'No'}`);
        
      } catch (error) {
        console.log(`❌ Error testing content extraction: ${error}`);
      }
    }
    
    // Summary
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log('');
    console.log('🎯 TEST SUMMARY');
    console.log('=' .repeat(40));
    console.log(`✅ Articles found: ${articles.length}`);
    console.log(`📊 Articles processed: ${limitedArticles.length}/20`);
    console.log(`🎯 Target articles found: ${targetArticlesFound}/${TARGET_ARTICLES.length}`);
    console.log(`⏱️  Total time: ${duration.toFixed(2)} seconds`);
    console.log(`🔄 No unwanted redirects: ${currentUrl.includes('property-news') ? 'Yes' : 'No'}`);
    
    // Validation
    console.log('');
    console.log('🔍 VALIDATION RESULTS');
    console.log('=' .repeat(40));
    
    const validations = {
      'Found articles': articles.length > 0,
      'Extracted 20 articles': limitedArticles.length === 20,
      'No redirects': currentUrl.includes('property-news'),
      'Articles have titles': limitedArticles.every(a => a.title.length > 0),
      'Articles have paths': limitedArticles.every(a => a.path.includes('/property-news/')),
      'Articles have NIDs': limitedArticles.every(a => a.nid.length > 0)
    };
    
    Object.entries(validations).forEach(([check, passed]) => {
      console.log(`${passed ? '✅' : '❌'} ${check}: ${passed ? 'PASSED' : 'FAILED'}`);
    });
    
    const allPassed = Object.values(validations).every(v => v);
    
    console.log('');
    if (allPassed) {
      console.log('🎉 SUCCESS: Core scraping functionality is working!');
      console.log('✅ Ready to implement full MCP scraper with database integration');
    } else {
      console.log('❌ ISSUES DETECTED: Some core functionality needs fixing');
    }
    
  } catch (error) {
    console.error('❌ ERROR during test:', error);
  } finally {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

// Run the test
testMCPScrapingCore().catch(console.error);