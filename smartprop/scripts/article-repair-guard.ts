import { validateArticleContent } from '../src/lib/scraper/article-content-validation';

type RecordValue = Record<string, unknown>;

type ArticleRepairPatch = {
  text_content: string;
  html_content: string;
  paragraphs: string[];
  images: string[];
  links: RecordValue[];
  main_image_url: string | null;
  main_image_caption: string | null;
  tags: string[];
  word_count: number;
  reading_time_minutes: number;
  scraped_at: string | Date;
};

export type ArticleRepairPlan =
  | { status: 'ready'; patch: ArticleRepairPatch }
  | {
    status: 'skip';
    reason:
      | 'malformed_input'
      | 'id_mismatch'
      | 'original_changed'
      | 'invalid_timestamp'
      | 'current_valid'
      | 'replacement_identity_mismatch'
      | 'replacement_invalid'
      | 'replacement_insufficient';
  };

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function hasValidTimestamp(value: unknown): value is string | Date {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(new Date(value).getTime());
}

function stableEncode(value: unknown): string | null {
  if (value === null) return 'null';
  if (value instanceof Date) return hasValidTimestamp(value) ? `date:${value.toISOString()}` : null;

  switch (typeof value) {
    case 'string':
      return `string:${JSON.stringify(value)}`;
    case 'boolean':
      return `boolean:${value}`;
    case 'number':
      return Number.isFinite(value) ? `number:${value}` : null;
    case 'object': {
      if (Array.isArray(value)) {
        const items = value.map(stableEncode);
        return items.every((item): item is string => item !== null) ? `array:[${items.join(',')}]` : null;
      }
      if (!isRecord(value)) return null;
      const entries = Object.keys(value).sort().map((key) => {
        const encoded = stableEncode(value[key]);
        return encoded === null ? null : `${JSON.stringify(key)}:${encoded}`;
      });
      return entries.every((entry): entry is string => entry !== null) ? `object:{${entries.join(',')}}` : null;
    }
    default:
      return null;
  }
}

function normalizedEdgePropPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      (url.hostname.toLowerCase() !== 'edgeprop.sg' && url.hostname.toLowerCase() !== 'www.edgeprop.sg') ||
      url.port !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.pathname === '/'
    ) return null;
    return url.pathname;
  }

  if (trimmed.includes('?') || trimmed.includes('#')) return null;
  const withoutLeadingSlashes = trimmed.replace(/^\/+/, '');
  return withoutLeadingSlashes === '' ? null : `/${withoutLeadingSlashes}`;
}

function hasMeaningfulTitle(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalized.length >= 5 && ![
    'www.edgeprop.sg',
    'edgeprop',
    'page not found',
    'access denied',
    'performing security verification',
  ].includes(normalized);
}

function wordCount(text: string) {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

function isReplacementContent(value: RecordValue): value is RecordValue & Omit<ArticleRepairPatch, 'scraped_at' | 'main_image_url' | 'main_image_caption'> & {
  nid: string;
  path: string;
  title: string;
  scraped_at: unknown;
  main_image_url: string;
  main_image_caption?: string | null;
} {
  return (
    typeof value.nid === 'string' &&
    typeof value.path === 'string' &&
    typeof value.title === 'string' &&
    typeof value.text_content === 'string' &&
    typeof value.html_content === 'string' &&
    isStringArray(value.paragraphs) &&
    isStringArray(value.images) &&
    Array.isArray(value.links) && value.links.every(isRecord) &&
    typeof value.main_image_url === 'string' &&
    (typeof value.main_image_caption === 'undefined' || value.main_image_caption === null || typeof value.main_image_caption === 'string') &&
    isStringArray(value.tags) &&
    typeof value.word_count === 'number' && Number.isFinite(value.word_count) && value.word_count >= 0 &&
    typeof value.reading_time_minutes === 'number' && Number.isFinite(value.reading_time_minutes) && value.reading_time_minutes >= 0 &&
    'scraped_at' in value
  );
}

/**
 * Produces a content-only repair patch when an exact backup snapshot proves the
 * target has not changed and a replacement is a valid, matching editorial body.
 */
export function planApprovedArticleRepair(input: unknown): ArticleRepairPlan {
  if (!isRecord(input) || !isRecord(input.backup) || !isRecord(input.current) || !isRecord(input.article) || !isRecord(input.content)) {
    return { status: 'skip', reason: 'malformed_input' };
  }

  const { backup, current, article, content } = input;
  if (
    typeof backup.id !== 'string' || typeof current.id !== 'string' ||
    typeof backup.article_id !== 'string' || typeof current.article_id !== 'string' ||
    typeof article.id !== 'string' || typeof article.nid !== 'string' ||
    typeof article.path !== 'string' || typeof article.title !== 'string'
  ) return { status: 'skip', reason: 'malformed_input' };

  if (backup.id !== current.id || backup.article_id !== current.article_id || backup.article_id !== article.id) {
    return { status: 'skip', reason: 'id_mismatch' };
  }

  const backupSnapshot = stableEncode(backup);
  const currentSnapshot = stableEncode(current);
  if (backupSnapshot === null || currentSnapshot === null) return { status: 'skip', reason: 'malformed_input' };
  if (backupSnapshot !== currentSnapshot) return { status: 'skip', reason: 'original_changed' };

  for (const row of [backup, current]) {
    if (!hasValidTimestamp(row.created_at) || !hasValidTimestamp(row.updated_at) || !hasValidTimestamp(row.scraped_at)) {
      return { status: 'skip', reason: 'invalid_timestamp' };
    }
  }

  if ((current.text_content !== null && typeof current.text_content !== 'string') || (current.html_content !== null && typeof current.html_content !== 'string')) {
    return { status: 'skip', reason: 'malformed_input' };
  }
  if (validateArticleContent({ title: article.title, text: current.text_content ?? '', html: current.html_content ?? '' }).valid) {
    return { status: 'skip', reason: 'current_valid' };
  }

  if (!isReplacementContent(content)) return { status: 'skip', reason: 'malformed_input' };
  if (!hasValidTimestamp(content.scraped_at)) return { status: 'skip', reason: 'invalid_timestamp' };

  const contentPath = normalizedEdgePropPath(content.path);
  const articlePath = normalizedEdgePropPath(article.path);
  if (content.nid !== article.nid || contentPath === null || articlePath === null || contentPath !== articlePath) {
    return { status: 'skip', reason: 'replacement_identity_mismatch' };
  }

  if (!hasMeaningfulTitle(content.title) || !validateArticleContent({ title: content.title, text: content.text_content, html: content.html_content }).valid) {
    return { status: 'skip', reason: 'replacement_invalid' };
  }

  if (wordCount(content.text_content) < 80 || content.paragraphs.filter((paragraph) => paragraph.trim() !== '').length < 2) {
    return { status: 'skip', reason: 'replacement_insufficient' };
  }

  const patch: ArticleRepairPatch = {
    text_content: content.text_content,
    html_content: content.html_content,
    paragraphs: content.paragraphs,
    images: content.images,
    links: content.links,
    main_image_url: content.main_image_url || null,
    main_image_caption: content.main_image_caption || null,
    tags: content.tags,
    word_count: content.word_count,
    reading_time_minutes: content.reading_time_minutes,
    scraped_at: content.scraped_at,
  };
  return { status: 'ready', patch };
}
