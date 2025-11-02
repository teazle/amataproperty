import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface ComparisonData {
  testId: string;
  originalUrl: string;
  scrapedArticle: any;
  timestamp: string;
}

class BrowserComparisonTool {
  private testResultsDir: string;

  constructor() {
    this.testResultsDir = join(process.cwd(), 'test-results');
  }

  /**
   * Generate HTML comparison page
   */
  generateComparisonHTML(comparisonData: ComparisonData): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP Scraper Comparison - ${comparisonData.testId}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            color: #333;
        }
        
        .header {
            background: #2563eb;
            color: white;
            padding: 1rem 2rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .header h1 {
            font-size: 1.5rem;
            margin-bottom: 0.5rem;
        }
        
        .header .meta {
            opacity: 0.9;
            font-size: 0.9rem;
        }
        
        .comparison-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            padding: 1rem;
            min-height: calc(100vh - 120px);
        }
        
        .panel {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .panel-header {
            padding: 1rem;
            border-bottom: 1px solid #e5e7eb;
            font-weight: 600;
        }
        
        .original-header {
            background: #fef3c7;
            color: #92400e;
        }
        
        .scraped-header {
            background: #d1fae5;
            color: #065f46;
        }
        
        .panel-content {
            height: calc(100vh - 200px);
            overflow-y: auto;
        }
        
        .iframe-container {
            width: 100%;
            height: 100%;
            border: none;
        }
        
        .scraped-content {
            padding: 1.5rem;
            line-height: 1.6;
        }
        
        .scraped-content h1 {
            font-size: 1.8rem;
            margin-bottom: 1rem;
            color: #1f2937;
        }
        
        .metadata {
            background: #f9fafb;
            padding: 1rem;
            margin-bottom: 1.5rem;
            border-radius: 6px;
            border-left: 4px solid #3b82f6;
        }
        
        .metadata-item {
            margin-bottom: 0.5rem;
        }
        
        .metadata-label {
            font-weight: 600;
            color: #374151;
        }
        
        .metadata-value {
            color: #6b7280;
        }
        
        .content-section {
            margin-bottom: 2rem;
        }
        
        .content-section h3 {
            color: #1f2937;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 2px solid #e5e7eb;
        }
        
        .paragraph {
            margin-bottom: 1rem;
            text-align: justify;
        }
        
        .images-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
        }
        
        .image-item {
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            overflow: hidden;
        }
        
        .image-item img {
            width: 100%;
            height: 120px;
            object-fit: cover;
        }
        
        .image-caption {
            padding: 0.5rem;
            font-size: 0.8rem;
            color: #6b7280;
            background: #f9fafb;
        }
        
        .links-list {
            max-height: 300px;
            overflow-y: auto;
        }
        
        .link-item {
            padding: 0.5rem;
            border-bottom: 1px solid #f3f4f6;
            font-size: 0.9rem;
        }
        
        .link-item a {
            color: #2563eb;
            text-decoration: none;
        }
        
        .link-item a:hover {
            text-decoration: underline;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
        }
        
        .stat-card {
            background: #f8fafc;
            padding: 1rem;
            border-radius: 6px;
            text-align: center;
            border: 1px solid #e2e8f0;
        }
        
        .stat-number {
            font-size: 1.5rem;
            font-weight: 700;
            color: #1e40af;
        }
        
        .stat-label {
            font-size: 0.8rem;
            color: #64748b;
            margin-top: 0.25rem;
        }
        
        .controls {
            position: fixed;
            bottom: 1rem;
            right: 1rem;
            display: flex;
            gap: 0.5rem;
        }
        
        .btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            text-decoration: none;
            display: inline-block;
        }
        
        .btn-primary {
            background: #2563eb;
            color: white;
        }
        
        .btn-secondary {
            background: #6b7280;
            color: white;
        }
        
        .btn:hover {
            opacity: 0.9;
        }
        
        @media (max-width: 768px) {
            .comparison-container {
                grid-template-columns: 1fr;
            }
            
            .header {
                padding: 1rem;
            }
            
            .header h1 {
                font-size: 1.2rem;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 MCP Scraper Comparison Tool</h1>
        <div class="meta">
            Test ID: ${comparisonData.testId} | 
            Generated: ${new Date(comparisonData.timestamp).toLocaleString()}
        </div>
    </div>
    
    <div class="comparison-container">
        <!-- Original Article Panel -->
        <div class="panel">
            <div class="panel-header original-header">
                📄 Original Article (Live Source)
            </div>
            <div class="panel-content">
                <iframe 
                    src="${comparisonData.originalUrl}" 
                    class="iframe-container"
                    title="Original Article">
                </iframe>
            </div>
        </div>
        
        <!-- Scraped Article Panel -->
        <div class="panel">
            <div class="panel-header scraped-header">
                🤖 Scraped Article (MCP Result)
            </div>
            <div class="panel-content">
                <div class="scraped-content">
                    <h1>${comparisonData.scrapedArticle.title || 'No Title Extracted'}</h1>
                    
                    <div class="metadata">
                        <div class="metadata-item">
                            <span class="metadata-label">Author:</span>
                            <span class="metadata-value">${comparisonData.scrapedArticle.author || 'Not found'}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Date:</span>
                            <span class="metadata-value">${comparisonData.scrapedArticle.published_date || 'Not found'}</span>
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Source URL:</span>
                            <span class="metadata-value">${comparisonData.scrapedArticle.url || 'N/A'}</span>
                        </div>
                    </div>
                    
                    ${comparisonData.scrapedArticle.main_image_url ? `
                    <div class="content-section">
                        <h3>🖼️ Main Image</h3>
                        <img src="${comparisonData.scrapedArticle.main_image_url}" 
                             alt="Main article image" 
                             style="max-width: 100%; height: auto; border-radius: 6px;">
                    </div>
                    ` : ''}
                    
                    <div class="content-section">
                        <h3>📊 Content Statistics</h3>
                        <div class="stats-grid">
                            <div class="stat-card">
                                <div class="stat-number">${comparisonData.scrapedArticle.word_count || 0}</div>
                                <div class="stat-label">Words</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-number">${comparisonData.scrapedArticle.paragraphs?.length || 0}</div>
                                <div class="stat-label">Paragraphs</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-number">${comparisonData.scrapedArticle.images?.length || 0}</div>
                                <div class="stat-label">Images</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-number">${comparisonData.scrapedArticle.links?.length || 0}</div>
                                <div class="stat-label">Links</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-number">${comparisonData.scrapedArticle.reading_time_minutes || 0}</div>
                                <div class="stat-label">Min Read</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="content-section">
                        <h3>📝 Article Content</h3>
                        ${comparisonData.scrapedArticle.paragraphs?.map((p: string) => 
                            `<div class="paragraph">${p}</div>`
                        ).join('') || '<p>No content extracted</p>'}
                    </div>
                    
                    ${comparisonData.scrapedArticle.images?.length > 0 ? `
                    <div class="content-section">
                        <h3>🖼️ Extracted Images (${comparisonData.scrapedArticle.images.length})</h3>
                        <div class="images-grid">
                            ${comparisonData.scrapedArticle.images.slice(0, 12).map((img: any) => `
                                <div class="image-item">
                                    <img src="${img.src}" alt="${img.alt || 'Image'}" onerror="this.style.display='none'">
                                    <div class="image-caption">${img.alt || 'No caption'}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    ` : ''}
                    
                    ${comparisonData.scrapedArticle.links?.length > 0 ? `
                    <div class="content-section">
                        <h3>🔗 Extracted Links (${comparisonData.scrapedArticle.links.length})</h3>
                        <div class="links-list">
                            ${comparisonData.scrapedArticle.links.slice(0, 20).map((link: any) => `
                                <div class="link-item">
                                    <a href="${link.href}" target="_blank">${link.text || link.href}</a>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>
    </div>
    
    <div class="controls">
        <a href="${comparisonData.originalUrl}" target="_blank" class="btn btn-primary">
            🔗 Open Original
        </a>
        <button onclick="window.print()" class="btn btn-secondary">
            🖨️ Print Report
        </button>
    </div>
    
    <script>
        // Add some interactive features
        document.addEventListener('DOMContentLoaded', function() {
            // Sync scroll between panels (optional)
            const panels = document.querySelectorAll('.panel-content');
            let isScrolling = false;
            
            // Add click-to-highlight for comparison
            document.querySelectorAll('.paragraph').forEach(p => {
                p.addEventListener('click', function() {
                    document.querySelectorAll('.paragraph').forEach(el => el.style.background = '');
                    this.style.background = '#fef3c7';
                });
            });
            
            // Add keyboard shortcuts
            document.addEventListener('keydown', function(e) {
                if (e.ctrlKey || e.metaKey) {
                    switch(e.key) {
                        case 'p':
                            e.preventDefault();
                            window.print();
                            break;
                        case 'o':
                            e.preventDefault();
                            window.open('${comparisonData.originalUrl}', '_blank');
                            break;
                    }
                }
            });
        });
    </script>
</body>
</html>`;
  }

  /**
   * Create comparison page for a test result
   */
  createComparisonPage(testId: string): string {
    const testResultPath = join(this.testResultsDir, `${testId}-scraped-article.json`);
    
    if (!existsSync(testResultPath)) {
      throw new Error(`Test result not found: ${testResultPath}`);
    }
    
    const scrapedArticle = JSON.parse(readFileSync(testResultPath, 'utf-8'));
    const originalUrl = scrapedArticle.url || `https://www.edgeprop.sg${scrapedArticle.path}`;
    
    const comparisonData: ComparisonData = {
      testId,
      originalUrl,
      scrapedArticle,
      timestamp: new Date().toISOString()
    };
    
    const htmlContent = this.generateComparisonHTML(comparisonData);
    const htmlPath = join(this.testResultsDir, `${testId}-comparison.html`);
    
    writeFileSync(htmlPath, htmlContent);
    
    console.log(`📄 Comparison page created: ${htmlPath}`);
    console.log(`🌐 Open in browser: file://${htmlPath}`);
    
    return htmlPath;
  }

  /**
   * Generate comparison for the latest test
   */
  createLatestComparison(): string {
    const files = require('fs').readdirSync(this.testResultsDir)
      .filter((f: string) => f.endsWith('-scraped-article.json'))
      .sort()
      .reverse();
    
    if (files.length === 0) {
      throw new Error('No test results found');
    }
    
    const latestFile = files[0];
    const testId = latestFile.replace('-scraped-article.json', '');
    
    return this.createComparisonPage(testId);
  }
}

export { BrowserComparisonTool };

// Main execution for standalone use
async function main() {
  const tool = new BrowserComparisonTool();
  
  try {
    const htmlPath = tool.createLatestComparison();
    console.log(`\n✅ Comparison page ready!`);
    console.log(`📂 File: ${htmlPath}`);
    console.log(`🌐 Open: file://${htmlPath}`);
  } catch (error) {
    console.error('Failed to create comparison:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => console.error(error));
}