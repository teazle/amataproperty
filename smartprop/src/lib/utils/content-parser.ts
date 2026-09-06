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

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Prepare scraped EdgeProp article HTML for display inside the admin article page.
 * Keeps editorial structure while removing EdgeProp runtime chrome/classes.
 */
export function prepareArticleHtmlForDisplay(html: string): string {
  if (!html) return '';

  let prepared = decodeHtmlEntities(html);

  prepared = prepared
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');

  prepared = prepared
    .replace(/<[^>]*class="[^"]*(?:related|article-contact|top-article|tags-content|property_news|common-header|footerv2|newsletter|subscribe|social|share)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
    .replace(/<[^>]*id="[^"]*(?:header|footer|in_article_inread_ad|Banner_Article)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
    .replace(/RELATED NEWS[\s\S]*$/i, '');

  prepared = prepared
    .replace(/\sclass="[^"]*"/gi, '')
    .replace(/\sstyle="[^"]*"/gi, '')
    .replace(/\sid="[^"]*"/gi, '')
    .replace(/\son[a-z]+="[^"]*"/gi, '')
    .replace(/\shref="javascript:[^"]*"/gi, '')
    .replace(/\ssrc="javascript:[^"]*"/gi, '')
    .replace(/<a\b(?![^>]*\btarget=)([^>]*)>/gi, '<a$1 target="_blank">')
    .replace(/<a\b(?![^>]*\brel=)([^>]*)>/gi, '<a$1 rel="noopener noreferrer">')
    .replace(/<img\b([^>]*)>/gi, (_match, rawAttrs) => {
      const attrs = String(rawAttrs);
      const selfClosing = attrs.trimEnd().endsWith('/');
      let cleanAttrs = selfClosing ? attrs.trimEnd().slice(0, -1) : attrs;

      if (!/\sloading=/i.test(cleanAttrs)) {
        cleanAttrs += ' loading="lazy"';
      }

      if (!/\sdecoding=/i.test(cleanAttrs)) {
        cleanAttrs += ' decoding="async"';
      }

      return `<img${cleanAttrs}${selfClosing ? ' /' : ''}>`;
    });

  const leafDivPattern = /<div\b[^>]*>((?:(?!<\/?div\b)[\s\S])*?)<\/div>/gi;

  for (let index = 0; index < 8; index += 1) {
    const nextPrepared = prepared.replace(leafDivPattern, (match, content) => {
      const text = stripHtmlTags(content).trim();
      const containsBlockContent = /<(?:p|h[1-6]|ul|ol|li|table|figure|img|video|blockquote)\b/i.test(content);

      if (!text || containsBlockContent) {
        return match;
      }

      return `<p>${String(content).trim()}</p>`;
    });

    if (nextPrepared === prepared) {
      break;
    }

    prepared = nextPrepared;
  }

  prepared = prepared
    .replace(/<p>([^<]*(?:homes|condos|flats|rents|prices|launches|resales|transactions|market|sales)[^<]*)<\/p>/gi, (match, heading) => {
      const trimmed = String(heading).trim();
      const looksLikeSectionHeading = trimmed.length <= 120 && (
        trimmed.includes('—') ||
        /^HDB flats\b/i.test(trimmed) ||
        /^Want more insights\??$/i.test(trimmed)
      );
      return looksLikeSectionHeading ? `<h2>${trimmed}</h2>` : match;
    })
    .replace(/<div>\s*<\/div>/gi, '')
    .replace(/<span>\s*<\/span>/gi, '');

  return prepared.replace(/\n{3,}/g, '\n\n').trim();
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
