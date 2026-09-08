import { strict as assert } from 'node:assert';
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

try {
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
  assert.deepEqual(legacySelection, {
    id: 'article-detail-otherinfo',
    tag: 'DIV',
    datetime: '',
  });

  const metadata = await page.evaluate(extractEdgePropArticleMetadata);
  assert.deepEqual(metadata, {
    author: 'Atiqah Mokhtar',
    created: '2026-09-07T16:40:44+08:00',
  });

  await page.close();
  console.log('PASS: EdgeProp browser metadata acceptance');
} finally {
  await browser.close();
}
