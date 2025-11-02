import { scrapeArticleContent } from '../src/lib/scraper/edgeprop-content-scraper';
import { createHash } from 'crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

interface TestResult {
  testId: string;
  timestamp: string;
  originalUrl: string;
  scrapedArticle: any;
  contentHash: string;
  originalContentHash?: string;
  comparisonResults: ComparisonResult;
  discrepancies: string[];
  testPassed: boolean;
  correctionActions: string[];
}

interface ComparisonResult {
  titleMatch: boolean;
  authorMatch: boolean;
  dateMatch: boolean;
  contentLengthRatio: number;
  imageCountMatch: boolean;
  linkCountMatch: boolean;
  contentCompleteness: number; // 0-100%
}

class MCPScraperTester {
  private testResultsDir: string;
  private testId: string;

  constructor() {
    this.testResultsDir = join(process.cwd(), 'test-results');
    this.testId = `test-${Date.now()}`;
    
    // Ensure test results directory exists
    if (!existsSync(this.testResultsDir)) {
      mkdirSync(this.testResultsDir, { recursive: true });
    }
  }

  /**
   * Step 1: Scrape Test Execution
   */
  async executeScrapeTest(articlePath: string): Promise<any> {
    console.log('🧪 STEP 1: SCRAPE TEST EXECUTION');
    console.log('='.repeat(60));
    
    const fullUrl = `https://www.edgeprop.sg${articlePath}`;
    console.log(`📄 Target Article: ${fullUrl}`);
    console.log(`🆔 Test ID: ${this.testId}`);
    
    try {
      console.log('🔄 Executing MCP scraper...');
      const scrapedArticle = await scrapeArticleContent(articlePath, this.testId);
      
      if (!scrapedArticle) {
        throw new Error('Scraper returned null/undefined result');
      }
      
      // Save scraped article to library system
      const articleFilePath = join(this.testResultsDir, `${this.testId}-scraped-article.json`);
      writeFileSync(articleFilePath, JSON.stringify(scrapedArticle, null, 2));
      
      console.log('✅ Article successfully scraped and saved to library');
      console.log(`📁 Storage Location: ${articleFilePath}`);
      console.log(`📊 Content Summary:`);
      console.log(`   - Title: ${scrapedArticle.title}`);
      console.log(`   - Author: ${scrapedArticle.author || 'Not found'}`);
      console.log(`   - Date: ${scrapedArticle.published_date || 'Not found'}`);
      console.log(`   - Word Count: ${scrapedArticle.word_count}`);
      console.log(`   - Paragraphs: ${scrapedArticle.paragraphs?.length || 0}`);
      console.log(`   - Images: ${scrapedArticle.images?.length || 0}`);
      console.log(`   - Links: ${scrapedArticle.links?.length || 0}`);
      
      return scrapedArticle;
      
    } catch (error) {
      console.error('❌ Scrape test failed:', error);
      throw error;
    }
  }

  /**
   * Step 2 & 3: Comparison Process and Verification Protocol
   */
  async performComparison(originalUrl: string, scrapedArticle: any): Promise<ComparisonResult> {
    console.log('\n🔍 STEP 2 & 3: COMPARISON PROCESS & VERIFICATION');
    console.log('='.repeat(60));
    
    // Generate content hash for scraped article
    const scrapedContentHash = this.generateContentHash(scrapedArticle);
    console.log(`🔐 Scraped Content Hash: ${scrapedContentHash}`);
    
    // For now, we'll perform internal consistency checks
    // In a full implementation, this would compare against the live page
    const comparisonResult: ComparisonResult = {
      titleMatch: this.validateTitle(scrapedArticle.title),
      authorMatch: this.validateAuthor(scrapedArticle.author),
      dateMatch: this.validateDate(scrapedArticle.published_date),
      contentLengthRatio: this.calculateContentCompleteness(scrapedArticle),
      imageCountMatch: this.validateImages(scrapedArticle.images),
      linkCountMatch: this.validateLinks(scrapedArticle.links),
      contentCompleteness: this.assessContentCompleteness(scrapedArticle)
    };
    
    console.log('📊 COMPARISON RESULTS:');
    console.log(`   ✅ Title Valid: ${comparisonResult.titleMatch}`);
    console.log(`   ✅ Author Valid: ${comparisonResult.authorMatch}`);
    console.log(`   ✅ Date Valid: ${comparisonResult.dateMatch}`);
    console.log(`   📏 Content Completeness: ${comparisonResult.contentCompleteness}%`);
    console.log(`   🖼️  Images Valid: ${comparisonResult.imageCountMatch}`);
    console.log(`   🔗 Links Valid: ${comparisonResult.linkCountMatch}`);
    
    return comparisonResult;
  }

  /**
   * Step 4: Correction and Retesting Logic
   */
  identifyDiscrepancies(comparisonResult: ComparisonResult): string[] {
    console.log('\n🔧 STEP 4: DISCREPANCY IDENTIFICATION');
    console.log('='.repeat(60));
    
    const discrepancies: string[] = [];
    
    if (!comparisonResult.titleMatch) {
      discrepancies.push('Title extraction failed or invalid');
    }
    
    if (!comparisonResult.authorMatch) {
      discrepancies.push('Author extraction failed or returned invalid data');
    }
    
    if (!comparisonResult.dateMatch) {
      discrepancies.push('Date extraction failed or returned default/invalid date');
    }
    
    if (comparisonResult.contentCompleteness < 80) {
      discrepancies.push(`Content completeness below threshold: ${comparisonResult.contentCompleteness}%`);
    }
    
    if (!comparisonResult.imageCountMatch) {
      discrepancies.push('Image extraction appears insufficient');
    }
    
    if (!comparisonResult.linkCountMatch) {
      discrepancies.push('Link extraction appears insufficient');
    }
    
    if (discrepancies.length === 0) {
      console.log('✅ No significant discrepancies found!');
    } else {
      console.log('⚠️  Discrepancies identified:');
      discrepancies.forEach((disc, i) => {
        console.log(`   ${i + 1}. ${disc}`);
      });
    }
    
    return discrepancies;
  }

  /**
   * Step 5: Generate Test Report
   */
  generateTestReport(
    originalUrl: string, 
    scrapedArticle: any, 
    comparisonResult: ComparisonResult, 
    discrepancies: string[]
  ): TestResult {
    console.log('\n📋 STEP 5: GENERATING TEST REPORT');
    console.log('='.repeat(60));
    
    const testResult: TestResult = {
      testId: this.testId,
      timestamp: new Date().toISOString(),
      originalUrl,
      scrapedArticle,
      contentHash: this.generateContentHash(scrapedArticle),
      comparisonResults: comparisonResult,
      discrepancies,
      testPassed: discrepancies.length === 0,
      correctionActions: this.generateCorrectionActions(discrepancies)
    };
    
    // Save test report
    const reportPath = join(this.testResultsDir, `${this.testId}-test-report.json`);
    writeFileSync(reportPath, JSON.stringify(testResult, null, 2));
    
    // Generate human-readable report
    const readableReportPath = join(this.testResultsDir, `${this.testId}-report.md`);
    const readableReport = this.generateReadableReport(testResult);
    writeFileSync(readableReportPath, readableReport);
    
    console.log(`📄 Test Report Saved: ${reportPath}`);
    console.log(`📖 Readable Report: ${readableReportPath}`);
    
    return testResult;
  }

  /**
   * Step 6: Quality Assurance Checks
   */
  performQualityAssurance(scrapedArticle: any): boolean {
    console.log('\n🛡️  STEP 6: QUALITY ASSURANCE');
    console.log('='.repeat(60));
    
    const checks = {
      hasMainBodyText: Boolean(scrapedArticle.text_content && scrapedArticle.text_content.length > 100),
      hasTitle: Boolean(scrapedArticle.title && scrapedArticle.title.length > 0),
      hasParagraphs: Boolean(scrapedArticle.paragraphs && scrapedArticle.paragraphs.length >= 3),
      hasImages: Boolean(scrapedArticle.images && scrapedArticle.images.length > 0),
      hasMainImage: Boolean(scrapedArticle.main_image_url && scrapedArticle.main_image_url.length > 0),
      hasLinks: Boolean(scrapedArticle.links && scrapedArticle.links.length > 0),
      hasWordCount: Boolean(scrapedArticle.word_count && scrapedArticle.word_count > 50),
      hasReadingTime: Boolean(scrapedArticle.reading_time_minutes && scrapedArticle.reading_time_minutes > 0)
    };
    
    const passedChecks = Object.values(checks).filter(Boolean).length;
    const totalChecks = Object.keys(checks).length;
    const qualityScore = (passedChecks / totalChecks) * 100;
    
    console.log('🔍 Quality Assurance Results:');
    Object.entries(checks).forEach(([check, passed]) => {
      console.log(`   ${passed ? '✅' : '❌'} ${check}: ${passed ? 'PASS' : 'FAIL'}`);
    });
    
    console.log(`\n📊 Overall Quality Score: ${qualityScore.toFixed(1)}% (${passedChecks}/${totalChecks})`);
    
    const qualityPassed = qualityScore >= 75;
    console.log(`🎯 Quality Assurance: ${qualityPassed ? '✅ PASSED' : '❌ FAILED'}`);
    
    return qualityPassed;
  }

  // Helper methods
  private generateContentHash(article: any): string {
    const contentString = JSON.stringify({
      title: article.title,
      text_content: article.text_content,
      author: article.author,
      published_date: article.published_date
    });
    return createHash('sha256').update(contentString).digest('hex').substring(0, 16);
  }

  private validateTitle(title: string): boolean {
    return Boolean(title && title.length > 10 && !title.includes('undefined') && !title.includes('null'));
  }

  private validateAuthor(author: string): boolean {
    return Boolean(author && author.length > 0 && author !== '01 Jan 1970' && 
           !author.includes('Terms and Conditions') && !author.includes('Privacy Policy'));
  }

  private validateDate(date: string): boolean {
    return Boolean(date && date !== '01 Jan 1970' && date.length > 0);
  }

  private calculateContentCompleteness(article: any): number {
    const textLength = article.text_content?.length || 0;
    const paragraphCount = article.paragraphs?.length || 0;
    const wordCount = article.word_count || 0;
    
    // Basic heuristic for content completeness
    if (textLength > 1000 && paragraphCount >= 5 && wordCount > 200) return 100;
    if (textLength > 500 && paragraphCount >= 3 && wordCount > 100) return 80;
    if (textLength > 200 && paragraphCount >= 2 && wordCount > 50) return 60;
    return 40;
  }

  private validateImages(images: any[]): boolean {
    return images && images.length > 0;
  }

  private validateLinks(links: any[]): boolean {
    return links && links.length > 10; // Expect reasonable number of links
  }

  private assessContentCompleteness(article: any): number {
    let score = 0;
    
    // Title (20 points)
    if (this.validateTitle(article.title)) score += 20;
    
    // Content (40 points)
    const textLength = article.text_content?.length || 0;
    if (textLength > 1000) score += 40;
    else if (textLength > 500) score += 30;
    else if (textLength > 200) score += 20;
    else if (textLength > 100) score += 10;
    
    // Metadata (20 points)
    if (this.validateAuthor(article.author)) score += 10;
    if (this.validateDate(article.published_date)) score += 10;
    
    // Media and Links (20 points)
    if (this.validateImages(article.images)) score += 10;
    if (this.validateLinks(article.links)) score += 10;
    
    return score;
  }

  private generateCorrectionActions(discrepancies: string[]): string[] {
    const actions: string[] = [];
    
    discrepancies.forEach(disc => {
      if (disc.includes('Title')) {
        actions.push('Review title extraction selectors and logic');
      }
      if (disc.includes('Author')) {
        actions.push('Improve author extraction with better filtering and validation');
      }
      if (disc.includes('Date')) {
        actions.push('Enhance date parsing with more flexible patterns');
      }
      if (disc.includes('Content completeness')) {
        actions.push('Review content extraction selectors for better coverage');
      }
      if (disc.includes('Image')) {
        actions.push('Improve image detection and filtering logic');
      }
      if (disc.includes('Link')) {
        actions.push('Review link extraction scope and filtering');
      }
    });
    
    return actions;
  }

  private generateReadableReport(testResult: TestResult): string {
    return `# MCP Scraper Test Report

## Test Information
- **Test ID**: ${testResult.testId}
- **Timestamp**: ${testResult.timestamp}
- **Original URL**: ${testResult.originalUrl}
- **Test Result**: ${testResult.testPassed ? '✅ PASSED' : '❌ FAILED'}

## Article Information
- **Title**: ${testResult.scrapedArticle.title}
- **Author**: ${testResult.scrapedArticle.author || 'Not found'}
- **Date**: ${testResult.scrapedArticle.published_date || 'Not found'}
- **Word Count**: ${testResult.scrapedArticle.word_count}
- **Reading Time**: ${testResult.scrapedArticle.reading_time_minutes} minutes

## Content Analysis
- **Paragraphs**: ${testResult.scrapedArticle.paragraphs?.length || 0}
- **Images**: ${testResult.scrapedArticle.images?.length || 0}
- **Links**: ${testResult.scrapedArticle.links?.length || 0}
- **Content Hash**: ${testResult.contentHash}

## Comparison Results
- **Title Match**: ${testResult.comparisonResults.titleMatch ? '✅' : '❌'}
- **Author Match**: ${testResult.comparisonResults.authorMatch ? '✅' : '❌'}
- **Date Match**: ${testResult.comparisonResults.dateMatch ? '✅' : '❌'}
- **Content Completeness**: ${testResult.comparisonResults.contentCompleteness}%
- **Images Valid**: ${testResult.comparisonResults.imageCountMatch ? '✅' : '❌'}
- **Links Valid**: ${testResult.comparisonResults.linkCountMatch ? '✅' : '❌'}

## Discrepancies Found
${testResult.discrepancies.length === 0 ? 'None' : testResult.discrepancies.map((d, i) => `${i + 1}. ${d}`).join('\n')}

## Recommended Correction Actions
${testResult.correctionActions.length === 0 ? 'None required' : testResult.correctionActions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

## Content Preview
\`\`\`
${testResult.scrapedArticle.text_content?.substring(0, 500)}...
\`\`\`
`;
  }

  /**
   * Main test execution method
   */
  async runComprehensiveTest(articlePath: string): Promise<TestResult> {
    console.log('🚀 STARTING COMPREHENSIVE MCP SCRAPER TEST');
    console.log('='.repeat(80));
    
    try {
      // Step 1: Execute scrape test
      const scrapedArticle = await this.executeScrapeTest(articlePath);
      
      // Step 2 & 3: Perform comparison and verification
      const originalUrl = `https://www.edgeprop.sg${articlePath}`;
      const comparisonResult = await this.performComparison(originalUrl, scrapedArticle);
      
      // Step 4: Identify discrepancies
      const discrepancies = this.identifyDiscrepancies(comparisonResult);
      
      // Step 5: Generate test report
      const testResult = this.generateTestReport(originalUrl, scrapedArticle, comparisonResult, discrepancies);
      
      // Step 6: Quality assurance
      const qualityPassed = this.performQualityAssurance(scrapedArticle);
      
      // Final assessment
      console.log('\n🏁 FINAL TEST ASSESSMENT');
      console.log('='.repeat(60));
      console.log(`📊 Test ID: ${this.testId}`);
      console.log(`🎯 Overall Result: ${testResult.testPassed && qualityPassed ? '✅ SUCCESS' : '⚠️  NEEDS IMPROVEMENT'}`);
      console.log(`📈 Quality Score: ${comparisonResult.contentCompleteness}%`);
      console.log(`🔍 Discrepancies: ${discrepancies.length}`);
      
      return testResult;
      
    } catch (error) {
      console.error('💥 Test execution failed:', error);
      throw error;
    }
  }
}

// Export for use in other scripts
export { MCPScraperTester };

// Main execution
async function main() {
  const tester = new MCPScraperTester();
  
  // Test with the known working article
  const testArticlePath = '/property-news/asia-pacific-data-centre-association-pushes-stronger-sustainability-frameworks';
  
  try {
    await tester.runComprehensiveTest(testArticlePath);
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => console.error(error));
}