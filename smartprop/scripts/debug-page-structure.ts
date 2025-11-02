import { chromium } from 'playwright';

async function debugPageStructure() {
  console.log('🚀 Starting EdgeProp page structure analysis...');
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    // Go to EdgeProp homepage
    console.log('🔍 Going to EdgeProp homepage...');
    await page.goto('https://www.edgeprop.sg/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Find article links on homepage
    const articleLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      console.log(`Total links found: ${links.length}`);
      
      // Look for news/article links
      const newsLinks = links.filter(link => {
        const href = link.getAttribute('href');
        const text = link.textContent?.trim() || '';
        return href && (
          href.includes('/news/') || 
          href.includes('/property-news/') ||
          (text.length > 20 && !href.includes('mailto') && !href.includes('tel:') && href.includes('/'))
        );
      });
      
      console.log(`Found ${newsLinks.length} potential news links`);
      newsLinks.slice(0, 5).forEach((link, i) => {
        console.log(`${i + 1}. ${link.getAttribute('href')} - "${link.textContent?.trim().substring(0, 50)}"`);
      });
      
      return newsLinks.length > 0 ? newsLinks[0].getAttribute('href') : null;
    });
    
    if (!articleLink) {
      console.log('❌ Could not find any article links on homepage');
      
      // Try a known article URL pattern
      const testUrl = 'https://www.edgeprop.sg/news/singapore-property-market-trends-2024';
      console.log(`🔄 Trying test URL: ${testUrl}`);
      await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    } else {
      const fullArticleUrl = articleLink.startsWith('http') ? articleLink : `https://www.edgeprop.sg${articleLink}`;
      console.log(`🎯 Found article: ${fullArticleUrl}`);
      
      // Navigate to the article
      await page.goto(fullArticleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    }
    
    // Take screenshot
    await page.screenshot({ path: 'debug-page.png', fullPage: false });
    console.log('📸 Screenshot saved as debug-page.png');
    
    // Analyze page structure
    const analysis = await page.evaluate(() => {
      const result = {
        title: document.title,
        url: window.location.href,
        h1Elements: [] as any[],
        author: undefined as string | undefined,
        dateElements: [] as string[],
        contentDivs: 0,
        paragraphs: 0,
        mainContent: undefined as string | undefined,
        selectors: {} as any,
        bodyClasses: document.body.className,
        allParagraphs: [] as string[]
      };
      
      // H1 elements
      document.querySelectorAll('h1').forEach((h1, index) => {
        result.h1Elements.push({
          text: h1.textContent?.trim().substring(0, 100),
          className: h1.className,
          parent: h1.parentElement?.tagName + (h1.parentElement?.className ? '.' + h1.parentElement.className : '')
        });
      });
      
      // Look for author patterns
      const authorSelectors = [
        '[class*="author"]',
        '[class*="byline"]',
        '.writer',
        '.journalist',
        '[class*="writer"]'
      ];
      
      for (const selector of authorSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent) {
          result.author = element.textContent.trim();
          break;
        }
      }
      
      // Date elements
      document.querySelectorAll('time, [class*="date"], [class*="publish"]').forEach(el => {
        if (el.textContent?.trim()) {
          result.dateElements.push(el.textContent.trim());
        }
      });
      
      // Content analysis
      result.contentDivs = document.querySelectorAll('div').length;
      result.paragraphs = document.querySelectorAll('p').length;
      
      // Get all paragraphs for analysis
      document.querySelectorAll('p').forEach(p => {
        const text = p.textContent?.trim();
        if (text && text.length > 20) {
          result.allParagraphs.push(text.substring(0, 100));
        }
      });
      
      // Main content
      const contentSelectors = [
        'article',
        '[class*="article-content"]',
        '[class*="article-body"]',
        '[class*="content"]',
        '.main-content',
        '#content',
        'main'
      ];
      
      for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent && element.textContent.length > 100) {
          result.mainContent = element.textContent.trim().substring(0, 300) + '...';
          break;
        }
      }
      
      // Test common selectors
      const testSelectors = [
        '.content',
        '[class*="article"]',
        '[class*="content"]',
        'h1',
        'h2',
        '.title',
        'article p',
        '.article-body p',
        '[class*="body"] p',
        'p'
      ];
      
      testSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          const firstEl = elements[0];
          result.selectors[selector] = {
            count: elements.length,
            firstText: firstEl.textContent?.trim().substring(0, 100) + '...',
            className: firstEl.className
          };
        }
      });
      
      return result;
    });
    
    console.log('\n📊 Page Structure Analysis:');
    console.log('═══════════════════════════════════════');
    console.log(`Page Title: ${analysis.title}`);
    console.log(`Current URL: ${analysis.url}`);
    console.log(`Body Classes: ${analysis.bodyClasses}`);
    
    console.log('\n🎯 H1 Elements:');
    analysis.h1Elements.forEach((h1, index) => {
      console.log(`  ${index + 1}. "${h1.text}" (${h1.className}) - Parent: ${h1.parent}`);
    });
    
    console.log('\n🔍 EdgeProp Patterns:');
    console.log(`  Author: ${analysis.author}`);
    console.log(`  Date Elements: ${JSON.stringify(analysis.dateElements)}`);
    console.log(`  Content Divs: ${analysis.contentDivs}`);
    console.log(`  Paragraphs: ${analysis.paragraphs}`);
    console.log(`  Main Content Preview: ${analysis.mainContent}`);
    
    console.log('\n📋 Found Selectors:');
    Object.entries(analysis.selectors).forEach(([selector, data]: [string, any]) => {
      console.log(`  ${selector}: ${data.count} elements - "${data.firstText}" (${data.className})`);
    });
    
    console.log('\n📝 Sample Paragraphs:');
    analysis.allParagraphs.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}. "${p}..."`);
    });
    
    console.log('\n⏸️  Browser will stay open for manual inspection. Press Ctrl+C to close.');
    
    // Keep browser open for manual inspection
    await new Promise(() => {});
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

debugPageStructure().catch(console.error);