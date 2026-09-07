import { expect, test } from 'bun:test';
import daintreeFooter from './fixtures/daintree-article-footer.json';
import { cleanArticleBody } from '../src/lib/scraper/article-body-cleanup';
import { scrapeArticleContent } from '../src/lib/scraper/edgeprop-content-scraper';

test('removes the captured Daintree footer, related-news bundle, and ad labels from every article body representation', () => {
  const cleaned = cleanArticleBody({
    html: daintreeFooter.html,
    paragraphs: daintreeFooter.paragraphs,
  });

  expect(cleaned.paragraphs).toEqual([
    'That average trails newer neighbouring developments, including 8 Napier ($3,329 psf) and The Nassim ($4,485 psf), but remains above older projects such as The Loft ($2,129 psf).',
    'Read also: Sale of four-bedder takes Geylang condo Parc Esta to new high of $2,679 psf Several schools are within a 1km radius of the development.',
  ]);
  expect(cleaned.text).toBe(cleaned.paragraphs.join('\n\n'));
  expect(cleaned.text).not.toContain('RELATED NEWS');
  expect(cleaned.text).not.toContain('AdvertisementAdvertisement');
  expect(cleaned.html).not.toContain('RELATED NEWS');
  expect(cleaned.html).not.toContain('Advertisement');
  expect(cleaned.html).not.toContain('For more news and analysis');
  expect(cleaned.html).not.toContain('related-news');
  expect(cleaned.html).not.toContain('dfp-ads');
});

test('keeps short editorial discussion of advertisements and related news', () => {
  const cleaned = cleanArticleBody({
    html: '<p>The advertisement was discussed in related news coverage.</p>',
    paragraphs: ['The advertisement was discussed in related news coverage.'],
  });

  expect(cleaned).toEqual({
    html: '<p>The advertisement was discussed in related news coverage.</p>',
    paragraphs: ['The advertisement was discussed in related news coverage.'],
    text: 'The advertisement was discussed in related news coverage.',
  });
});

test('applies the cleanup at the content extraction boundary before storing derived text and counts', async () => {
  const page = {
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    evaluate: async <T,>(_pageFunction: () => T): Promise<T> => ({
      title: 'Daintree price update',
      author: 'Reporter',
      publishedDate: '2026-09-07',
      mainImage: '',
      mainImageCaption: '',
      paragraphs: daintreeFooter.paragraphs,
      images: [],
      links: [],
      tags: [],
      htmlContent: daintreeFooter.html,
      textContent: daintreeFooter.paragraphs.join('\n\n'),
      wordCount: 999,
      readingTime: 5,
    } as T),
    close: async () => undefined,
  };

  const article = await scrapeArticleContent('/property-news/daintree', 'daintree-1', {
    context: { newPage: async () => page },
  });

  expect(article?.paragraphs).toHaveLength(2);
  expect(article?.text_content).toBe(article?.paragraphs.join('\n\n'));
  expect(article?.html_content).not.toContain('RELATED NEWS');
  expect(article?.word_count).not.toBe(999);
});
