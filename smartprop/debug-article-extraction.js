const { chromium } = require('playwright');

async function debugArticleExtraction() {
  console.log('=== DEBUGGING ARTICLE EXTRACTION ===');
  
  const browser = await chromium.launch({ 
    headless: false,
    channel: 'chromium'
  });
  
  const page = await browser.newPage();
  
  // Navigate to the listing page
  await page.goto('https://www.edgeprop.sg/property-news/latest', { 
    waitUntil: 'domcontentloaded',
    timeout: 30000 
  });
  
  // Wait for jsx elements to load
  let jsx2211414346Count = 0;
  for (let attempt = 1; attempt <= 10; attempt++) {
    jsx2211414346Count = await page.$$eval('.jsx-2211414346', els => els.length).catch(() => 0);
    console.log(`Attempt ${attempt}: Found ${jsx2211414346Count} jsx elements`);
    if (jsx2211414346Count > 100) break;
    await page.waitForTimeout(2000);
  }
  
  // Simulate the exact scraper logic
  const extractionResult = await page.evaluate(() => {
    console.log('🔍 Starting article extraction simulation...');
    
    // Find article containers
    let articleContainers = Array.from(document.querySelectorAll('div[class*="jsx-2211414346"]'));
    console.log(`✅ Found ${articleContainers.length} article containers with jsx-2211414346`);
    
    const uniqueHrefs = new Map();
    const debugInfo = [];
    
    // Process first 5 containers for debugging
    for (let index = 0; index < Math.min(5, articleContainers.length); index++) {
      const container = articleContainers[index];
      
      // Find all article links in this container
      const allLinks = Array.from(container.querySelectorAll('a[href*="/property-news/"]'));
      const articleLinks = allLinks.filter(link => {
        const href = link.getAttribute('href') || '';
        return href.includes('/property-news/') && 
               !href.includes('/property-news-search') &&
               !href.includes('/property-news/latest') &&
               !href.includes('/property-news/news') &&
               !href.includes('/property-news/in-depth') &&
               !href.includes('/property-news/showcase') &&
               !href.includes('/property-news/deal-watch') &&
               !href.includes('/property-news/international') &&
               !href.includes('/property-news/personality') &&
               !href.includes('/property-news/mandarin') &&
               href.split('/').length >= 5;
      });
      
      let articleHref = '';
      let title = '';
      let category = '';
      
      // Sort links by text length
      const sortedLinks = articleLinks.sort((a, b) => (b.textContent?.trim().length || 0) - (a.textContent?.trim().length || 0));
      
      const linkDetails = sortedLinks.map(link => ({
        href: link.getAttribute('href'),
        text: link.textContent?.trim(),
        textLength: link.textContent?.trim().length || 0
      }));
      
      sortedLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        const text = link.textContent?.trim() || '';
        
        // Get the article href (first valid article link)
        if (href && !articleHref) {
          articleHref = href;
        }
        
        // Get category
        if (['PROPERTY NEWS', 'DEAL WATCH', 'PERSONALITY', 'SPECIAL FEATURE', 'NEWS / IN DEPTH', 'NEWS / INTERNATIONAL'].includes(text)) {
          category = text;
        }
        
        // Get title (long text, not category, not "EDGEPROP SINGAPORE")
        if (text && text.length > 50 && !text.includes('EDGEPROP SINGAPORE') && !text.includes('PROPERTY NEWS') && !text.includes('PERSONALITY') && !text.includes('SPECIAL FEATURE')) {
          if (!title || text.length > title.length) {
            title = text;
          }
        }
      });
      
      // Fallback: if no title found from links, try to get it from h2, h3, or heading tags
      let fallbackTitle = '';
      if (!title || title.length < 20) {
        const heading = container.querySelector('h2, h3, h4, [class*="title"], [class*="heading"]');
        if (heading) {
          const headingText = heading.textContent?.trim() || '';
          if (headingText && headingText.length > 20 && !headingText.includes('EDGEPROP SINGAPORE')) {
            fallbackTitle = headingText;
            title = headingText;
          }
        }
      }
      
      const debugEntry = {
        containerIndex: index,
        allLinksCount: allLinks.length,
        articleLinksCount: articleLinks.length,
        linkDetails: linkDetails.slice(0, 3), // First 3 links
        articleHref,
        title,
        titleLength: title.length,
        category,
        fallbackTitle,
        willBeAdded: !!(articleHref && title && title.length > 10)
      };
      
      debugInfo.push(debugEntry);
      
      // Add to uniqueHrefs if valid
      const normalizedHref = articleHref.replace(/^https?:\/\/www\.edgeprop\.sg/, '').replace(/^([^/])/, '/$1');
      if (normalizedHref && normalizedHref.includes('/property-news/') && !uniqueHrefs.has(normalizedHref)) {
        uniqueHrefs.set(normalizedHref, {
          href: normalizedHref,
          title: title,
          category: category,
          index: index
        });
      }
    }
    
    return {
      totalContainers: articleContainers.length,
      uniqueArticles: uniqueHrefs.size,
      debugInfo: debugInfo
    };
  });
  
  console.log('Extraction Result:', JSON.stringify(extractionResult, null, 2));
  
  await browser.close();
}

debugArticleExtraction().catch(console.error);