import { describe, expect, test } from 'bun:test';
import { prepareArticleHtmlForDisplay } from '../src/lib/utils/content-parser';

describe('prepareArticleHtmlForDisplay', () => {
  test('keeps article body HTML while removing EdgeProp related-news and unsafe content', () => {
    const html = `
      <div class="jsx-3981703210 article-detail left-section">
        <div class="jsx-314912107 detail-content">
          <p>Here is this week’s data-led look at Singapore’s property market.</p>
          <h2>Non-landed private homes</h2>
          <p>Hudson Place Residences led new launch transactions.</p>
          <figure>
            <img src="https://example.com/hudson.jpg" alt="Hudson Place" />
            <figcaption>Hudson Place Residences. (Photo: EdgeProp)</figcaption>
          </figure>
          <p>Read the <a href="/property-news/market-watch">market watch</a>.</p>
          <script>alert('xss')</script>
          <div class="related-articles">RELATED NEWSWhat’s moving the market last week</div>
        </div>
      </div>
    `;

    const prepared = prepareArticleHtmlForDisplay(html);

    expect(prepared).toContain('<p>Here is this week’s data-led look at Singapore’s property market.</p>');
    expect(prepared).toContain('<h2>Non-landed private homes</h2>');
    expect(prepared).toContain('<figure>');
    expect(prepared).toContain('<img src="https://example.com/hudson.jpg" alt="Hudson Place"');
    expect(prepared).toContain('<a href="/property-news/market-watch"');
    expect(prepared).not.toContain('<script');
    expect(prepared).not.toContain('RELATED NEWS');
    expect(prepared).not.toContain('related-articles');
    expect(prepared).not.toContain('jsx-');
  });

  test('turns nested EdgeProp leaf div text into readable paragraphs and headings', () => {
    const html = `
      <div class="jsx-3981703210 detail-content">
        <div><div><div>Here is this week’s data-led look at Singapore’s property market.</div></div></div>
        <div><div><div>Non-landed private homes — new launches, resales and rents</div></div></div>
        <div><div><img src="https://example.com/chart.jpg" alt="Chart" /></div></div>
      </div>
    `;

    const prepared = prepareArticleHtmlForDisplay(html);

    expect(prepared).toContain('<p>Here is this week’s data-led look at Singapore’s property market.</p>');
    expect(prepared).toContain('<h2>Non-landed private homes — new launches, resales and rents</h2>');
    expect(prepared).toContain('<img src="https://example.com/chart.jpg" alt="Chart"');
  });
});
