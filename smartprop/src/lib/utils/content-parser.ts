/**
 * Content parsing utilities for articles
 * Based on best practices for HTML entity decoding and content sanitization
 */

/**
 * Decode HTML entities in text content
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  
  return text
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003d/g, '=')
    .replace(/\\u0022/g, '"')
    .replace(/\\u0027/g, "'")
    .replace(/\\u0020/g, ' ')
    .replace(/\\u0021/g, '!')
    .replace(/\\u0023/g, '#')
    .replace(/\\u0024/g, '$')
    .replace(/\\u0025/g, '%')
    .replace(/\\u0028/g, '(')
    .replace(/\\u0029/g, ')')
    .replace(/\\u002a/g, '*')
    .replace(/\\u002b/g, '+')
    .replace(/\\u002c/g, ',')
    .replace(/\\u002d/g, '-')
    .replace(/\\u002e/g, '.')
    .replace(/\\u002f/g, '/')
    .replace(/\\u003a/g, ':')
    .replace(/\\u003b/g, ';')
    .replace(/\\u003c/g, '<')
    .replace(/\\u003d/g, '=')
    .replace(/\\u003e/g, '>')
    .replace(/\\u003f/g, '?')
    .replace(/\\u0040/g, '@')
    .replace(/\\\\/g, '\\');
}

/**
 * Clean and filter article paragraphs
 */
export function cleanArticleParagraphs(paragraphs: string[]): string[] {
  if (!Array.isArray(paragraphs)) return [];
  
  return paragraphs
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
    .map((para: string) => decodeHtmlEntities(para))
    .filter((para: string, index: number, array: string[]) => 
      array.indexOf(para) === index // Remove duplicates
    );
}

/**
 * Check if content contains HTML links
 */
export function containsHtmlLinks(text: string): boolean {
  return text.includes('<a href=') || text.includes('<a target=');
}

/**
 * Sanitize HTML content for safe display
 */
export function sanitizeHtmlContent(html: string): string {
  if (!html) return '';
  
  // Remove script tags and their content
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove tracking pixels
  sanitized = sanitized.replace(/<img[^>]*height="1"[^>]*>/gi, '');
  
  // Remove ad placeholders
  sanitized = sanitized.replace(/in_article_inread_ad_\d+/gi, '');
  sanitized = sanitized.replace(/Banner_Article/gi, '');
  
  // Remove style attributes that might contain tracking
  sanitized = sanitized.replace(/style="[^"]*display\s*:\s*none[^"]*"/gi, '');
  
  return sanitized;
}

/**
 * Extract clean text content from mixed HTML/text
 */
export function extractCleanTextContent(text: string): string {
  if (!text) return '';
  
  // First decode HTML entities
  let cleanText = decodeHtmlEntities(text);
  
  // Remove HTML tags but preserve content
  cleanText = cleanText.replace(/<[^>]*>/g, '');
  
  // Clean up extra whitespace
  cleanText = cleanText.replace(/\s+/g, ' ').trim();
  
  return cleanText;
}
