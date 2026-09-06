import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ArticleContentBackfillLimit = number | undefined;

export type ScrapedArticleForContent = {
  id: string;
  nid: string;
  title: string;
  path: string;
};

type BackfillOptions = {
  limit: ArticleContentBackfillLimit;
  supabase?: SupabaseClient;
  onLog?: (message: string) => void;
  articleTimeoutMs?: number;
};

type BackfillResult = {
  attempted: number;
  saved: number;
  failed: number;
};

const fetchBatchSize = 100;
const defaultArticleTimeoutMs = 120_000;

export function parseArticleContentBackfillLimit(
  value: string | undefined,
  fallback = 20,
): ArticleContentBackfillLimit {
  if (!value || value.trim() === '') {
    return fallback;
  }

  if (value.toLowerCase() === 'all') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('ARTICLE_CONTENT_BACKFILL_LIMIT must be a non-negative number or "all"');
  }

  return parsed;
}

export function selectArticlesMissingContent(
  articles: ScrapedArticleForContent[],
  contentArticleIds: Set<string>,
  limit: ArticleContentBackfillLimit,
): ScrapedArticleForContent[] {
  const missing = articles.filter((article) => !contentArticleIds.has(article.id));
  return limit === undefined ? missing : missing.slice(0, limit);
}

function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is required');
  }

  if (!supabaseServiceRole) {
    throw new Error('SUPABASE_SERVICE_ROLE environment variable is required');
  }

  return createClient(supabaseUrl, supabaseServiceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function fetchArticlesMissingContent(
  supabase: SupabaseClient,
  limit: ArticleContentBackfillLimit,
): Promise<ScrapedArticleForContent[]> {
  const missing: ScrapedArticleForContent[] = [];
  let offset = 0;

  while (limit === undefined || missing.length < limit) {
    const { data: articles, error: articleError } = await supabase
      .from('scraped_articles')
      .select('id, nid, title, path')
      .order('first_scraped_at', { ascending: false })
      .range(offset, offset + fetchBatchSize - 1);

    if (articleError) {
      throw articleError;
    }

    if (!articles?.length) {
      break;
    }

    const articleIds = articles.map((article) => article.id);
    const { data: contentRows, error: contentError } = await supabase
      .from('article_full_content')
      .select('article_id')
      .in('article_id', articleIds);

    if (contentError) {
      throw contentError;
    }

    const contentArticleIds = new Set((contentRows || []).map((row) => row.article_id as string));
    const remaining = limit === undefined ? undefined : limit - missing.length;
    missing.push(...selectArticlesMissingContent(
      articles as ScrapedArticleForContent[],
      contentArticleIds,
      remaining,
    ));

    if (articles.length < fetchBatchSize) {
      break;
    }

    offset += fetchBatchSize;
  }

  return missing;
}

function normalizeArticlePathForScrape(path: string) {
  return path.replace(/^\/+/, '');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function backfillMissingArticleContent({
  limit,
  supabase = createSupabaseClient(),
  onLog = console.log,
  articleTimeoutMs = Number.parseInt(process.env.ARTICLE_CONTENT_SCRAPE_TIMEOUT_MS || `${defaultArticleTimeoutMs}`, 10),
}: BackfillOptions): Promise<BackfillResult> {
  if (limit === 0) {
    onLog('[articles] content backfill disabled; limit=0');
    return { attempted: 0, saved: 0, failed: 0 };
  }

  const articles = await fetchArticlesMissingContent(supabase, limit);
  onLog(`[articles] content backfill candidates=${articles.length}`);

  let saved = 0;
  let failed = 0;
  const { scrapeArticleContent } = await import('./edgeprop-content-scraper');
  const { upsertArticleContent } = await import('../db/article-content');

  for (const article of articles) {
    try {
      onLog(`[articles] scraping full content: ${article.title}`);
      const content = await withTimeout(
        scrapeArticleContent(
          normalizeArticlePathForScrape(article.path),
          article.nid,
        ),
        articleTimeoutMs,
        `full content scrape for ${article.id}`,
      );

      if (!content?.text_content) {
        failed++;
        onLog(`[articles] failed full content: ${article.title}`);
        continue;
      }

      await withTimeout(
        upsertArticleContent(content),
        articleTimeoutMs,
        `full content save for ${article.id}`,
      );
      saved++;
      onLog(`[articles] saved full content: ${article.title} (${content.word_count} words)`);
    } catch (error) {
      failed++;
      onLog(`[articles] failed full content: ${article.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    attempted: articles.length,
    saved,
    failed,
  };
}
