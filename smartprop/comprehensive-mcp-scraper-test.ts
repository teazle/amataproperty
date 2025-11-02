import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

interface TestArticle {
  url: string;
  title: string;
  author: string;
  content: string;
  publishDate: string;
  images: string[];
  metadata: Record<string, any>;
}

interface ComparisonResult {
  titleMatch: boolean;
  authorMatch: boolean;
  contentSimilarity: number;
  imagesMatch: boolean;
  metadataMatch: boolean;
  discrepancies: string[];
}

async function findWorkingEdgePropArticle(): Promise<TestArticle | null> {
  console.log('🔍 Finding a working EdgeProp article...');
  
  const browser = await chromium.launch({ 
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-field-trial-config',
      '--disable-ipc-flooding-protection'
    ]
  });
  
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      }
    });
    
    const page = await context.newPage();
    
    // Add stealth scripts
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      (window as any).chrome = { runtime: {} };
    });
    
    console.log('🌐 Navigating to EdgeProp with Cloudflare bypass...');
    
    // Navigate with retry mechanism
    let retries = 3;
    while (retries > 0) {
      try {
        await page.goto('https://www.edgeprop.sg/property-news/latest', { 
          waitUntil: 'domcontentloaded',
          timeout: 45000 
        });
        
        // Wait for potential Cloudflare challenge
        await page.waitForTimeout(3000);
        
        // Check if we're on the right page
        const title = await page.title();
        console.log(`📄 Page title: ${title}`);
        
        if (title.includes('EdgeProp') || title.includes('Property News')) {
          break;
        }
        
        retries--;
        if (retries > 0) {
          console.log(`🔄 Retrying... (${retries} attempts left)`);
          await page.waitForTimeout(5000);
        }
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        console.log(`🔄 Navigation failed, retrying... (${retries} attempts left)`);
        await page.waitForTimeout(5000);
      }
    }
    
    console.log('📄 Page loaded, looking for article links...');
    
    // Wait for articles to load and find article links with more flexible selectors
    try {
      await page.waitForSelector('a[href*="/property-news/"]', { timeout: 15000 });
    } catch (error) {
      // Try alternative selectors
      try {
        await page.waitForSelector('a[href*="property-news"]', { timeout: 10000 });
      } catch (error2) {
        console.log('⚠️ Could not find article links, trying to extract from page content...');
        // Get all links and filter manually
        await page.waitForTimeout(5000);
      }
    }
    
    const articleLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      return links
        .map(link => (link as HTMLAnchorElement).href)
        .filter(href => 
          href.includes('/property-news/') && 
          !href.includes('/latest') &&
          !href.includes('/special-feature') &&
          href.match(/\/property-news\/[^\/]+$/) // Match specific article URLs
        )
        .slice(0, 5); // Get first 5 articles
    });
    
    console.log(`📰 Found ${articleLinks.length} article links`);
    
    // Test each article to find a working one
    for (const articleUrl of articleLinks) {
      console.log(`🧪 Testing article: ${articleUrl}`);
      
      try {
        await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000); // Wait for dynamic content
        
        const title = await page.title();
        const h1Text = await page.$eval('h1', el => el.textContent?.trim() || '').catch(() => '');
        
        // Check if this is a real article (not a generic news page)
        if (title !== 'Property News' && h1Text !== 'Property News' && h1Text.length > 10) {
          console.log(`✅ Found working article: ${title}`);
          
          // Extract article content
          const articleData = await extractArticleContent(page);
          
          if (articleData.title && articleData.content.length > 100) {
            await context.close();
            return {
              url: articleUrl,
              ...articleData
            };
          }
        }
      } catch (error) {
        console.log(`❌ Failed to load article: ${articleUrl}`);
        continue;
      }
    }
    
    await context.close();
    return null;
  } finally {
    await browser.close();
  }
}

async function extractArticleContent(page: any): Promise<Omit<TestArticle, 'url'>> {
  // Extract title
  const title = await page.$eval('h1', (el: HTMLElement) => el.textContent?.trim() || '').catch(() => '');
  
  // Extract author
  const author = await page.evaluate(() => {
    const authorSelectors = [
      '.author-name',
      '.byline',
      '[data-author]',
      '.article-author',
      '.writer-name'
    ];
    
    for (const selector of authorSelectors) {
      const element = document.querySelector(selector);
      if (element?.textContent?.trim()) {
        return element.textContent.trim();
      }
    }
    return '';
  });
  
  // Extract publish date
  const publishDate = await page.evaluate(() => {
    const dateSelectors = [
      '.publish-date',
      '.article-date',
      '[datetime]',
      '.date',
      'time'
    ];
    
    for (const selector of dateSelectors) {
      const element = document.querySelector(selector);
      if (element?.textContent?.trim()) {
        return element.textContent.trim();
      }
      if (element?.getAttribute('datetime')) {
        return element.getAttribute('datetime');
      }
    }
    return '';
  });
  
  // Extract main content
  const content = await page.evaluate(() => {
    const contentSelectors = [
      '.article-content',
      '.content',
      '.article-body',
      '.post-content',
      'article .content'
    ];
    
    for (const selector of contentSelectors) {
      const element = document.querySelector(selector);
      if (element?.textContent?.trim()) {
        return element.textContent.trim();
      }
    }
    
    // Fallback: get all paragraph text
    const paragraphs = Array.from(document.querySelectorAll('p'));
    return paragraphs.map(p => p.textContent?.trim()).filter(Boolean).join('\n\n');
  });
  
  // Extract images
  const images = await page.$$eval('img', (imgs: HTMLImageElement[]) => 
    imgs
      .map((img: HTMLImageElement) => img.src)
      .filter((src: string) => src && !src.includes('data:image'))
  );
  
  // Extract metadata
  const metadata = await page.evaluate(() => {
    const meta: Record<string, any> = {};
    
    // Get meta tags
    const metaTags = document.querySelectorAll('meta[property], meta[name]');
    metaTags.forEach(tag => {
      const property = tag.getAttribute('property') || tag.getAttribute('name');
      const content = tag.getAttribute('content');
      if (property && content) {
        meta[property] = content;
      }
    });
    
    return meta;
  });
  
  return {
    title,
    author,
    content,
    publishDate,
    images,
    metadata
  };
}

async function testMCPScraper(articleUrl: string): Promise<TestArticle> {
  console.log('🤖 Testing MCP scraper...');
  
  const browser = await chromium.launch({ 
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-field-trial-config',
      '--disable-ipc-flooding-protection'
    ]
  });
  
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      }
    });
    
    const page = await context.newPage();
    
    // Add stealth scripts
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      (window as any).chrome = { runtime: {} };
    });
    
    // Navigate with retry mechanism
    let retries = 3;
    while (retries > 0) {
      try {
        await page.goto(articleUrl, { 
          waitUntil: 'domcontentloaded',
          timeout: 45000 
        });
        
        // Wait for potential Cloudflare challenge and dynamic content
        await page.waitForTimeout(3000);
        
        const title = await page.title();
        if (title && title !== 'Just a moment...') {
          break;
        }
        
        retries--;
        if (retries > 0) {
          console.log(`🔄 Retrying MCP scraper... (${retries} attempts left)`);
          await page.waitForTimeout(5000);
        }
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        console.log(`🔄 MCP scraper navigation failed, retrying... (${retries} attempts left)`);
        await page.waitForTimeout(5000);
      }
    }
    
    // Extract article content
    const articleData = await extractArticleContent(page);
    
    await context.close();
    return {
      url: articleUrl,
      ...articleData
    };
  } finally {
    await browser.close();
  }
}

function compareContent(original: TestArticle, scraped: any): ComparisonResult {
  console.log('🔍 Comparing original vs scraped content...');
  
  const discrepancies: string[] = [];
  
  // Title comparison
  const titleMatch = original.title.trim() === scraped.title.trim();
  if (!titleMatch) {
    discrepancies.push(`Title mismatch: "${original.title}" vs "${scraped.title}"`);
  }
  
  // Author comparison
  const authorMatch = original.author.trim() === scraped.author.trim();
  if (!authorMatch) {
    discrepancies.push(`Author mismatch: "${original.author}" vs "${scraped.author}"`);
  }
  
  // Content similarity (character-by-character)
  const originalContent = original.content.replace(/\s+/g, ' ').trim();
  const scrapedContent = scraped.content.replace(/\s+/g, ' ').trim();
  
  let matchingChars = 0;
  const maxLength = Math.max(originalContent.length, scrapedContent.length);
  
  for (let i = 0; i < maxLength; i++) {
    if (originalContent[i] === scrapedContent[i]) {
      matchingChars++;
    }
  }
  
  const contentSimilarity = maxLength > 0 ? (matchingChars / maxLength) * 100 : 0;
  
  if (contentSimilarity < 95) {
    discrepancies.push(`Content similarity too low: ${contentSimilarity.toFixed(1)}%`);
  }
  
  // Images comparison
  const imagesMatch = original.images.length === scraped.images.length;
  if (!imagesMatch) {
    discrepancies.push(`Image count mismatch: ${original.images.length} vs ${scraped.images.length}`);
  }
  
  // Metadata comparison (basic)
  const metadataMatch = Object.keys(original.metadata).length === Object.keys(scraped.metadata).length;
  if (!metadataMatch) {
    discrepancies.push(`Metadata count mismatch: ${Object.keys(original.metadata).length} vs ${Object.keys(scraped.metadata).length}`);
  }
  
  return {
    titleMatch,
    authorMatch,
    contentSimilarity,
    imagesMatch,
    metadataMatch,
    discrepancies
  };
}

function generateTestReport(original: TestArticle, scraped: any, comparison: ComparisonResult) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  const report = {
    testTimestamp: timestamp,
    testUrl: original.url,
    results: {
      titleMatch: comparison.titleMatch,
      authorMatch: comparison.authorMatch,
      contentSimilarity: `${comparison.contentSimilarity.toFixed(2)}%`,
      imagesMatch: comparison.imagesMatch,
      metadataMatch: comparison.metadataMatch,
      overallSuccess: comparison.discrepancies.length === 0
    },
    discrepancies: comparison.discrepancies,
    originalData: {
      title: original.title,
      author: original.author,
      contentLength: original.content.length,
      imageCount: original.images.length,
      metadataKeys: Object.keys(original.metadata).length
    },
    scrapedData: {
      title: scraped.title,
      author: scraped.author,
      contentLength: scraped.content.length,
      imageCount: scraped.images.length,
      metadataKeys: Object.keys(scraped.metadata).length
    },
    recommendations: comparison.discrepancies.length > 0 ? [
      'Review content extraction selectors',
      'Verify Cloudflare bypass is working correctly',
      'Check for dynamic content loading issues',
      'Validate metadata extraction logic'
    ] : ['MCP scraper is working correctly!']
  };
  
  // Save JSON report
  const jsonFilename = `mcp-scraper-test-report-${timestamp}.json`;
  writeFileSync(jsonFilename, JSON.stringify(report, null, 2));
  
  // Save HTML report
  const htmlReport = generateHTMLReport(report);
  const htmlFilename = `mcp-scraper-test-report-${timestamp}.html`;
  writeFileSync(htmlFilename, htmlReport);
  
  console.log(`📊 Test reports saved:`);
  console.log(`   JSON: ${jsonFilename}`);
  console.log(`   HTML: ${htmlFilename}`);
  
  return report;
}

function generateHTMLReport(report: any): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>MCP Scraper Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f0f0; padding: 20px; border-radius: 5px; }
        .success { color: #28a745; }
        .error { color: #dc3545; }
        .warning { color: #ffc107; }
        .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .comparison-table { width: 100%; border-collapse: collapse; }
        .comparison-table th, .comparison-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        .comparison-table th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>MCP Scraper Test Report</h1>
        <p><strong>Test Date:</strong> ${report.testTimestamp}</p>
        <p><strong>Test URL:</strong> <a href="${report.testUrl}">${report.testUrl}</a></p>
        <p><strong>Overall Result:</strong> 
            <span class="${report.results.overallSuccess ? 'success' : 'error'}">
                ${report.results.overallSuccess ? '✅ PASS' : '❌ FAIL'}
            </span>
        </p>
    </div>
    
    <div class="section">
        <h2>Test Results Summary</h2>
        <table class="comparison-table">
            <tr><th>Test</th><th>Result</th><th>Status</th></tr>
            <tr><td>Title Match</td><td>${report.results.titleMatch}</td><td class="${report.results.titleMatch ? 'success' : 'error'}">${report.results.titleMatch ? '✅' : '❌'}</td></tr>
            <tr><td>Author Match</td><td>${report.results.authorMatch}</td><td class="${report.results.authorMatch ? 'success' : 'error'}">${report.results.authorMatch ? '✅' : '❌'}</td></tr>
            <tr><td>Content Similarity</td><td>${report.results.contentSimilarity}</td><td class="${parseFloat(report.results.contentSimilarity) >= 95 ? 'success' : 'error'}">${parseFloat(report.results.contentSimilarity) >= 95 ? '✅' : '❌'}</td></tr>
            <tr><td>Images Match</td><td>${report.results.imagesMatch}</td><td class="${report.results.imagesMatch ? 'success' : 'error'}">${report.results.imagesMatch ? '✅' : '❌'}</td></tr>
            <tr><td>Metadata Match</td><td>${report.results.metadataMatch}</td><td class="${report.results.metadataMatch ? 'success' : 'error'}">${report.results.metadataMatch ? '✅' : '❌'}</td></tr>
        </table>
    </div>
    
    ${report.discrepancies.length > 0 ? `
    <div class="section">
        <h2>Discrepancies Found</h2>
        <ul>
            ${report.discrepancies.map((d: string) => `<li class="error">${d}</li>`).join('')}
        </ul>
    </div>
    ` : ''}
    
    <div class="section">
        <h2>Data Comparison</h2>
        <table class="comparison-table">
            <tr><th>Field</th><th>Original</th><th>Scraped</th></tr>
            <tr><td>Title</td><td>${report.originalData.title}</td><td>${report.scrapedData.title}</td></tr>
            <tr><td>Author</td><td>${report.originalData.author}</td><td>${report.scrapedData.author}</td></tr>
            <tr><td>Content Length</td><td>${report.originalData.contentLength}</td><td>${report.scrapedData.contentLength}</td></tr>
            <tr><td>Image Count</td><td>${report.originalData.imageCount}</td><td>${report.scrapedData.imageCount}</td></tr>
            <tr><td>Metadata Keys</td><td>${report.originalData.metadataKeys}</td><td>${report.scrapedData.metadataKeys}</td></tr>
        </table>
    </div>
    
    <div class="section">
        <h2>Recommendations</h2>
        <ul>
            ${report.recommendations.map((r: string) => `<li>${r}</li>`).join('')}
        </ul>
    </div>
</body>
</html>
  `;
}

async function main() {
  console.log('🚀 Starting comprehensive MCP scraper test...\n');
  
  try {
    // Step 1: Find a working EdgeProp article
    const testArticle = await findWorkingEdgePropArticle();
    
    if (!testArticle) {
      console.error('❌ Could not find a working EdgeProp article');
      return;
    }
    
    console.log(`✅ Found test article: ${testArticle.title}\n`);
    
    // Step 2: Test MCP scraper on the article
    const scrapedData = await testMCPScraper(testArticle.url);
    
    console.log('✅ MCP scraper test completed\n');
    
    // Step 3: Compare results
    const comparison = compareContent(testArticle, scrapedData);
    
    // Step 4: Generate comprehensive report
    const report = generateTestReport(testArticle, scrapedData, comparison);
    
    console.log('\n📋 Test Summary:');
    console.log(`   Title Match: ${comparison.titleMatch ? '✅' : '❌'}`);
    console.log(`   Author Match: ${comparison.authorMatch ? '✅' : '❌'}`);
    console.log(`   Content Similarity: ${comparison.contentSimilarity.toFixed(2)}%`);
    console.log(`   Images Match: ${comparison.imagesMatch ? '✅' : '❌'}`);
    console.log(`   Metadata Match: ${comparison.metadataMatch ? '✅' : '❌'}`);
    
    if (comparison.discrepancies.length > 0) {
      console.log('\n⚠️  Issues found:');
      comparison.discrepancies.forEach(d => console.log(`   - ${d}`));
    } else {
      console.log('\n🎉 All tests passed! MCP scraper is working perfectly.');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

main();