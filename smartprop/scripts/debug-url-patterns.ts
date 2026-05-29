#!/usr/bin/env tsx

/**
 * Debug script to examine URL patterns on EdgeProp latest news page
 */

async function debugUrlPatterns() {
  console.log('🔍 Debugging EdgeProp URL patterns...\n');
  
  try {
    const { chromium } = await import('playwright');
    
    const browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();
    
    console.log('📄 Navigating to EdgeProp latest news...');
    await page.goto('https://www.edgeprop.sg/news/latest', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    await page.waitForTimeout(5000);
    
    // Get all links and analyze their patterns
    const allLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      return links.map(link => ({
        href: link.getAttribute('href'),
        text: link.textContent?.trim().substring(0, 100),
        hasImage: link.querySelector('img') !== null,
        parentClass: link.parentElement?.className || '',
        linkClass: link.className || ''
      })).filter(link => link.href && link.text && link.text.length > 5);
    });
    
    console.log(`\n🔗 Found ${allLinks.length} total links with text:`);
    
    // Group by URL patterns
    const patterns = new Map<string, unknown[]>();
    
    allLinks.forEach(link => {
      const href = link.href || '';
      let pattern = 'other';
      
      if (href.includes('/property-news/')) {
        pattern = 'property-news';
      } else if (href.includes('/news/')) {
        pattern = 'news';
      } else if (href.includes('/article/')) {
        pattern = 'article';
      } else if (href.includes('/property/')) {
        pattern = 'property';
      } else if (href.includes('edgeprop.sg') && !href.includes('edgeprop.sg/news/latest')) {
        pattern = 'edgeprop-other';
      }
      
      if (!patterns.has(pattern)) {
        patterns.set(pattern, []);
      }
      patterns.get(pattern)!.push(link);
    });
    
    // Display patterns
    for (const [pattern, links] of patterns.entries()) {
      console.log(`\n📂 Pattern "${pattern}": ${links.length} links`);
      
      // Show first 5 examples
      links.slice(0, 5).forEach((link, index) => {
        console.log(`   ${index + 1}. "${link.text}"`);
        console.log(`      URL: ${link.href}`);
        console.log(`      Has image: ${link.hasImage}`);
        console.log(`      Parent class: ${link.parentClass}`);
        console.log(`      Link class: ${link.linkClass}`);
        console.log('');
      });
      
      if (links.length > 5) {
        console.log(`      ... and ${links.length - 5} more\n`);
      }
    }
    
    // Look specifically for news articles
    const newsArticles = allLinks.filter(link => {
      const href = link.href || '';
      const text = link.text || '';
      
      // Look for links that seem like news articles
      return (
        (href.includes('/news/') || href.includes('/article/') || href.includes('/property-news/')) &&
        text.length > 10 &&
        !text.toLowerCase().includes('latest') &&
        !text.toLowerCase().includes('category') &&
        !text.toLowerCase().includes('more') &&
        !text.toLowerCase().includes('view all') &&
        !text.toLowerCase().includes('subscribe') &&
        link.hasImage
      );
    });
    
    console.log(`\n📰 Potential news articles (with images): ${newsArticles.length}`);
    newsArticles.slice(0, 10).forEach((article, index) => {
      console.log(`   ${index + 1}. "${article.text}"`);
      console.log(`      URL: ${article.href}`);
      console.log('');
    });
    
    // Check the page structure for article containers
    const containerInfo = await page.evaluate(() => {
      // Look for common article container patterns
      const containerSelectors = [
        'article',
        '.article',
        '.news-item',
        '.post',
        '.card',
        '[class*="article"]',
        '[class*="news"]',
        '[class*="post"]',
        '[class*="item"]',
        '[class*="card"]',
        'div[class*="jsx-"]'
      ];
      
      const results: unknown[] = [];
      
      containerSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          results.push({
            selector,
            count: elements.length,
            hasLinks: Array.from(elements).some(el => el.querySelector('a[href]')),
            hasImages: Array.from(elements).some(el => el.querySelector('img')),
            sampleClasses: Array.from(elements).slice(0, 3).map(el => el.className).filter(c => c)
          });
        }
      });
      
      return results;
    });
    
    console.log(`\n📦 Container analysis:`);
    containerInfo.forEach(info => {
      console.log(`   ${info.selector}: ${info.count} elements`);
      console.log(`      Has links: ${info.hasLinks}, Has images: ${info.hasImages}`);
      if (info.sampleClasses.length > 0) {
        console.log(`      Sample classes: ${info.sampleClasses.join(', ')}`);
      }
      console.log('');
    });
    
    await browser.close();
    
  } catch (error) {
    console.error('\n❌ Debug failed:', error);
  }
}

// Run the debug
debugUrlPatterns().catch(console.error);