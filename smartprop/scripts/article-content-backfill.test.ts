import { describe, expect, test } from 'bun:test';
import {
  parseArticleContentBackfillLimit,
  selectArticlesMissingContent,
} from '../src/lib/scraper/article-content-backfill';

describe('article content backfill helpers', () => {
  test('selects only scraped articles without content up to the limit', () => {
    const missing = selectArticlesMissingContent(
      [
        { id: 'article-1', nid: '1', title: 'One', path: '/one' },
        { id: 'article-2', nid: '2', title: 'Two', path: '/two' },
        { id: 'article-3', nid: '3', title: 'Three', path: '/three' },
      ],
      new Set(['article-2']),
      1,
    );

    expect(missing).toEqual([
      { id: 'article-1', nid: '1', title: 'One', path: '/one' },
    ]);
  });

  test('parses all and zero backfill limits', () => {
    expect(parseArticleContentBackfillLimit('all')).toBeUndefined();
    expect(parseArticleContentBackfillLimit('0')).toBe(0);
  });
});
