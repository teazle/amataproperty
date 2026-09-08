import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { extractEdgePropArticleMetadata } from '../src/lib/scraper/edgeprop-article-metadata';

const capturedMetadataMarkup = `
  <div id="article-detail-otherinfo" class="jsx-3981703210 otherinfo createdbydate">
    <div class="jsx-2980479574 article-info-left">
      <div class="jsx-2980479574 article-info-content-wrapper">
        <div class="jsx-2980479574 article-info-img-wrapper">
          <a href="/property-news-author/atiqah-mokhtar" class="jsx-2980479574">
            <img src="https://img.tepcdn.com/img-style/simplecrop_article/89702505.jpg" alt="Atiqah Mokhtar" loading="lazy" class="jsx-2980479574">
          </a>
        </div>
        <div class="jsx-2980479574 article-info-text-wrapper">
          <div class="jsx-2980479574 article-info-author-source">
            <div class="article-info-author-name-wrapper"><a href="/property-news-author/atiqah-mokhtar">Atiqah Mokhtar</a></div>
            <div class="article-info-author-name-wrapper"> / EdgeProp Singapore</div>
          </div>
          <div class="jsx-2980479574 article-info-time"><time datetime="2026-09-07T16:40:44+08:00">September 7, 2026 4:40 PM SGT</time></div>
        </div>
      </div>
    </div>
  </div>
`;

const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(localChrome) ? { executablePath: localChrome } : {}),
});

afterAll(async () => {
  await browser.close();
});

describe('EdgeProp article metadata extraction', () => {
  test('reproduces the legacy selector choosing the createdbydate ancestor before the nested datetime', async () => {
    const page = await browser.newPage();
    await page.setContent(capturedMetadataMarkup);

    const legacySelection = await page.evaluate(() => {
      const element = document.querySelector('time, [class*="date"], [class*="published"], meta[property="article:published_time"]');
      return {
        id: element?.id || '',
        tag: element?.tagName || '',
        datetime: element?.getAttribute('datetime') || '',
      };
    });

    expect(legacySelection).toEqual({
      id: 'article-detail-otherinfo',
      tag: 'DIV',
      datetime: '',
    });
    await page.close();
  });

  test('uses the canonical author heading and scoped datetime from the captured article metadata DOM', async () => {
    const page = await browser.newPage();
    await page.setContent(capturedMetadataMarkup);

    const metadata = await page.evaluate(extractEdgePropArticleMetadata);

    expect(metadata).toEqual({
      author: 'Atiqah Mokhtar',
      created: '2026-09-07T16:40:44+08:00',
    });
    await page.close();
  });

  test('uses the explicit published-time meta tag when no scoped datetime is present', async () => {
    const page = await browser.newPage();
    await page.setContent('<meta property="article:published_time" content="2026-09-06T09:30:00+08:00">');

    const metadata = await page.evaluate(extractEdgePropArticleMetadata);

    expect(metadata).toEqual({
      author: '',
      created: '2026-09-06T09:30:00+08:00',
    });
    await page.close();
  });
});
