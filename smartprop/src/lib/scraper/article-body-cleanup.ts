export interface ArticleBodyInput {
  html: string;
  paragraphs: string[];
}

export interface CleanArticleBody {
  html: string;
  paragraphs: string[];
  text: string;
}

const footerPromotionParagraphs = new Set([
  'for more news and analysis, read our weekly e-paper.',
  'get it delivered to your home every monday.',
]);

function findMatchingElementEnd(html: string, start: number, tag: string): number {
  const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  tagPattern.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html))) {
    const isClosingTag = match[0].startsWith('</');
    if (isClosingTag) {
      depth -= 1;
      if (depth === 0) return tagPattern.lastIndex;
    } else if (!match[0].endsWith('/>')) {
      depth += 1;
    }
  }

  return -1;
}

function removeElementContaining(html: string, marker: string): string {
  const markerIndex = html.toLowerCase().indexOf(marker.toLowerCase());
  if (markerIndex === -1) return html;

  const openingTag = /<(div|section|aside|p|li)\b[^>]*>/gi;
  let candidate: { index: number; tag: string } | null = null;
  let match: RegExpExecArray | null;

  while ((match = openingTag.exec(html)) && match.index < markerIndex) {
    candidate = { index: match.index, tag: match[1].toLowerCase() };
  }

  if (!candidate) return html;

  const end = findMatchingElementEnd(html, candidate.index, candidate.tag);
  return end === -1 ? html : `${html.slice(0, candidate.index)}${html.slice(end)}`;
}

function removeHtmlBlocksByClass(html: string): string {
  const classToken = '(?:related-news|dfp-ads|ec_billboard_container|adunitContainer|adBox)';
  const matchingOpenTag = new RegExp(`<div\\b[^>]*\\bclass=(?:"[^"]*${classToken}[^"]*"|'[^']*${classToken}[^']*')[^>]*>`, 'i');
  let cleaned = html;
  let match = matchingOpenTag.exec(cleaned);

  while (match) {
    const end = findMatchingElementEnd(cleaned, match.index, 'div');
    if (end === -1) break;
    cleaned = `${cleaned.slice(0, match.index)}${cleaned.slice(end)}`;
    match = matchingOpenTag.exec(cleaned);
  }

  return cleaned;
}

function removeAdLabelRuns(text: string): string {
  return text
    .replace(/Advertisement\s*Advertisement(?=[A-Z\s]|$)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function hasRelatedNewsBundle(html: string): boolean {
  return /class=(?:"[^"]*\brelated-news\b[^"]*"|'[^']*\brelated-news\b[^']*')/i.test(html) &&
    /RELATED NEWS/i.test(html);
}

function isFooterParagraph(paragraph: string, relatedNewsBundle: boolean): boolean {
  const normalized = paragraph.replace(/\s+/g, ' ').trim().toLowerCase();
  return footerPromotionParagraphs.has(normalized) ||
    (relatedNewsBundle && normalized.startsWith('related news'));
}

/**
 * Removes EdgeProp's structural article chrome after browser extraction.
 * This boundary keeps stored HTML, paragraphs, and text derived from one body.
 */
export function cleanArticleBody({ html, paragraphs }: ArticleBodyInput): CleanArticleBody {
  const relatedNewsBundle = hasRelatedNewsBundle(html || '');
  let cleanedHtml = removeHtmlBlocksByClass(html || '');
  cleanedHtml = removeElementContaining(cleanedHtml, 'For more news and analysis, read our');
  cleanedHtml = removeElementContaining(cleanedHtml, 'Get it delivered to your home every Monday.');
  cleanedHtml = cleanedHtml
    .replace(/(>\s*)Advertisement(?=\s*<)/gi, '$1')
    .replace(/Advertisement\s*Advertisement(?=[A-Z\s<]|$)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const cleanedParagraphs = (Array.isArray(paragraphs) ? paragraphs : [])
    .map(removeAdLabelRuns)
    .filter((paragraph) => paragraph.length > 0 && !isFooterParagraph(paragraph, relatedNewsBundle));

  return {
    html: cleanedHtml,
    paragraphs: cleanedParagraphs,
    text: cleanedParagraphs.join('\n\n'),
  };
}
