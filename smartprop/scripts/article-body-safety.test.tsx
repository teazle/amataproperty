import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArticleBodyRenderer } from '../src/app/admin/articles/ArticleBodyRenderer';

test('scraped HTML cannot create executable elements or event handlers in the article page', () => {
  const html = renderToStaticMarkup(createElement(ArticleBodyRenderer, { content: {
    html_content: '<p>Safe editorial text remains readable.</p><img src=x onerror=alert(1)><svg onload=alert(1)></svg><a href="javascript:alert(1)">unsafe link</a>',
  } }));
  expect(html).toContain('Safe editorial text remains readable.');
  expect(html).not.toContain('onerror=');
  expect(html).not.toContain('<svg');
  expect(html).not.toContain('href="javascript:');
});

test('paragraph fallback escapes scraped links and preserves supplied media captions', () => {
  const html = renderToStaticMarkup(createElement(ArticleBodyRenderer, { content: {
    paragraphs: ['A market update with <a href=x onmouseover=alert(1)>unsafe markup</a> in the source.'],
    images: [{ url: 'https://example.invalid/chart.png', caption: 'Market chart', paragraph_index: 0 }],
  } }));
  expect(html).toContain('unsafe markup');
  expect(html).not.toContain('onmouseover');
  expect(html).toContain('<figcaption>Market chart</figcaption>');
});
