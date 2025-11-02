/**
 * Fixed MCP Scraper Test
 * This version fixes the overly aggressive content filtering
 */

import { chromium } from 'playwright';

interface MCPArticle {
  nid: string;
  title: string;
  path: string;
  thumbnail: string;
  author: string;
  created: string;
  category: string[];
  description: string;
  created_on: string;
  keywords?: string[];
  html_content?: string;
  text_content: string;
  paragraphs: string[];
  links: Array<{text: string; url: string; type: 'internal' | 'external'}>;
  images: Array<{url: string; alt?: string; caption?: string}>;
  main_image_url?: string;
  main_image_caption?: string;
  tags?: string[];
  word_count: number;
  reading_time_minutes: number;
  scraped_at: Date;
}

// Improved cleanParagraphs function - less aggressive filtering
function cleanParagraphs(paragraphs: string[], title: string): string[] {
  const titleWords = title.toLowerCase().split(/\s+/);
  
  return paragraphs.filter(paragraph => {
    const text = paragraph.trim();
    
    // Basic length check - reduced from 30 to 20 characters
    if (text.length < 20) {
      return false;
    }
    
    // Skip very short paragraphs (less than 3 words)
    if (text.split(/\s+/).length < 3) {
      return false;
    }
    
    // Skip obvious non-content (but be less aggressive)
    const lowerText = text.toLowerCase();
    const skipPatterns = [
      /^(subscribe|login|register|sign up|sign in)$/i,
      /^(home|news|property|search)$/i,
      /^(cookie|privacy|terms)$/i,
      /^(share|like|follow)$/i,
      /^\d+$/, // Just numbers
      /^[^\w\s]+$/, // Just punctuation
    ];
    
    if (skipPatterns.some(pattern => pattern.test(text))) {
      return false;
    }
    
    // Skip if it's just the title (but allow partial matches)
    const similarity = titleWords.filter(word => 
      lowerText.includes(word) && word.length > 3
    ).length / titleWords.length;
    
    if (similarity > 0.8 && text.length < 100) {
      return false;
    }
    
    return true;
  });
}

async function scrapeArticleContent(url: string): Promise<MCPArticle | null> {
  console.log(`🔍 Scraping article: ${url}`);
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    const articleData = await page.evaluate(() => {
      // Extract basic metadata
      const title = document.querySelector('h1')?.textContent?.trim() || 
                   document.querySelector('title')?.textContent?.trim() || 
                   'No title found';
      
      // Find the main content container using the working selectors from debug
      let contentContainer = document.querySelector('.jsx-2128998887') || 
                           document.querySelector('.jsx-4217446631') ||
                           document.body;
      
      console.log('Content container found:', contentContainer?.tagName);
      
      // Extract paragraphs from multiple sources
      const allParagraphs: string[] = [];
      
      // Method 1: Get all p tags
      const pTags = Array.from(contentContainer.querySelectorAll('p'));
      pTags.forEach(p => {
        const text = p.textContent?.trim();
        if (text && text.length > 10) {
          allParagraphs.push(text);
        }
      });
      
      // Method 2: Get text from divs that look like content
      const divs = Array.from(contentContainer.querySelectorAll('div'));
      divs.forEach(div => {
        // Only get divs that have text but no child divs (leaf nodes)
        if (div.children.length === 0 || 
            Array.from(div.children).every(child => child.tagName !== 'DIV')) {
          const text = div.textContent?.trim();
          if (text && text.length > 30 && text.length < 1000) {
            // Avoid duplicates
            if (!allParagraphs.some(existing => existing.includes(text) || text.includes(existing))) {
              allParagraphs.push(text);
            }
          }
        }
      });
      
      // Extract images
      const images = Array.from(contentContainer.querySelectorAll('img')).map(img => ({
        url: img.src || '',
        alt: img.alt || '',
        caption: img.getAttribute('title') || ''
      }));
      
      // Extract links
      const links = Array.from(contentContainer.querySelectorAll('a')).map(link => ({
        text: link.textContent?.trim() || '',
        url: link.href || '',
        type: (link.href?.startsWith('http') ? 'external' : 'internal') as 'internal' | 'external'
      }));
      
      return {
        title,
        rawParagraphs: allParagraphs,
        images,
        links,
        fullText: contentContainer.textContent?.trim() || ''
      };
    });
    
    // Clean paragraphs with improved logic
    const cleanedParagraphs = cleanParagraphs(articleData.rawParagraphs, articleData.title);
    const textContent = cleanedParagraphs.join(' ');
    const wordCount = textContent.split(/\s+/).length;
    
    const article: MCPArticle = {
      nid: Date.now().toString(),
      title: articleData.title,
      path: url,
      thumbnail: articleData.images[0]?.url || '',
      author: 'Unknown',
      created: new Date().toISOString(),
      category: ['property-news'],
      description: cleanedParagraphs[0]?.substring(0, 200) || '',
      created_on: new Date().toISOString(),
      text_content: textContent,
      paragraphs: cleanedParagraphs,
      links: articleData.links.filter(link => link.text.length > 0),
      images: articleData.images.filter(img => img.url.length > 0),
      main_image_url: articleData.images[0]?.url,
      word_count: wordCount,
      reading_time_minutes: Math.ceil(wordCount / 200),
      scraped_at: new Date()
    };
    
    console.log(`✅ Scraped article successfully:`);
    console.log(`   Title: ${article.title}`);
    console.log(`   Raw paragraphs found: ${articleData.rawParagraphs.length}`);
    console.log(`   Cleaned paragraphs: ${article.paragraphs.length}`);
    console.log(`   Text content length: ${article.text_content.length} characters`);
    console.log(`   Word count: ${article.word_count}`);
    console.log(`   Images: ${article.images.length}`);
    console.log(`   Links: ${article.links.length}`);
    
    await browser.close();
    return article;
    
  } catch (error) {
    console.error('❌ Error scraping article:', error);
    await browser.close();
    return null;
  }
}

async function testFixedScraper() {
  console.log('🚀 Testing Fixed MCP Scraper...');
  
  const testUrl = 'https://www.edgeprop.sg/property-news/sail-marina-bay-second-wind-residential-skyscraper';
  const article = await scrapeArticleContent(testUrl);
  
  if (!article) {
    console.log('❌ Failed to scrape article');
    return;
  }
  
  // Validation tests
  const tests = [
    {
      name: 'Title extracted',
      pass: article.title && article.title.length > 5 && article.title !== 'No title found'
    },
    {
      name: 'Content is substantial',
      pass: article.text_content && article.text_content.length > 500
    },
    {
      name: 'Word count is reasonable',
      pass: article.word_count > 50
    },
    {
      name: 'Has paragraphs',
      pass: article.paragraphs && article.paragraphs.length > 0
    },
    {
      name: 'Has images',
      pass: article.images && article.images.length > 0
    },
    {
      name: 'Has links',
      pass: article.links && article.links.length > 0
    },
    {
      name: 'Reading time calculated',
      pass: article.reading_time_minutes > 0
    },
    {
      name: 'Content quality check',
      pass: article.text_content.length > 1000 && article.paragraphs.length > 3
    }
  ];
  
  console.log('\n📊 Test Results:');
  let passed = 0;
  tests.forEach(test => {
    const status = test.pass ? '✅' : '❌';
    console.log(`${status} ${test.name}`);
    if (test.pass) passed++;
  });
  
  const percentage = Math.round((passed / tests.length) * 100);
  console.log(`\n🎯 Overall Score: ${passed}/${tests.length} (${percentage}%)`);
  
  if (percentage >= 90) {
    console.log('🎉 Excellent! Scraper is working well.');
  } else if (percentage >= 70) {
    console.log('⚠️  Good, but could be improved.');
  } else {
    console.log('❌ Needs significant improvement.');
  }
  
  // Show sample content
  console.log('\n📝 Sample Content:');
  console.log(`First paragraph: "${article.paragraphs[0]?.substring(0, 200)}..."`);
  console.log(`Total content preview: "${article.text_content.substring(0, 300)}..."`);
}

testFixedScraper().catch(console.error);