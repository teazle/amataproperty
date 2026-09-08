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
  const classToken = '(?:related-news|article-reaction-container|dfp-ads|ec_billboard_container|adunitContainer|adBox)';
  const matchingOpenTag = new RegExp(`<div\\b[^>]*\\bclass=(?:"[^"]*${classToken}[^"]*"|'[^']*${classToken}[^']*')[^>]*>`, 'i');
  let cleaned = html;
  let match: RegExpExecArray | null;

  while ((match = matchingOpenTag.exec(cleaned))) {
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

// Widget text is spliced out of paragraphs only when the captured html contains
// the matching widget element; a phrase matching a label by case alone is not
// evidence of widget content and never justifies removal.
function reactionWidgetTexts(html: string): string[] {
  const texts: string[] = [];
  const openingTag = /<div\b[^>]*\bclass=(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = openingTag.exec(html))) {
    if (!(match[1] ?? match[2]).split(/\s+/).includes('article-reaction-container')) continue;
    const end = findMatchingElementEnd(html, match.index, 'div');
    if (end === -1) continue;
    const text = html.slice(match.index, end).replace(/<[^>]*>/g, '').trim();
    if (text) texts.push(text);
    openingTag.lastIndex = end;
  }

  return texts;
}

function joinAtWidgetSeam(before: string, after: string): string {
  if (!before || !after) return before + after;
  return `${before.replace(/\s+$/, '')} ${after.replace(/^\s+/, '')}`;
}

function removeReactionWidgetText(text: string, widgetTexts: string[]): string {
  let cleaned = text;
  let spliced = false;

  for (const widgetText of widgetTexts) {
    let index = cleaned.indexOf(widgetText);
    while (index !== -1) {
      cleaned = joinAtWidgetSeam(cleaned.slice(0, index), cleaned.slice(index + widgetText.length));
      spliced = true;
      index = cleaned.indexOf(widgetText);
    }
  }

  return spliced ? cleaned.replace(/\s{2,}/g, ' ').trim() : text;
}

function normalizeBundleText(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, '');
}

function relatedNewsBundleTexts(html: string): Set<string> {
  const bundles = new Set<string>();
  const openingTag = /<div\b[^>]*\bclass=(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = openingTag.exec(html))) {
    if (!(match[1] ?? match[2]).split(/\s+/).includes('related-news')) continue;
    const end = findMatchingElementEnd(html, match.index, 'div');
    if (end === -1) continue;
    const text = html.slice(match.index, end).replace(/<[^>]*>/g, '');
    bundles.add(normalizeBundleText(text));
    openingTag.lastIndex = end;
  }
  return bundles;
}

function isFooterParagraph(paragraph: string, relatedNewsBundles: Set<string>): boolean {
  const normalized = paragraph.replace(/\s+/g, ' ').trim().toLowerCase();
  return footerPromotionParagraphs.has(normalized) ||
    relatedNewsBundles.has(normalizeBundleText(paragraph));
}

/**
 * Removes EdgeProp's structural article chrome after browser extraction.
 * This boundary keeps stored HTML, paragraphs, and text derived from one body.
 */
export function cleanArticleBody({ html, paragraphs }: ArticleBodyInput): CleanArticleBody {
  const sourceHtml = html || '';
  const relatedNewsBundles = relatedNewsBundleTexts(sourceHtml);
  const widgetTexts = reactionWidgetTexts(sourceHtml);
  let cleanedHtml = removeHtmlBlocksByClass(sourceHtml);
  cleanedHtml = removeElementContaining(cleanedHtml, 'For more news and analysis, read our');
  cleanedHtml = removeElementContaining(cleanedHtml, 'Get it delivered to your home every Monday.');
  cleanedHtml = cleanedHtml
    .replace(/<hr\b[^>]*\brelated-news--hr\b[^>]*>/gi, '')
    .replace(/(>\s*)Advertisement(?=\s*<)/gi, '$1')
    .replace(/Advertisement\s*Advertisement(?=[A-Z\s<]|$)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const cleanedParagraphs = (Array.isArray(paragraphs) ? paragraphs : [])
    .map(removeAdLabelRuns)
    .map((paragraph) => removeReactionWidgetText(paragraph, widgetTexts))
    .filter((paragraph) => paragraph.length > 0 && !isFooterParagraph(paragraph, relatedNewsBundles));

  return {
    html: cleanedHtml,
    paragraphs: cleanedParagraphs,
    text: cleanedParagraphs.join('\n\n'),
  };
}
