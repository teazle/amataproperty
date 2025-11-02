/**
 * EdgeProp Full Article Content Scraper
 * Scrapes complete article HTML and text content from individual article pages
 */

import { type Page as _Page, chromium, type Browser } from 'playwright';
import { sanitizeHtmlContent } from '../utils/content-parser';

export interface ArticleContent {
  nid: string;
  path: string;
  title: string;
  author: string;
  published_date: string;
  main_image_url: string;
  main_image_caption?: string;
  
  // Full content
  html_content: string;        // Full HTML of article body
  text_content: string;        // Plain text content
  paragraphs: string[];        // Array of paragraph texts
  images: string[];            // All image URLs in article
  links: ArticleLink[];        // All links in article
  
  // Metadata
  tags: string[];
  word_count: number;
  reading_time_minutes: number;
  scraped_at: Date;
}

export interface ArticleLink {
  text: string;
  url: string;
  type: 'internal' | 'external';
}

export interface ContentScraperProgress {
  currentArticle: number;
  totalArticles: number;
  articlesScraped: number;
  failed: number;
  status: 'running' | 'completed' | 'error' | 'stopped';
  message: string;
}

export type ContentProgressCallback = (progress: ContentScraperProgress) => void;

let currentBrowser: Browser | null = null;
let shouldStop = false;

/**
 * Scrape full content for a single article
 */
export async function scrapeArticleContent(
  articlePath: string,
  nid: string
): Promise<ArticleContent | null> {
  let browser: Browser | null = null;
  
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    const fullUrl = `https://www.edgeprop.sg/${articlePath}`;
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // Allow dynamic content to load
    
    // Extract article data
    const articleData = await page.evaluate(() => {
      // Get title - use h1 element
      const title = document.querySelector('h1')?.textContent?.trim() || '';
      
      // Get author - look for various patterns
      let author = '';
      
      // Try multiple approaches to find author
      const authorSelectors = [
        '[class*="author"]',
        '[class*="byline"]', 
        '.meta-author',
        '.article-author',
        '.post-author'
      ];
      
      // First try dedicated author elements
      for (const selector of authorSelectors) {
        const authorEl = document.querySelector(selector);
        if (authorEl?.textContent?.trim()) {
          author = authorEl.textContent.trim();
          break;
        }
      }
      
      // If no dedicated author element, look for "By" text in various elements
      if (!author) {
        const allElements = Array.from(document.querySelectorAll('div, span, p, time, [class*="date"], [class*="meta"]'));
        for (const el of allElements) {
          const text = el.textContent?.trim() || '';
          if (text.includes('By ') && text.length < 200 && 
              !text.includes('Terms and Conditions') &&
              !text.includes('Privacy Policy') &&
              !text.includes('Subscribe') &&
              !text.includes('account')) {
            // Extract author from "By Author Name" or "By Author Name / Publication" format
            const match = text.match(/By\s+([^/\n]+)/i);
            if (match) {
              const authorName = match[1].trim();
              // Validate it looks like a real name (not too long, no weird characters)
              if (authorName.length < 50 && !authorName.includes('http') && !authorName.includes('www')) {
                author = authorName;
                break;
              }
            }
          }
        }
      }
      
      // Get date - use multiple approaches
      let date = '';
      
      // Try time element with datetime attribute first
      const timeEl = document.querySelector('time[datetime]');
      if (timeEl) {
        date = timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || '';
      }
      
      // If no datetime attribute, try time element text
      if (!date) {
        const timeTextEl = document.querySelector('time');
        if (timeTextEl?.textContent?.trim()) {
          date = timeTextEl.textContent.trim();
        }
      }
      
      // Try date-related class selectors
       if (!date) {
         const dateSelectors = [
           '[class*="date"]',
           '[class*="published"]',
           '[class*="timestamp"]',
           '.meta-date',
           '.article-date',
           '.post-date'
         ];
         
         for (const selector of dateSelectors) {
           const dateEl = document.querySelector(selector);
           if (dateEl?.textContent?.trim()) {
             const text = dateEl.textContent.trim();
             // Skip if it's just author info or unwanted content
             if (!text.includes('By ') && 
                 !text.includes('Terms and Conditions') &&
                 !text.includes('Privacy Policy') &&
                 text.length < 100) {
               date = text;
               break;
             }
           }
         }
       }
       
       // Last resort: look for date patterns in text
       if (!date) {
         const allText = document.body.textContent || '';
         const datePatterns = [
           /(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/i,
           /(\d{4}-\d{2}-\d{2})/,
           /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i
         ];
         
         for (const pattern of datePatterns) {
           const match = allText.match(pattern);
           if (match) {
             date = match[0];
             break;
           }
         }
       }
      
      // Get main image - look for article images (not avatars or icons)
      const mainImageEl = Array.from(document.querySelectorAll('img')).find(img => {
        const src = img.src || '';
        const alt = img.alt || '';
        return src && 
               !src.includes('avatar') && 
               !src.includes('icon') && 
               !src.includes('logo') &&
               (src.includes('tepcdn.com') || src.includes('edgeprop')) &&
               img.width > 100 && img.height > 100; // Reasonable size for article image
      }) as HTMLImageElement;
      const mainImage = mainImageEl?.src || '';
      const mainImageCaption = mainImageEl?.alt || '';
      
      // Get article content - look for content containers with substantial text
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
      
      let contentElements: Element[] = [];
      
      // Try each selector and find the one with the most substantial content
      for (const selector of contentSelectors) {
        const elements = Array.from(document.querySelectorAll(selector));
        const substantialElements = elements.filter(el => {
          const text = el.textContent || '';
          return text.length > 200 && // Substantial content
                 !text.includes('!function') &&
                 !text.includes('fbq(') &&
                 !text.includes('obApi(') &&
                 !text.includes('vgo(') &&
                 !text.includes('window._peq');
        });
        
        if (substantialElements.length > 0) {
          contentElements = substantialElements;
          break;
        }
      }
      
      // If no content containers found, fall back to div filtering
      if (contentElements.length === 0) {
        contentElements = Array.from(document.querySelectorAll('div')).filter(el => {
          const text = el.textContent || '';
          return text.length > 100 && 
                 !el.querySelector('h1, h2, h3') && 
                 !el.querySelector('button') &&
                 !el.querySelector('input') &&
                 !el.querySelector('script') &&
                 !el.querySelector('style') &&
                 !el.textContent?.includes('Subscribe') &&
                 !el.textContent?.includes('!function') &&
                 !el.textContent?.includes('fbq(') &&
                 !el.textContent?.includes('obApi(') &&
                 !el.textContent?.includes('vgo(') &&
                 !el.textContent?.includes('window._peq') &&
                 !el.textContent?.includes('Check out our insightful property news') &&
                 !el.textContent?.includes('We also provide fruitful information') &&
                 el.children.length === 0; // Leaf node
        });
      }
      
      // Extract paragraphs from content elements
      const rawParagraphs: string[] = [];
      
      for (const contentEl of contentElements) {
        // If it's a container with multiple paragraphs, extract them
        const paragraphElements = contentEl.querySelectorAll('p');
        if (paragraphElements.length > 0) {
          paragraphElements.forEach(p => {
            const text = p.textContent?.trim();
            if (text && text.length > 20) {
              rawParagraphs.push(text);
            }
          });
        } else {
          // If it's a single content block, split by line breaks or use as is
          const text = contentEl.textContent?.trim();
          if (text && text.length > 50) {
            // Try to split into logical paragraphs
            const sentences = text.split(/\.\s+/).filter(s => s.trim().length > 20);
            if (sentences.length > 1) {
              sentences.forEach(sentence => {
                if (sentence.trim().length > 20) {
                  rawParagraphs.push(sentence.trim() + (sentence.endsWith('.') ? '' : '.'));
                }
              });
            } else {
              rawParagraphs.push(text);
            }
          }
        }
      }
      
      // Clean paragraphs inline (browser context)
      const paragraphs = rawParagraphs
        .filter((para: string) => {
          const cleanPara = para?.trim() || '';
          return cleanPara.length > 20 && 
                 !cleanPara.includes('!function') && 
                 !cleanPara.includes('fbq(') && 
                 !cleanPara.includes('obApi(') && 
                 !cleanPara.includes('vgo(') && 
                 !cleanPara.includes('window._peq') &&
                 !cleanPara.includes('in_article_inread_ad') &&
                 !cleanPara.includes('Banner_Article') &&
                 !cleanPara.includes('<img height="1"') &&
                 !cleanPara.includes('Check out our insightful property news') &&
                 !cleanPara.includes('We also provide fruitful information') &&
                 !cleanPara.includes('Click into any listing to check out the new AI Redesign tool') &&
                 !cleanPara.includes('Make data-driven property decisions with our easy-to-use free and paid tools') &&
                 !cleanPara.includes('The Edge Fair Value tool lets users calculate the fair value of a property') &&
                 !cleanPara.includes('The En Bloc Calculator helps to determine the probability of a Singapore project being put up for collective sale');
        })
        .filter((para: string, index: number, array: string[]) => 
          array.indexOf(para) === index // Remove duplicates
        );
      
      // Get all images in article
      const images = Array.from(document.querySelectorAll('img'))
        .map(img => (img as HTMLImageElement).src)
        .filter(src => src && !src.includes('logo') && !src.includes('icon'));
      
      // Get all links
      const links = Array.from(document.querySelectorAll('a[href]'))
        .filter(a => {
          const href = (a as HTMLAnchorElement).href;
          return href && !href.includes('facebook') && !href.includes('telegram') && a.textContent?.trim();
        })
        .map(a => {
          const href = (a as HTMLAnchorElement).href;
          const isInternal = href.includes('edgeprop.sg');
          return {
            text: a.textContent?.trim() || '',
            url: href,
            type: isInternal ? 'internal' : 'external'
          };
        });
      
      // Get tags
      const tagEls = Array.from(document.querySelectorAll('a[href*="field_tags_tid"]'));
      const tags = tagEls.map(el => el.textContent?.trim() || '');
      
      // Get full HTML content (article body) - improved selection
      const contentContainer = Array.from(document.querySelectorAll('div')).find(el => {
        const text = el.textContent || '';
        return el.querySelectorAll('div').length > 3 && 
               text.length > 500 &&
               !text.includes('!function') &&
               !text.includes('fbq(') &&
               !text.includes('obApi(') &&
               !text.includes('vgo(') &&
               !text.includes('window._peq') &&
               !text.includes('Check out our insightful property news') &&
               !text.includes('We also provide fruitful information');
      });
      
      // Clean up HTML content by removing scripts and tracking elements
      const htmlContent = contentContainer?.innerHTML || '';
      
      // Calculate text content
      const textContent = paragraphs.join('\n\n');
      const wordCount = textContent.split(/\s+/).length;
      const readingTime = Math.ceil(wordCount / 200); // 200 words per minute
      
      return {
        title,
        author,
        publishedDate: date,
        mainImage,
        mainImageCaption,
        paragraphs,
        images,
        links,
        tags,
        htmlContent,
        textContent,
        wordCount,
        readingTime
      };
    });
    
    await browser.close();
    
    return {
      nid,
      path: articlePath,
      title: articleData.title,
      author: articleData.author,
      published_date: articleData.publishedDate,
      main_image_url: articleData.mainImage,
      main_image_caption: articleData.mainImageCaption,
      html_content: sanitizeHtmlContent(articleData.htmlContent),
      text_content: articleData.textContent,
      paragraphs: articleData.paragraphs,
      images: articleData.images,
      links: articleData.links as ArticleLink[],
      tags: articleData.tags,
      word_count: articleData.wordCount,
      reading_time_minutes: articleData.readingTime,
      scraped_at: new Date()
    };
    
  } catch (_error) {
    console.error(`Failed to scrape article ${articlePath}:`, _error instanceof Error ? _error.message : String(_error));
    if (browser) await browser.close();
    return null;
  }
}

/**
 * Scrape full content for multiple articles (batch)
 */
export async function scrapeMultipleArticles(
  articles: Array<{ nid: string; path: string }>,
  onProgress?: ContentProgressCallback
): Promise<ArticleContent[]> {
  shouldStop = false;
  const results: ArticleContent[] = [];
  let failed = 0;
  
  try {
    currentBrowser = await chromium.launch({ headless: true });
    
    for (let i = 0; i < articles.length; i++) {
      if (shouldStop) {
        onProgress?.({
          currentArticle: i,
          totalArticles: articles.length,
          articlesScraped: results.length,
          failed,
          status: 'stopped',
          message: 'Scraping stopped by user'
        });
        break;
      }
      
      const article = articles[i];
      
      onProgress?.({
        currentArticle: i + 1,
        totalArticles: articles.length,
        articlesScraped: results.length,
        failed,
        status: 'running',
        message: `Scraping article ${i + 1}/${articles.length}: ${article.path}`
      });
      
      const content = await scrapeArticleContent(article.path, article.nid);
      
      if (content) {
        results.push(content);
      } else {
        failed++;
      }
      
      // Respectful delay between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    if (currentBrowser) {
      await currentBrowser.close();
      currentBrowser = null;
    }
    
    if (!shouldStop) {
      onProgress?.({
        currentArticle: articles.length,
        totalArticles: articles.length,
        articlesScraped: results.length,
        failed,
        status: 'completed',
        message: `Completed! Scraped ${results.length} articles, ${failed} failed`
      });
    }
    
  } catch (_error) {
    if (currentBrowser) {
      await currentBrowser.close();
      currentBrowser = null;
    }
    
    onProgress?.({
      currentArticle: 0,
      totalArticles: articles.length,
      articlesScraped: results.length,
      failed,
      status: 'error',
      message: `Error: ${_error instanceof Error ? _error.message : String(_error)}`
    });
  }
  
  return results;
}

/**
 * Stop the scraper
 */
export async function stopContentScraper() {
  shouldStop = true;
  if (currentBrowser) {
    await currentBrowser.close();
    currentBrowser = null;
  }
}

