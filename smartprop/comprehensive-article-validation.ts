#!/usr/bin/env bun

import { chromium, Browser, Page } from 'playwright';
import { scrapeArticleContent } from './src/lib/scraper/edgeprop-content-scraper';
import fs from 'fs';
import path from 'path';

// Test article details
const TEST_ARTICLE = {
  title: "Singapore property market outlook 2024: Experts weigh in on trends and predictions",
  url: "https://www.edgeprop.sg/property-news/singapore-property-market-outlook-2024-experts-weigh-in-on-trends-and-predictions",
  nid: "mcp-1761694828711-18-kkjqhqhqr"
};

interface ValidationResult {
  timestamp: string;
  testArticle: typeof TEST_ARTICLE;
  originalContent: {
    title: string;
    author: string;
    publishedDate: string;
    textContent: string;
    paragraphCount: number;
    imageCount: number;
    linkCount: number;
    wordCount: number;
  };
  scrapedContent: any;
  comparison: {
    titleMatch: boolean;
    authorMatch: boolean;
    dateMatch: boolean;
    contentSimilarity: number;
    paragraphCountMatch: boolean;
    imageCountMatch: boolean;
    linkCountMatch: boolean;
  };
  issues: string[];
  recommendations: string[];
  screenshots: {
    original: string;
    scraped: string;
  };
}

async function extractOriginalContent(page: Page) {
  return await page.evaluate(() => {
    // Extract title
    const title = document.querySelector('h1')?.textContent?.trim() || 
                  document.querySelector('.article-title')?.textContent?.trim() ||
                  document.querySelector('[class*="title"]')?.textContent?.trim() || '';

    // Extract author
    let author = '';
    const authorSelectors = [
      '[class*="author"]',
      '[class*="byline"]',
      '.meta-author',
      '.article-author',
      '.post-author',
      '[data-author]'
    ];
    
    for (const selector of authorSelectors) {
      const authorEl = document.querySelector(selector);
      if (authorEl?.textContent?.trim()) {
        author = authorEl.textContent.trim();
        break;
      }
    }

    // Look for "By" text if no dedicated author element
    if (!author) {
      const allElements = Array.from(document.querySelectorAll('div, span, p, time'));
      for (const el of allElements) {
        const text = el.textContent?.trim() || '';
        if (text.includes('By ') && text.length < 100) {
          author = text.replace(/^.*By\s+/, '').replace(/\s*\|.*$/, '').trim();
          break;
        }
      }
    }

    // Extract published date
    let publishedDate = '';
    const dateSelectors = [
      'time[datetime]',
      '[class*="date"]',
      '[class*="publish"]',
      '.meta-date',
      '.article-date'
    ];
    
    for (const selector of dateSelectors) {
      const dateEl = document.querySelector(selector);
      if (dateEl) {
        publishedDate = dateEl.getAttribute('datetime') || dateEl.textContent?.trim() || '';
        if (publishedDate) break;
      }
    }

    // Extract main content
    const contentSelectors = [
      '.article-content',
      '.post-content',
      '[class*="content"]',
      '.entry-content',
      'article',
      'main'
    ];
    
    let textContent = '';
    let paragraphCount = 0;
    
    for (const selector of contentSelectors) {
      const contentEl = document.querySelector(selector);
      if (contentEl) {
        textContent = contentEl.textContent?.trim() || '';
        paragraphCount = contentEl.querySelectorAll('p').length;
        if (textContent.length > 100) break;
      }
    }

    // Count images in content
    const imageCount = document.querySelectorAll('img').length;

    // Count links in content
    const linkCount = document.querySelectorAll('a').length;

    // Calculate word count
    const wordCount = textContent.split(/\s+/).filter(word => word.length > 0).length;

    return {
      title,
      author,
      publishedDate,
      textContent,
      paragraphCount,
      imageCount,
      linkCount,
      wordCount
    };
  });
}

function calculateContentSimilarity(original: string, scraped: string): number {
  if (!original || !scraped) return 0;
  
  const originalWords = original.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const scrapedWords = scraped.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  
  const commonWords = originalWords.filter(word => scrapedWords.includes(word));
  const totalUniqueWords = new Set([...originalWords, ...scrapedWords]).size;
  
  return totalUniqueWords > 0 ? (commonWords.length * 2) / totalUniqueWords : 0;
}

async function takeScreenshot(page: Page, filename: string): Promise<string> {
  const screenshotDir = path.join(process.cwd(), 'test-results');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  
  const screenshotPath = path.join(screenshotDir, filename);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function generateReport(result: ValidationResult) {
  const timestamp = Date.now();
  const resultsDir = path.join(process.cwd(), 'test-results');
  
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  // Generate JSON report
  const jsonPath = path.join(resultsDir, `article-validation-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

  // Generate HTML report
  const htmlPath = path.join(resultsDir, `article-validation-${timestamp}.html`);
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Article Validation Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .content { padding: 30px; }
        .section { margin-bottom: 30px; }
        .comparison-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
        .comparison-item { background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #007bff; }
        .issue { background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .success { background: #d4edda; border-left: 4px solid #28a745; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .metric { display: inline-block; background: #e9ecef; padding: 8px 12px; margin: 4px; border-radius: 20px; font-size: 14px; }
        .screenshot { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; margin: 10px 0; }
        .similarity-bar { background: #e9ecef; height: 20px; border-radius: 10px; overflow: hidden; margin: 10px 0; }
        .similarity-fill { height: 100%; background: linear-gradient(90deg, #dc3545 0%, #ffc107 50%, #28a745 100%); transition: width 0.3s ease; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 Article Validation Report</h1>
            <p>Comprehensive comparison between original article and scraped content</p>
            <p><strong>Test Article:</strong> ${result.testArticle.title}</p>
            <p><strong>Generated:</strong> ${new Date(result.timestamp).toLocaleString()}</p>
        </div>
        
        <div class="content">
            <div class="section">
                <h2>📊 Content Comparison</h2>
                <div class="comparison-grid">
                    <div class="comparison-item">
                        <h3>📰 Original Content</h3>
                        <p><strong>Title:</strong> ${result.originalContent.title}</p>
                        <p><strong>Author:</strong> ${result.originalContent.author}</p>
                        <p><strong>Published:</strong> ${result.originalContent.publishedDate}</p>
                        <div class="metric">📝 ${result.originalContent.wordCount} words</div>
                        <div class="metric">📄 ${result.originalContent.paragraphCount} paragraphs</div>
                        <div class="metric">🖼️ ${result.originalContent.imageCount} images</div>
                        <div class="metric">🔗 ${result.originalContent.linkCount} links</div>
                    </div>
                    <div class="comparison-item">
                        <h3>🤖 Scraped Content</h3>
                        <p><strong>Title:</strong> ${result.scrapedContent.title}</p>
                        <p><strong>Author:</strong> ${result.scrapedContent.author}</p>
                        <p><strong>Published:</strong> ${result.scrapedContent.published_date}</p>
                        <div class="metric">📝 ${result.scrapedContent.word_count} words</div>
                        <div class="metric">📄 ${result.scrapedContent.paragraphs?.length || 0} paragraphs</div>
                        <div class="metric">🖼️ ${result.scrapedContent.images?.length || 0} images</div>
                        <div class="metric">🔗 ${result.scrapedContent.links?.length || 0} links</div>
                    </div>
                </div>
                
                <h3>📈 Content Similarity</h3>
                <div class="similarity-bar">
                    <div class="similarity-fill" style="width: ${result.comparison.contentSimilarity * 100}%"></div>
                </div>
                <p>${(result.comparison.contentSimilarity * 100).toFixed(1)}% content similarity</p>
            </div>

            <div class="section">
                <h2>✅ Validation Results</h2>
                ${result.comparison.titleMatch ? '<div class="success">✅ Title matches</div>' : '<div class="issue">❌ Title mismatch</div>'}
                ${result.comparison.authorMatch ? '<div class="success">✅ Author matches</div>' : '<div class="issue">❌ Author mismatch</div>'}
                ${result.comparison.dateMatch ? '<div class="success">✅ Date matches</div>' : '<div class="issue">❌ Date mismatch</div>'}
                ${result.comparison.contentSimilarity > 0.7 ? '<div class="success">✅ High content similarity</div>' : '<div class="issue">❌ Low content similarity</div>'}
                ${result.comparison.paragraphCountMatch ? '<div class="success">✅ Paragraph count matches</div>' : '<div class="issue">❌ Paragraph count mismatch</div>'}
            </div>

            ${result.issues.length > 0 ? `
            <div class="section">
                <h2>⚠️ Issues Found</h2>
                ${result.issues.map(issue => `<div class="issue">${issue}</div>`).join('')}
            </div>
            ` : ''}

            ${result.recommendations.length > 0 ? `
            <div class="section">
                <h2>💡 Recommendations</h2>
                ${result.recommendations.map(rec => `<div class="issue">${rec}</div>`).join('')}
            </div>
            ` : ''}
        </div>
    </div>
</body>
</html>`;

  fs.writeFileSync(htmlPath, htmlContent);
  
  return { jsonPath, htmlPath };
}

async function main() {
  console.log('🚀 Starting Comprehensive Article Validation Test');
  console.log('============================================================');
  console.log(`📰 Test Article: ${TEST_ARTICLE.title}`);
  console.log(`🔗 URL: ${TEST_ARTICLE.url}`);
  console.log('============================================================\n');

  let browser: Browser | null = null;
  
  try {
    // Launch browser with Cloudflare bypass settings
    console.log('🌐 Launching browser with Cloudflare bypass...');
    browser = await chromium.launch({ 
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--disable-web-security',
        '--disable-features=site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    });
    
    const page = await context.newPage();
    
    // Add stealth scripts
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // Remove automation indicators
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    });
    
    // Navigate to original article with retries
    console.log('📖 Loading original article...');
    let retries = 3;
    while (retries > 0) {
      try {
        await page.goto(TEST_ARTICLE.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(5000); // Allow dynamic content to load
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        console.log(`⚠️ Retry ${4 - retries}/3 - Navigation failed, retrying...`);
        await page.waitForTimeout(2000);
      }
    }
    
    // Extract original content
    console.log('📊 Extracting original content...');
    const originalContent = await extractOriginalContent(page);
    
    // Take screenshot of original
    console.log('📸 Taking screenshot of original article...');
    const originalScreenshot = await takeScreenshot(page, `original-${Date.now()}.png`);
    
    // Run content scraper
    console.log('🤖 Running content scraper...');
    const articlePath = TEST_ARTICLE.url.replace('https://www.edgeprop.sg/', '');
    const scrapedContent = await scrapeArticleContent(articlePath, TEST_ARTICLE.nid);
    
    if (!scrapedContent) {
      throw new Error('Content scraper returned null');
    }
    
    console.log('✅ Content scraper completed successfully');
    
    // Perform comparison
    console.log('🔍 Comparing content...');
    const comparison = {
      titleMatch: originalContent.title.toLowerCase().includes(scrapedContent.title.toLowerCase()) || 
                  scrapedContent.title.toLowerCase().includes(originalContent.title.toLowerCase()),
      authorMatch: originalContent.author === scrapedContent.author,
      dateMatch: originalContent.publishedDate === scrapedContent.published_date,
      contentSimilarity: calculateContentSimilarity(originalContent.textContent, scrapedContent.text_content),
      paragraphCountMatch: Math.abs(originalContent.paragraphCount - (scrapedContent.paragraphs?.length || 0)) <= 2,
      imageCountMatch: Math.abs(originalContent.imageCount - (scrapedContent.images?.length || 0)) <= 5,
      linkCountMatch: Math.abs(originalContent.linkCount - (scrapedContent.links?.length || 0)) <= 10
    };
    
    // Identify issues
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    if (!comparison.titleMatch) {
      issues.push(`Title mismatch: Expected "${originalContent.title}", got "${scrapedContent.title}"`);
      recommendations.push('🔧 Improve title extraction selector');
    }
    
    if (!comparison.authorMatch) {
      issues.push(`Author mismatch: Expected "${originalContent.author}", got "${scrapedContent.author}"`);
      recommendations.push('🔧 Enhance author detection logic');
    }
    
    if (comparison.contentSimilarity < 0.5) {
      issues.push(`Low content similarity: ${(comparison.contentSimilarity * 100).toFixed(1)}%`);
      recommendations.push('🔧 Review content extraction selectors');
    }
    
    if (!comparison.paragraphCountMatch) {
      issues.push(`Paragraph count mismatch: Expected ~${originalContent.paragraphCount}, got ${scrapedContent.paragraphs?.length || 0}`);
      recommendations.push('🔧 Improve paragraph parsing logic');
    }
    
    // Create validation result
    const result: ValidationResult = {
      timestamp: new Date().toISOString(),
      testArticle: TEST_ARTICLE,
      originalContent,
      scrapedContent,
      comparison,
      issues,
      recommendations,
      screenshots: {
        original: originalScreenshot,
        scraped: '' // We'll add this if needed
      }
    };
    
    // Generate reports
    console.log('📋 Generating validation report...');
    const { jsonPath, htmlPath } = await generateReport(result);
    
    console.log('\n============================================================');
    console.log('📋 VALIDATION SUMMARY');
    console.log('============================================================');
    console.log(`✅ Title Match: ${comparison.titleMatch ? 'Yes' : 'No'}`);
    console.log(`✅ Author Match: ${comparison.authorMatch ? 'Yes' : 'No'}`);
    console.log(`✅ Content Similarity: ${(comparison.contentSimilarity * 100).toFixed(1)}%`);
    console.log(`✅ Paragraph Count Match: ${comparison.paragraphCountMatch ? 'Yes' : 'No'}`);
    console.log(`📊 Issues Found: ${issues.length}`);
    console.log(`💡 Recommendations: ${recommendations.length}`);
    
    if (issues.length > 0) {
      console.log('\n⚠️  ISSUES:');
      issues.forEach(issue => console.log(`   • ${issue}`));
    }
    
    console.log('\n✅ Reports generated:');
    console.log(`📄 JSON: ${jsonPath}`);
    console.log(`🌐 HTML: ${htmlPath}`);
    
    console.log('\n🎉 Validation test completed!');
    console.log(`📊 Open the HTML report: ${htmlPath}`);
    
    // Open the HTML report
    const { exec } = require('child_process');
    exec(`open "${htmlPath}"`);
    
  } catch (error) {
    console.error('❌ Validation test failed:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the test
main().catch(console.error);