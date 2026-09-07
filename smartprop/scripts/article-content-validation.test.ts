import { beforeEach, describe, expect, mock, test } from 'bun:test';

const persistedRows: unknown[] = [];
const browserResponses: Array<Record<string, unknown>> = [];
let browserCloseCount = 0;

const fakeSupabase = {
  from(table: string) {
    if (table === 'scraped_articles') {
      return {
        select: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: { id: 'article-1' }, error: null }),
            }),
            maybeSingle: async () => ({ data: { id: 'article-1' }, error: null }),
          }),
          order: () => ({
            range: async () => ({
              data: [
                { id: 'article-good', nid: 'good-1', title: 'Good article', path: '/property-news/good' },
                { id: 'article-blocked', nid: 'blocked-1', title: 'Blocked article', path: '/property-news/blocked' },
              ],
              error: null,
            }),
          }),
        }),
      };
    }

    if (table === 'article_full_content') {
      return {
        select: () => ({
          in: async () => ({ data: [], error: null }),
        }),
        upsert: async (row: unknown) => {
          persistedRows.push(row);
          return { error: null };
        },
      };
    }

    throw new Error(`unexpected table: ${table}`);
  },
};

mock.module('@supabase/supabase-js', () => ({
  createClient: () => fakeSupabase,
}));

mock.module('patchright', () => ({
  chromium: {
    launch: async () => ({
      newPage: async () => ({
        setDefaultTimeout: () => undefined,
        setDefaultNavigationTimeout: () => undefined,
        goto: async () => undefined,
        waitForTimeout: async () => undefined,
        evaluate: async () => {
          const response = browserResponses.shift();
          if (!response) throw new Error('missing fake browser response');
          return response;
        },
      }),
      close: async () => {
        browserCloseCount++;
      },
    }),
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE = 'test-service-role';

const { upsertArticleContent } = await import('../src/lib/db/article-content');
const { validateArticleContent } = await import('../src/lib/scraper/article-content-validation');
const { scrapeMultipleArticles } = await import('../src/lib/scraper/edgeprop-content-scraper');
const { backfillMissingArticleContent } = await import('../src/lib/scraper/article-content-backfill');

const challengeContent = {
  nid: 'challenge-1',
  path: '/property-news/challenge',
  title: 'www.edgeprop.sg',
  author: '',
  published_date: '',
  main_image_url: '',
  html_content: '<div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div>',
  text_content: 'www.edgeprop.sg Performing security verification This website uses a security service to protect against malicious bots. This page is displayed while the website verifies you are not a bot. Verification successful. Waiting for www.edgeprop.sg to respond Enable JavaScript and cookies to continue',
  paragraphs: ['www.edgeprop.sg Performing security verification This website uses a security service to protect against malicious bots.'],
  images: [],
  links: [],
  tags: [],
  word_count: 40,
  reading_time_minutes: 1,
  scraped_at: new Date('2026-09-06T00:00:00.000Z'),
};

beforeEach(() => {
  persistedRows.length = 0;
  browserResponses.length = 0;
  browserCloseCount = 0;
});

function browserArticle(title: string, textContent: string, htmlContent: string) {
  return {
    title,
    author: 'Reporter',
    publishedDate: '2026-09-06',
    mainImage: '',
    mainImageCaption: '',
    paragraphs: [textContent],
    images: [],
    links: [],
    tags: [],
    htmlContent,
    textContent,
    wordCount: textContent.split(/\s+/).length,
    readingTime: 1,
  };
}

describe('article content persistence', () => {
  test('does not persist an EdgeProp verification challenge body', async () => {
    await expect(upsertArticleContent(challengeContent)).rejects.toThrow('challenge');
    expect(persistedRows).toHaveLength(0);
  });

  test('persists a valid article body', async () => {
    const validContent = {
      ...challengeContent,
      nid: 'valid-1',
      path: '/property-news/valid',
      title: 'Market update',
      text_content: 'Buyers returned to the market after new listings gave them more choice.',
      html_content: '<p>Buyers returned to the market after new listings gave them more choice.</p>',
      paragraphs: ['Buyers returned to the market after new listings gave them more choice.'],
      word_count: 12,
    };

    await upsertArticleContent(validContent);

    expect(persistedRows).toHaveLength(1);
    expect(persistedRows[0]).toMatchObject({ text_content: validContent.text_content });
  });
});

describe('article content validation', () => {
  test('identifies the captured EdgeProp verification page from its page-level signals', () => {
    expect(validateArticleContent({
      title: challengeContent.title,
      text: challengeContent.text_content,
      html: challengeContent.html_content,
    })).toEqual({ valid: false, reason: 'challenge' });
  });

  test('identifies the EdgeProp challenge error markup with its title-shell context', () => {
    expect(validateArticleContent({
      title: 'www.edgeprop.sg',
      text: 'Enable JavaScript and cookies to continue',
      html: '<div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div>',
    })).toEqual({ valid: false, reason: 'challenge' });
  });

  test('rejects an empty article body', () => {
    expect(validateArticleContent({ title: 'Brief update', text: ' ', html: '<div> </div>' }))
      .toEqual({ valid: false, reason: 'empty' });
  });

  test('keeps a short article that mentions security', () => {
    expect(validateArticleContent({
      title: 'Building security upgrade',
      text: 'The security team completed the lift upgrade today.',
      html: '<p>The security team completed the lift upgrade today.</p>',
    })).toEqual({ valid: true });
  });

  test('keeps an editorial article discussing Cloudflare verification', () => {
    expect(validateArticleContent({
      title: 'Why Cloudflare security verification appears before some property searches',
      text: 'Cloudflare security verification can appear when a visitor changes networks. The publisher said the verification step protects readers without changing the article itself.',
      html: '<article><p>Cloudflare security verification can appear when a visitor changes networks.</p><p>The publisher said the verification step protects readers without changing the article itself.</p></article>',
    })).toEqual({ valid: true });
  });

  test('returns only valid content from a mixed scraper batch and closes every browser', async () => {
    browserResponses.push(
      browserArticle(
        'Home sales improve',
        'Home sales improved this month after buyers returned to the market.',
        '<p>Home sales improved this month after buyers returned to the market.</p>',
      ),
      browserArticle(challengeContent.title, challengeContent.text_content, challengeContent.html_content),
    );

    const result = await scrapeMultipleArticles([
      { nid: 'good-1', path: '/property-news/good' },
      { nid: 'blocked-1', path: '/property-news/blocked' },
    ]);

    expect(result.map((article) => article.nid)).toEqual(['good-1']);
    expect(browserCloseCount).toBe(3);
  });

  test('backfill saves the valid body and counts the rejected challenge as failed', async () => {
    browserResponses.push(
      browserArticle(
        'Home sales improve',
        'Home sales improved this month after buyers returned to the market.',
        '<p>Home sales improved this month after buyers returned to the market.</p>',
      ),
      browserArticle(challengeContent.title, challengeContent.text_content, challengeContent.html_content),
    );

    const result = await backfillMissingArticleContent({
      limit: 2,
      supabase: fakeSupabase as never,
      onLog: () => undefined,
      articleTimeoutMs: 100,
    });

    expect(result).toEqual({ attempted: 2, saved: 1, failed: 1 });
    expect(persistedRows).toHaveLength(1);
    expect(persistedRows[0]).toMatchObject({
      text_content: 'Home sales improved this month after buyers returned to the market.',
    });
  });
});
