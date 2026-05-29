#!/usr/bin/env bun

import { chromium } from 'playwright';

async function testThumbnailExtraction() {
  console.log('🧪 Testing EdgeProp thumbnail extraction with correct selectors...\n');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3521, longitude: 103.8198 },
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': 'en-SG,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Cache-Control': 'max-age=0',
      'Upgrade-Insecure-Requests': '1'
    }
  });

  // Add stealth script
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Mock chrome object
    (window as unknown).chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: {}
    };

    // Mock permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: unknown) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  });

  const page = await context.newPage();

  try {
    console.log('📍 Navigating to EdgeProp property news search...');
    await page.goto('https://www.edgeprop.sg/property-news-search', { 
      waitUntil: 'domcontentloaded',
      timeout: 15000 
    });

    // Wait for the search button and click it to load articles
    try {
      await page.waitForSelector('button:has-text("Search")', { timeout: 5000 });
      await page.click('button:has-text("Search")');
      
      // Wait for articles to load
      await page.waitForTimeout(2000);
    } catch (error) {
      console.log('⚠️  Search button not found, trying to find articles directly...');
      await page.waitForTimeout(2000);
    }

    console.log('🔍 Extracting article links and testing thumbnail detection...\n');

    // First, let's check how many containers exist with the target class
    const containerCount = await page.evaluate(() => {
      return document.querySelectorAll('div[class*="jsx-2211414346"]').length;
    });
    console.log(`Found ${containerCount} containers with jsx-2211414346 class`);

    // Let's also check for any div containing img.tepcdn.com images
    const tepcdnContainerCount = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      return divs.filter(div => div.querySelector('img[src*="img.tepcdn.com"]')).length;
    });
    console.log(`Found ${tepcdnContainerCount} divs containing img.tepcdn.com images`);

    // First, let's see what images are available on the page and their container structure
    const allImages = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      return images.slice(0, 10).map(img => ({
        src: img.src,
        alt: img.alt,
        id: img.id,
        className: img.className,
        parentTag: img.parentElement?.tagName,
        parentClasses: img.parentElement?.className,
        // Find the closest div that contains an article link
        closestArticleDiv: (() => {
          let current = img.parentElement;
          while (current && current.tagName !== 'BODY') {
            if (current.querySelector('a[href*="/property-news/"]')) {
              return {
                tag: current.tagName,
                classes: current.className,
                hasLink: !!current.querySelector('a[href*="/property-news/"]')
              };
            }
            current = current.parentElement;
          }
          return null;
        })()
      }));
    });

    console.log('🔍 Available images on page with container structure:');
    allImages.forEach((img, i) => {
      console.log(`${i + 1}. src: ${img.src}`);
      console.log(`   alt: ${img.alt}`);
      console.log(`   id: ${img.id}`);
      console.log(`   class: ${img.className}`);
      console.log(`   parent: ${img.parentTag} (${img.parentClasses})`);
      if (img.closestArticleDiv) {
        console.log(`   closest article div: ${img.closestArticleDiv.tag} (${img.closestArticleDiv.classes})`);
      }
      console.log('');
    });

    // Extract article links and test thumbnail detection
    const articles = await page.evaluate(() => {
      // Use the correct EdgeProp container selector
      const articleContainers = Array.from(document.querySelectorAll('div[class*="jsx-2211414346"]'));
      
      return articleContainers.slice(0, 5).map((container, index) => {
        // Find the article link within this container
        const link = container.querySelector('a[href*="/property-news/"]');
        if (!link) return null;
        
        const href = link.getAttribute('href');
        const title = link.textContent?.trim();
        
        if (!href || !title) return null;

        // Skip navigation links
        const skipTitles = [
          'Latest News', 'In-Depth', 'Showcase', 'Deal Watch', 'International',
          'Special Feature', 'PROPERTY NEWS', 'NEWS / INTERNATIONAL', 'PERSONALITY'
        ];
        
        if (skipTitles.some(skipTitle => title.includes(skipTitle))) {
          return null;
        }

        // Find thumbnail using the correct selectors within the container
        let thumbnail = 'https://via.placeholder.com/300x200/4F46E5/FFFFFF?text=EdgeProp+News';
        
        // Debug: log all images in container
        const allContainerImages = Array.from(container.querySelectorAll('img'));
        const debugInfo = {
          containerTag: container.tagName,
          containerClasses: container.className,
          totalImagesInContainer: allContainerImages.length,
          imagesInContainer: allContainerImages.map(img => ({
            src: img.src,
            alt: img.alt,
            id: img.id,
            className: img.className
          }))
        };
        
        // Use the correct EdgeProp image selectors
        const imgSelectors = [
          'img[id="image-slider"]', // Primary selector for EdgeProp article images
          'img[class*="img-ver-align-moweb"]', // Class-based selector
          'img[src*="img.tepcdn.com"]', // EdgeProp CDN images
          'img[alt*="EDGEPROP SINGAPORE"]', // Images with EdgeProp alt text
          'img[src*="tepcdn.com"]', // All tepcdn images
          'img[src*="s3fs-public"]',
          'img[src*="edgeprop"]',
          'img[src*="amazonaws"]',
          'img[src*="cdn"]',
          'img[class*="thumbnail"]',
          'img[class*="featured"]',
          'img[class*="main"]',
          'img[class*="image"]',
          'img[class*="cover"]',
          'img'
        ];

        for (const selector of imgSelectors) {
          const imgs = container.querySelectorAll(selector);
          for (const img of imgs) {
            const src = img.getAttribute('src') ||
                       img.getAttribute('data-src') ||
                       img.getAttribute('data-lazy-src') ||
                       img.getAttribute('data-original') || '';

            if (src &&
                src.length > 10 &&
                !src.includes('logo') &&
                !src.includes('icon') &&
                !src.includes('avatar') &&
                !src.includes('placeholder') &&
                !src.includes('via.placeholder') &&
                !src.includes('menu_more') &&
                (src.startsWith('http') || src.startsWith('/'))) {

              // Make sure it's a complete URL
              if (src.startsWith('/')) {
                thumbnail = 'https://www.edgeprop.sg' + src;
              } else {
                thumbnail = src;
              }
              break;
            }
          }
          if (thumbnail !== 'https://via.placeholder.com/300x200/4F46E5/FFFFFF?text=EdgeProp+News') break;
        }

        return {
          index: index + 1,
          title,
          href,
          thumbnail,
          hasValidThumbnail: !thumbnail.includes('via.placeholder'),
          debugInfo
        };
      }).filter(Boolean);
    });

    console.log('📊 Thumbnail Extraction Results:');
    console.log('=' .repeat(80));
    
    let validThumbnails = 0;
    
    articles.forEach((article: unknown) => {
      console.log(`\n${article.index}. ${article.title}`);
      console.log(`   URL: ${article.href}`);
      console.log(`   Thumbnail: ${article.thumbnail}`);
      console.log(`   Valid: ${article.hasValidThumbnail ? '✅' : '❌'}`);
      console.log(`   Container: ${article.debugInfo.containerTag} (${article.debugInfo.containerClasses})`);
      console.log(`   Images in container: ${article.debugInfo.totalImagesInContainer}`);
      if (article.debugInfo.imagesInContainer.length > 0) {
        console.log(`   🔍 Images found:`);
        article.debugInfo.imagesInContainer.forEach((img: unknown, i: number) => {
          console.log(`      ${i + 1}. src: ${img.src}`);
          console.log(`         alt: ${img.alt}`);
          console.log(`         id: ${img.id}`);
          console.log(`         class: ${img.className}`);
        });
      }
      
      if (article.hasValidThumbnail) {
        validThumbnails++;
      }
    });

    const successRate = (validThumbnails / articles.length) * 100;
    
    console.log('\n' + '=' .repeat(80));
    console.log(`📈 Summary: ${validThumbnails}/${articles.length} articles have valid thumbnails (${successRate.toFixed(1)}% success rate)`);
    
    if (successRate >= 80) {
      console.log('🎉 Thumbnail extraction is working well!');
    } else if (successRate >= 50) {
      console.log('⚠️  Thumbnail extraction is partially working, but needs improvement.');
    } else {
      console.log('❌ Thumbnail extraction is not working well. Needs investigation.');
    }

  } catch (error) {
    console.error('❌ Error during thumbnail extraction test:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testThumbnailExtraction().catch(console.error);
