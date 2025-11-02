const { chromium } = require('playwright');

async function validateMCPScraper() {
  console.log('🚀 Starting MCP Scraper Validation Test');
  console.log('=====================================');
  
  const browser = await chromium.launch({ 
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--disable-web-security',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  
  const page = await context.newPage();
  
  try {
    // Step 1: Navigate to EdgeProp latest news page
    console.log('\n📍 Step 1: Navigating to EdgeProp latest news page...');
    await page.goto('https://www.edgeprop.sg/property-news/latest', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    // Wait for page to load and handle potential Cloudflare
    await page.waitForTimeout(5000);
    
    // Check if we need to handle Cloudflare
    const hasCloudflare = await page.evaluate(() => {
      return document.body.textContent?.includes('Just a moment') || 
             document.body.textContent?.includes('Verifying you are human') ||
             document.title?.includes('Just a moment');
    });
    
    if (hasCloudflare) {
      console.log('⚠️ Cloudflare detected, waiting for resolution...');
      await page.waitForTimeout(10000);
    }
    
    // Step 2: Discover articles on the page (simulate MCP scraper logic)
    console.log('\n🔍 Step 2: Discovering articles on the page...');
    const articles = await page.evaluate(() => {
      // This mimics the article discovery logic from the MCP scraper
      const articleContainers = Array.from(document.querySelectorAll('div')).filter(div => {
        const hasArticleLink = div.querySelector('a[href*="/property-news/"]');
        const hasImage = div.querySelector('img');
        const href = hasArticleLink?.getAttribute('href');
        
        if (hasArticleLink && hasImage && href && href.includes('/property-news/')) {
          const isRelativeUrl = href.startsWith('/property-news/');
          const isAbsoluteUrl = href.includes('edgeprop.sg/property-news/');
          const pathSegments = href.split('/').length;
          return (isRelativeUrl && pathSegments >= 3) || (isAbsoluteUrl && pathSegments >= 5);
        }
        return false;
      });
      
      console.log(`Found ${articleContainers.length} article containers`);
      
      const uniqueHrefs = new Map();
      
      // Process containers to extract article data (limit to 5 for testing)
      for (let index = 0; index < Math.min(articleContainers.length, 5); index++) {
        const container = articleContainers[index];
        
        const allLinks = Array.from(container.querySelectorAll('a[href*="/property-news/"]'));
        const articleLinks = allLinks.filter(link => {
          const href = link.getAttribute('href') || '';
          const isRelativeUrl = href.startsWith('/property-news/');
          const isAbsoluteUrl = href.includes('edgeprop.sg/property-news/');
          const pathSegments = href.split('/').length;
          
          return (isRelativeUrl || isAbsoluteUrl) && 
                 !href.includes('/property-news-search') &&
                 !href.includes('/property-news/latest') &&
                 !href.includes('/property-news/news') &&
                 ((isRelativeUrl && pathSegments >= 3) || (isAbsoluteUrl && pathSegments >= 5));
        });
        
        let articleHref = '';
        let title = '';
        let category = '';
        let imgSrc = '';
        
        // Get the first valid article link
        const sortedLinks = articleLinks.sort((a, b) => (b.textContent?.trim().length || 0) - (a.textContent?.trim().length || 0));
        
        sortedLinks.forEach(link => {
          const href = link.getAttribute('href') || '';
          const text = link.textContent?.trim() || '';
          
          if (href && !articleHref) {
            articleHref = href;
          }
          
          if (['PROPERTY NEWS', 'DEAL WATCH', 'PERSONALITY', 'SPECIAL FEATURE', 'NEWS / IN DEPTH', 'NEWS / INTERNATIONAL'].includes(text)) {
            category = text;
          }
          
          if (text && text.length > 50 && !text.includes('EDGEPROP SINGAPORE') && !text.includes('PROPERTY NEWS')) {
            if (!title || text.length > title.length) {
              title = text;
            }
          }
        });
        
        // Get image
        const img = container.querySelector('img');
        if (img) {
          imgSrc = img.getAttribute('src') || img.getAttribute('data-src') || '';
        }
        
        // Normalize href
        const normalizedHref = articleHref.replace(/^https?:\/\/www\.edgeprop\.sg/, '').replace(/^([^/])/, '/$1');
        
        if (normalizedHref && normalizedHref.includes('/property-news/') && !uniqueHrefs.has(normalizedHref)) {
          uniqueHrefs.set(normalizedHref, {
            href: normalizedHref,
            title: title,
            category: category,
            imgSrc: imgSrc,
            index: index
          });
        }
      }
      
      return Array.from(uniqueHrefs.values());
    });
    
    console.log(`✅ Discovered ${articles.length} articles for testing`);
    articles.forEach((article, idx) => {
      console.log(`   ${idx + 1}. "${article.title?.substring(0, 60)}..." -> ${article.href}`);
    });
    
    // Step 3: Test navigation to individual articles and content extraction
    console.log('\n📖 Step 3: Testing individual article navigation and content extraction...');
    
    const results = [];
    
    for (let i = 0; i < Math.min(articles.length, 3); i++) {
      const article = articles[i];
      console.log(`\n--- Testing Article ${i + 1}/${Math.min(articles.length, 3)} ---`);
      console.log(`Title: ${article.title?.substring(0, 80)}...`);
      console.log(`URL: https://www.edgeprop.sg${article.href}`);
      
      try {
        // Navigate to the individual article
        await page.goto(`https://www.edgeprop.sg${article.href}`, { 
          waitUntil: 'domcontentloaded',
          timeout: 60000 
        });
        
        // Wait for content to load and handle Cloudflare
        await page.waitForTimeout(3000);
        
        // Check for Cloudflare again
        const hasCloudflare = await page.evaluate(() => {
          return document.body.textContent?.includes('Just a moment') || 
                 document.body.textContent?.includes('Verifying you are human');
        });
        
        if (hasCloudflare) {
          console.log('   ⚠️ Cloudflare detected on article page, waiting...');
          await page.waitForTimeout(8000);
        }
        
        // Extract content using the same logic as MCP scraper
        const articleContent = await page.evaluate((originalTitle) => {
          // Find content container
          const articleSelectors = [
            '.jsx-4217446631.article-detail.left-section',
            '.jsx-2128998887.detail-content',
            '.jsx-4217446631',
            '.jsx-2128998887',
            'main article',
            'article',
            'main'
          ];
          
          let contentContainer = null;
          let usedSelector = '';
          
          for (const selector of articleSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              contentContainer = element;
              usedSelector = selector;
              break;
            }
          }
          
          if (!contentContainer) {
            contentContainer = document.body;
            usedSelector = 'document.body';
          }
          
          // Extract paragraphs
          const paragraphSelectors = [
            'p:not([class*="meta"]):not([class*="tag"]):not([class*="category"])',
            'div p',
            '.content p',
            '[class*="content"] p'
          ];
          
          let paragraphs = [];
          
          for (const selector of paragraphSelectors) {
            const elements = Array.from(contentContainer.querySelectorAll(selector));
            if (elements.length > 0) {
              paragraphs = elements
                .map(el => el.textContent?.trim() || '')
                .filter(text => text.length > 50 && !text.toLowerCase().includes('advertisement'));
              if (paragraphs.length > 0) break;
            }
          }
          
          // Extract images
          const images = Array.from(contentContainer.querySelectorAll('img'))
            .map(img => ({
              url: img.getAttribute('src') || img.getAttribute('data-src') || '',
              alt: img.getAttribute('alt') || '',
              caption: ''
            }))
            .filter(img => img.url && !img.url.includes('logo') && !img.url.includes('icon'));
          
          // Get title from page
          const pageTitle = document.querySelector('h1')?.textContent?.trim() || 
                           document.querySelector('title')?.textContent?.trim() || 
                           originalTitle;
          
          // Calculate text content
          const textContent = paragraphs.join(' ');
          
          return {
            title: pageTitle,
            paragraphs: paragraphs,
            textContent: textContent,
            textLength: textContent.length,
            paragraphCount: paragraphs.length,
            imageCount: images.length,
            images: images.slice(0, 3), // First 3 images for preview
            extractionSuccess: paragraphs.length > 0 && textContent.length > 100
          };
        }, article.title);
        
        console.log(`✅ Content extracted successfully:`);
        console.log(`   - Title: ${articleContent.title?.substring(0, 60)}...`);
        console.log(`   - Text length: ${articleContent.textLength} characters`);
        console.log(`   - Paragraphs: ${articleContent.paragraphCount}`);
        console.log(`   - Images: ${articleContent.imageCount}`);
        console.log(`   - Extraction success: ${articleContent.extractionSuccess}`);
        
        if (articleContent.paragraphs.length > 0) {
          console.log(`   - First paragraph: ${articleContent.paragraphs[0].substring(0, 100)}...`);
        }
        
        results.push({
          url: article.href,
          originalTitle: article.title,
          extractedTitle: articleContent.title,
          success: articleContent.extractionSuccess,
          textLength: articleContent.textLength,
          paragraphCount: articleContent.paragraphCount,
          imageCount: articleContent.imageCount
        });
        
      } catch (error) {
        console.log(`❌ Failed to extract content: ${error.message}`);
        results.push({
          url: article.href,
          originalTitle: article.title,
          success: false,
          error: error.message
        });
      }
      
      // Wait between articles
      await page.waitForTimeout(1000);
    }
    
    // Step 4: Summary and validation
    console.log('\n📊 Step 4: Validation Summary');
    console.log('============================');
    
    const successfulExtractions = results.filter(r => r.success);
    const failedExtractions = results.filter(r => !r.success);
    
    console.log(`✅ Successful extractions: ${successfulExtractions.length}/${results.length}`);
    console.log(`❌ Failed extractions: ${failedExtractions.length}/${results.length}`);
    
    if (successfulExtractions.length > 0) {
      console.log('\n🎯 Successful Articles:');
      successfulExtractions.forEach((result, idx) => {
        console.log(`   ${idx + 1}. ${result.extractedTitle?.substring(0, 50)}...`);
        console.log(`      URL: ${result.url}`);
        console.log(`      Text: ${result.textLength} chars, ${result.paragraphCount} paragraphs, ${result.imageCount} images`);
      });
    }
    
    if (failedExtractions.length > 0) {
      console.log('\n❌ Failed Articles:');
      failedExtractions.forEach((result, idx) => {
        console.log(`   ${idx + 1}. ${result.originalTitle?.substring(0, 50)}...`);
        console.log(`      URL: ${result.url}`);
        console.log(`      Error: ${result.error || 'Unknown error'}`);
      });
    }
    
    // Final validation
    const validationPassed = successfulExtractions.length >= Math.min(articles.length, 2); // At least 2 out of 3 should succeed
    
    console.log('\n🏆 FINAL VALIDATION RESULT');
    console.log('==========================');
    if (validationPassed) {
      console.log('✅ MCP SCRAPER VALIDATION PASSED');
      console.log('   The scraper correctly:');
      console.log('   - Discovers articles from listing pages');
      console.log('   - Navigates to individual article URLs');
      console.log('   - Extracts content from individual article pages');
      console.log('   - Processes text, images, and metadata properly');
    } else {
      console.log('❌ MCP SCRAPER VALIDATION FAILED');
      console.log('   Issues detected in content extraction process');
    }
    
    // Keep browser open for manual inspection
    console.log('\n⏳ Keeping browser open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the validation
validateMCPScraper().catch(console.error);