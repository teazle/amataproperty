#!/usr/bin/env bun

import { scrapeArticleContent } from './src/lib/scraper/edgeprop-content-scraper';
import fs from 'fs';
import path from 'path';

// Test article details from our selection
const TEST_ARTICLE = {
  title: "Singapore property market outlook 2024: Experts weigh in on trends and predictions",
  url: "https://www.edgeprop.sg/property-news/singapore-property-market-outlook-2024-experts-weigh-in-on-trends-and-predictions",
  nid: "mcp-1761694828711-18-kkjqhqhqr"
};

interface ValidationResult {
  timestamp: string;
  testArticle: typeof TEST_ARTICLE;
  scrapingResult: any;
  validationChecks: {
    titleMatch: boolean;
    authorPresent: boolean;
    datePresent: boolean;
    contentLength: number;
    imageCount: number;
    linkCount: number;
    paragraphCount: number;
    htmlContentPresent: boolean;
    textContentPresent: boolean;
    mainImagePresent: boolean;
  };
  discrepancies: string[];
  recommendations: string[];
}

async function runComprehensiveValidation(): Promise<ValidationResult> {
  console.log('🚀 Starting Comprehensive MCP Scraper Validation Test');
  console.log('=' .repeat(60));
  console.log(`📰 Test Article: ${TEST_ARTICLE.title}`);
  console.log(`🔗 URL: ${TEST_ARTICLE.url}`);
  console.log('=' .repeat(60));

  const timestamp = new Date().toISOString();
  const discrepancies: string[] = [];
  const recommendations: string[] = [];

  console.log('\n🔄 Running content scraper on specific article...');
  
  let scrapingResult;
  try {
    // Extract article path from URL
    const articlePath = TEST_ARTICLE.url.replace('https://www.edgeprop.sg/', '');
    
    // Run content scraper on the test article
    scrapingResult = await scrapeArticleContent(articlePath, TEST_ARTICLE.nid);
    
    if (!scrapingResult) {
      throw new Error('Content scraper returned null - article not found or failed to scrape');
    }
    
    console.log('✅ Content scraper completed successfully');
  } catch (error) {
    console.error('❌ Content scraper failed:', error);
    throw error;
  }

  console.log('\n📊 Analyzing scraped content...');

  // Validation checks
  const validationChecks = {
    titleMatch: false,
    authorPresent: false,
    datePresent: false,
    contentLength: 0,
    imageCount: 0,
    linkCount: 0,
    paragraphCount: 0,
    htmlContentPresent: false,
    textContentPresent: false,
    mainImagePresent: false
  };

  // Check title match
  if (scrapingResult.title) {
    validationChecks.titleMatch = scrapingResult.title.toLowerCase().includes('singapore property market outlook');
    if (!validationChecks.titleMatch) {
      discrepancies.push(`Title mismatch: Expected content about "Singapore property market outlook", got "${scrapingResult.title}"`);
    }
  } else {
    discrepancies.push('No title extracted');
  }

  // Check author presence
  validationChecks.authorPresent = !!scrapingResult.author;
  if (!validationChecks.authorPresent) {
    discrepancies.push('No author information extracted');
  }

  // Check date presence
  validationChecks.datePresent = !!scrapingResult.published_date;
  if (!validationChecks.datePresent) {
    discrepancies.push('No publication date extracted');
  }

  // Check content presence and length
  validationChecks.textContentPresent = !!scrapingResult.text_content;
  validationChecks.htmlContentPresent = !!scrapingResult.html_content;
  validationChecks.contentLength = scrapingResult.text_content?.length || 0;

  if (!validationChecks.textContentPresent) {
    discrepancies.push('No text content extracted');
  }
  if (!validationChecks.htmlContentPresent) {
    discrepancies.push('No HTML content extracted');
  }
  if (validationChecks.contentLength < 500) {
    discrepancies.push(`Content too short: ${validationChecks.contentLength} characters (expected > 500)`);
  }

  // Check paragraphs
  validationChecks.paragraphCount = scrapingResult.paragraphs?.length || 0;
  if (validationChecks.paragraphCount < 3) {
    discrepancies.push(`Too few paragraphs: ${validationChecks.paragraphCount} (expected > 3)`);
  }

  // Check images
  validationChecks.imageCount = scrapingResult.images?.length || 0;
  validationChecks.mainImagePresent = !!scrapingResult.main_image_url;
  
  if (validationChecks.imageCount === 0) {
    discrepancies.push('No images extracted');
  }
  if (!validationChecks.mainImagePresent) {
    discrepancies.push('No main image identified');
  }

  // Check links
  validationChecks.linkCount = scrapingResult.links?.length || 0;
  if (validationChecks.linkCount === 0) {
    discrepancies.push('No links extracted');
  }

  // Generate recommendations
  if (discrepancies.length === 0) {
    recommendations.push('✅ All validation checks passed - MCP scraper is working correctly');
  } else {
    recommendations.push('⚠️ Issues found - review discrepancies for improvement areas');
    
    if (!validationChecks.titleMatch || !validationChecks.authorPresent || !validationChecks.datePresent) {
      recommendations.push('🔧 Improve metadata extraction (title, author, date)');
    }
    
    if (validationChecks.contentLength < 500 || validationChecks.paragraphCount < 3) {
      recommendations.push('🔧 Enhance content extraction and paragraph parsing');
    }
    
    if (validationChecks.imageCount === 0 || !validationChecks.mainImagePresent) {
      recommendations.push('🔧 Fix image extraction and main image identification');
    }
    
    if (validationChecks.linkCount === 0) {
      recommendations.push('🔧 Improve link extraction from article content');
    }
  }

  const result: ValidationResult = {
    timestamp,
    testArticle: TEST_ARTICLE,
    scrapingResult,
    validationChecks,
    discrepancies,
    recommendations
  };

  return result;
}

async function generateReport(result: ValidationResult) {
  console.log('\n📋 Generating Validation Report...');

  const reportDir = path.join(process.cwd(), 'test-results');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportFile = path.join(reportDir, `mcp-validation-${Date.now()}.json`);
  const htmlReportFile = path.join(reportDir, `mcp-validation-${Date.now()}.html`);

  // Save JSON report
  fs.writeFileSync(reportFile, JSON.stringify(result, null, 2));

  // Generate HTML report
  const htmlReport = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP Scraper Validation Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; line-height: 1.6; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
        .section { margin-bottom: 30px; }
        .check-item { display: flex; align-items: center; margin: 10px 0; }
        .check-pass { color: #28a745; }
        .check-fail { color: #dc3545; }
        .discrepancy { background: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .recommendation { background: #d1ecf1; border: 1px solid #bee5eb; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .content-preview { background: #f8f9fa; padding: 15px; border-radius: 4px; max-height: 200px; overflow-y: auto; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .stat-card { background: white; border: 1px solid #dee2e6; padding: 15px; border-radius: 8px; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 MCP Scraper Validation Report</h1>
        <p><strong>Test Date:</strong> ${result.timestamp}</p>
        <p><strong>Article:</strong> ${result.testArticle.title}</p>
        <p><strong>URL:</strong> <a href="${result.testArticle.url}" target="_blank">${result.testArticle.url}</a></p>
    </div>

    <div class="section">
        <h2>📊 Validation Statistics</h2>
        <div class="stats">
            <div class="stat-card">
                <h3>Content Length</h3>
                <p>${result.validationChecks.contentLength.toLocaleString()} chars</p>
            </div>
            <div class="stat-card">
                <h3>Paragraphs</h3>
                <p>${result.validationChecks.paragraphCount}</p>
            </div>
            <div class="stat-card">
                <h3>Images</h3>
                <p>${result.validationChecks.imageCount}</p>
            </div>
            <div class="stat-card">
                <h3>Links</h3>
                <p>${result.validationChecks.linkCount}</p>
            </div>
        </div>
    </div>

    <div class="section">
        <h2>✅ Validation Checks</h2>
        <div class="check-item ${result.validationChecks.titleMatch ? 'check-pass' : 'check-fail'}">
            ${result.validationChecks.titleMatch ? '✅' : '❌'} Title Match
        </div>
        <div class="check-item ${result.validationChecks.authorPresent ? 'check-pass' : 'check-fail'}">
            ${result.validationChecks.authorPresent ? '✅' : '❌'} Author Present
        </div>
        <div class="check-item ${result.validationChecks.datePresent ? 'check-pass' : 'check-fail'}">
            ${result.validationChecks.datePresent ? '✅' : '❌'} Date Present
        </div>
        <div class="check-item ${result.validationChecks.textContentPresent ? 'check-pass' : 'check-fail'}">
            ${result.validationChecks.textContentPresent ? '✅' : '❌'} Text Content Present
        </div>
        <div class="check-item ${result.validationChecks.htmlContentPresent ? 'check-pass' : 'check-fail'}">
            ${result.validationChecks.htmlContentPresent ? '✅' : '❌'} HTML Content Present
        </div>
        <div class="check-item ${result.validationChecks.mainImagePresent ? 'check-pass' : 'check-fail'}">
            ${result.validationChecks.mainImagePresent ? '✅' : '❌'} Main Image Present
        </div>
    </div>

    ${result.discrepancies.length > 0 ? `
    <div class="section">
        <h2>⚠️ Discrepancies Found</h2>
        ${result.discrepancies.map(d => `<div class="discrepancy">${d}</div>`).join('')}
    </div>
    ` : ''}

    <div class="section">
        <h2>💡 Recommendations</h2>
        ${result.recommendations.map(r => `<div class="recommendation">${r}</div>`).join('')}
    </div>

    <div class="section">
        <h2>📄 Scraped Content Preview</h2>
        <h3>Title:</h3>
        <div class="content-preview">${result.scrapingResult.title || 'N/A'}</div>
        
        <h3>Author:</h3>
        <div class="content-preview">${result.scrapingResult.author || 'N/A'}</div>
        
        <h3>Text Content (first 500 chars):</h3>
        <div class="content-preview">${(result.scrapingResult.text_content || '').substring(0, 500)}...</div>
        
        <h3>Images:</h3>
        <div class="content-preview">
            ${result.scrapingResult.images?.map((img: any) => `
                <p><strong>URL:</strong> ${img.url}<br>
                <strong>Alt:</strong> ${img.alt || 'N/A'}<br>
                <strong>Caption:</strong> ${img.caption || 'N/A'}</p>
            `).join('') || 'No images found'}
        </div>
    </div>
</body>
</html>
  `;

  fs.writeFileSync(htmlReportFile, htmlReport);

  console.log(`✅ Reports generated:`);
  console.log(`📄 JSON: ${reportFile}`);
  console.log(`🌐 HTML: ${htmlReportFile}`);

  return { reportFile, htmlReportFile };
}

// Run the validation
async function main() {
  try {
    const result = await runComprehensiveValidation();
    
    console.log('\n' + '='.repeat(60));
    console.log('📋 VALIDATION SUMMARY');
    console.log('='.repeat(60));
    
    console.log(`✅ Checks Passed: ${Object.values(result.validationChecks).filter(Boolean).length}`);
    console.log(`❌ Issues Found: ${result.discrepancies.length}`);
    console.log(`📊 Content Length: ${result.validationChecks.contentLength} characters`);
    console.log(`📝 Paragraphs: ${result.validationChecks.paragraphCount}`);
    console.log(`🖼️  Images: ${result.validationChecks.imageCount}`);
    console.log(`🔗 Links: ${result.validationChecks.linkCount}`);
    
    if (result.discrepancies.length > 0) {
      console.log('\n⚠️  DISCREPANCIES:');
      result.discrepancies.forEach(d => console.log(`   • ${d}`));
    }
    
    console.log('\n💡 RECOMMENDATIONS:');
    result.recommendations.forEach(r => console.log(`   • ${r}`));
    
    const { htmlReportFile } = await generateReport(result);
    
    console.log('\n🎉 Validation test completed!');
    console.log(`📊 Open the HTML report: ${htmlReportFile}`);
    
  } catch (error) {
    console.error('❌ Validation test failed:', error);
    process.exit(1);
  }
}

main();