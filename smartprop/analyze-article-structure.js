/**
 * Analyze specific EdgeProp article structure to identify correct selectors
 */

const { chromium } = require('playwright');

async function analyzeArticleStructure() {
  console.log('🔍 Analyzing EdgeProp article structure...');
  
  const browser = await chromium.launch({ 
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--disable-dev-shm-usage'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  try {
    // Test with the real article URL we found
    const articleUrl = 'https://www.edgeprop.sg/property-news/asia-pacific-data-centre-association-pushes-stronger-sustainability-frameworks';
    
    console.log(`📍 Navigating to article: ${articleUrl}`);
    await page.goto(articleUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    await page.waitForTimeout(3000);
    
    // Take screenshot
    await page.screenshot({ 
      path: 'edgeprop-article-structure.png', 
      fullPage: true 
    });
    console.log('📷 Saved article structure screenshot');
    
    // Analyze the article structure
    const articleAnalysis = await page.evaluate(() => {
      const analysis = {
        pageTitle: document.title,
        currentUrl: window.location.href,
        
        // Look for article title
        articleTitles: [],
        
        // Look for article content
        contentElements: [],
        
        // Look for author information
        authorElements: [],
        
        // Look for date information
        dateElements: [],
        
        // Look for images
        imageElements: [],
        
        // General structure analysis
        mainContent: null,
        articleContainer: null
      };
      
      // Find article titles
      const titleSelectors = ['h1', '.article-title', '[class*="title"]', '.headline', '.post-title'];
      titleSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            if (el.textContent && el.textContent.trim().length > 10) {
              analysis.articleTitles.push({
                selector: selector,
                text: el.textContent.trim(),
                className: el.className,
                tagName: el.tagName
              });
            }
          });
        } catch (e) {}
      });
      
      // Find content elements
      const contentSelectors = [
        '.article-content', 
        '.post-content', 
        '.content', 
        '[class*="content"]',
        '.article-body',
        '.post-body',
        'article',
        '.story-content',
        '.news-content'
      ];
      
      contentSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            const textLength = (el.textContent || '').trim().length;
            if (textLength > 100) { // Only consider substantial content
              analysis.contentElements.push({
                selector: selector,
                textLength: textLength,
                className: el.className,
                tagName: el.tagName,
                childrenCount: el.children.length,
                preview: (el.textContent || '').trim().substring(0, 200) + '...'
              });
            }
          });
        } catch (e) {}
      });
      
      // Find author elements
      const authorSelectors = [
        '.author', 
        '.byline', 
        '[class*="author"]', 
        '[class*="byline"]',
        '.writer',
        '.journalist',
        '.reporter'
      ];
      
      authorSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            const text = (el.textContent || '').trim();
            if (text && text.length > 2 && text.length < 100) {
              analysis.authorElements.push({
                selector: selector,
                text: text,
                className: el.className,
                tagName: el.tagName
              });
            }
          });
        } catch (e) {}
      });
      
      // Find date elements
      const dateSelectors = [
        '.date', 
        '.published', 
        '[class*="date"]', 
        '[class*="time"]',
        'time',
        '.timestamp'
      ];
      
      dateSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            const text = (el.textContent || '').trim();
            const datetime = el.getAttribute('datetime');
            if (text || datetime) {
              analysis.dateElements.push({
                selector: selector,
                text: text,
                datetime: datetime,
                className: el.className,
                tagName: el.tagName
              });
            }
          });
        } catch (e) {}
      });
      
      // Find images in article
      const images = document.querySelectorAll('img');
      images.forEach(img => {
        const src = img.getAttribute('src');
        const alt = img.getAttribute('alt');
        if (src && !src.includes('logo') && !src.includes('icon')) {
          analysis.imageElements.push({
            src: src,
            alt: alt || '',
            className: img.className,
            width: img.width,
            height: img.height
          });
        }
      });
      
      // Try to identify main content container
      const mainSelectors = ['main', '.main', '#main', 'article', '.article', '#article'];
      for (const selector of mainSelectors) {
        try {
          const element = document.querySelector(selector);
          if (element) {
            analysis.mainContent = {
              selector: selector,
              className: element.className,
              textLength: (element.textContent || '').length
            };
            break;
          }
        } catch (e) {}
      }
      
      return analysis;
    });
    
    console.log('\n📊 Article Structure Analysis:');
    console.log(`   Title: ${articleAnalysis.pageTitle}`);
    console.log(`   URL: ${articleAnalysis.currentUrl}`);
    
    console.log(`\n📝 Article Titles Found: ${articleAnalysis.articleTitles.length}`);
    articleAnalysis.articleTitles.forEach((title, i) => {
      console.log(`   ${i + 1}. ${title.selector}: "${title.text.substring(0, 80)}..."`);
    });
    
    console.log(`\n📄 Content Elements Found: ${articleAnalysis.contentElements.length}`);
    articleAnalysis.contentElements.forEach((content, i) => {
      console.log(`   ${i + 1}. ${content.selector} (${content.textLength} chars): "${content.preview}"`);
    });
    
    console.log(`\n👤 Author Elements Found: ${articleAnalysis.authorElements.length}`);
    articleAnalysis.authorElements.forEach((author, i) => {
      console.log(`   ${i + 1}. ${author.selector}: "${author.text}"`);
    });
    
    console.log(`\n📅 Date Elements Found: ${articleAnalysis.dateElements.length}`);
    articleAnalysis.dateElements.forEach((date, i) => {
      console.log(`   ${i + 1}. ${date.selector}: "${date.text}" (datetime: ${date.datetime})`);
    });
    
    console.log(`\n🖼️  Images Found: ${articleAnalysis.imageElements.length}`);
    articleAnalysis.imageElements.slice(0, 3).forEach((img, i) => {
      console.log(`   ${i + 1}. ${img.src} (alt: "${img.alt}")`);
    });
    
    if (articleAnalysis.mainContent) {
      console.log(`\n🎯 Main Content Container: ${articleAnalysis.mainContent.selector} (${articleAnalysis.mainContent.textLength} chars)`);
    }
    
    // Keep browser open for manual inspection
    console.log('\n⏳ Keeping browser open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);
    
  } catch (error) {
    console.error('❌ Error during analysis:', error);
  } finally {
    await browser.close();
  }
}

analyzeArticleStructure().catch(console.error);