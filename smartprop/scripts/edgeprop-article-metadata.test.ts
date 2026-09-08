import { describe, expect, test } from 'bun:test';

import {
  extractEdgePropArticleMetadata,
  type EdgePropMetadataDocument,
} from '../src/lib/scraper/edgeprop-article-metadata';

type SelectorElement = Pick<Element, 'getAttribute' | 'textContent'>;

function metadataDocument(selectors: Record<string, SelectorElement | null>, calls: string[] = []): EdgePropMetadataDocument {
  return {
    querySelector(selector: string) {
      calls.push(selector);
      return selectors[selector] || null;
    },
  } as EdgePropMetadataDocument;
}

function element(textContent: string, attributes: Record<string, string> = {}): SelectorElement {
  return {
    textContent,
    getAttribute(name: string) {
      return attributes[name] || null;
    },
  };
}

describe('EdgeProp article metadata extraction', () => {
  test('uses the canonical author and scoped datetime instead of a misleading date-like parent', () => {
    const calls: string[] = [];
    const metadata = extractEdgePropArticleMetadata(metadataDocument({
      '#article-detail-otherinfo .article-info-author-name-wrapper a': element('Atiqah Mokhtar'),
      '#article-detail-otherinfo time[datetime]': element('September 7, 2026 4:40 PM SGT', { datetime: '2026-09-07T16:40:44+08:00' }),
      'time, [class*="date"], [class*="published"], meta[property="article:published_time"]': element('Atiqah Mokhtar / EdgeProp Singapore September 7, 2026 4:40 PM SGT'),
    }, calls));

    expect(metadata).toEqual({
      author: 'Atiqah Mokhtar',
      created: '2026-09-07T16:40:44+08:00',
    });
    expect(calls).not.toContain('time, [class*="date"], [class*="published"], meta[property="article:published_time"]');
  });

  test('uses explicit published metadata before an unscoped time fallback', () => {
    const metadata = extractEdgePropArticleMetadata(metadataDocument({
      '#article-detail-otherinfo .article-info-author-name-wrapper a': null,
      '#article-detail-otherinfo time[datetime]': null,
      'meta[property="article:published_time"]': element('', { content: '2026-09-06T09:30:00+08:00' }),
      'time[datetime]': element('', { datetime: '2001-07-20T00:00:00+08:00' }),
    }));

    expect(metadata).toEqual({
      author: '',
      created: '2026-09-06T09:30:00+08:00',
    });
  });
});
