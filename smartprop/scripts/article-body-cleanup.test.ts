import { expect, test } from 'bun:test';
import daintreeFooter from './fixtures/daintree-article-footer.json';
import articleWidgets from './fixtures/article-widgets-20260909.json';
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

test('keeps editorial prose that begins with related news when no related-news bundle is present', () => {
  const cleaned = cleanArticleBody({
    html: '<article><p>Related news coverage shows buyers are responding to new supply.</p></article>',
    paragraphs: ['Related news coverage shows buyers are responding to new supply.'],
  });

  expect(cleaned.paragraphs).toEqual([
    'Related news coverage shows buyers are responding to new supply.',
  ]);
  expect(cleaned.text).toBe('Related news coverage shows buyers are responding to new supply.');
});

test('keeps editorial related-news prose alongside a real related-news footer', () => {
  const editorial = 'Related news coverage shows buyers are responding to new supply.';
  const cleaned = cleanArticleBody({
    html: `<p>${editorial}</p><div class="related-news"><div class="related-news--title">RELATED NEWS</div><ul><li>Another sale &amp; analysis</li></ul></div>`,
    paragraphs: [editorial, 'RELATED NEWSAnother sale & analysis'],
  });
  expect(cleaned.paragraphs).toEqual([editorial]);
  expect(cleaned.text).toBe(editorial);
  expect(cleaned.html).toBe(`<p>${editorial}</p>`);
});

test('strips the Coliwoo reaction prompt and emoji merged before a genuine editorial sentence', () => {
  const cleaned = cleanArticleBody({
    html: articleWidgets.coliwooReactionBeforeProse.html,
    paragraphs: articleWidgets.coliwooReactionBeforeProse.paragraphs,
  });

  expect(cleaned.paragraphs).toEqual([
    'Co-living business Coliwoo Holdings has lodged its preliminary prospectus with the Monetary Authority of Singapore (MAS) in relation to its proposed listing on the Mainboard of the Singapore Exchange.',
    'Read also: Coliwoo posts 93.7% occupancy in 3QFY2026 as portfolio holds at 28 properties with 3,568 rooms Coliwoo had cash and cash equivalents of about $28.4 million and indebtedness of about $252.5 million as at end August 2025.',
    'It generated net cash from operating activities of about $15.4 million and $10.6 million for FY2024 and 1HFY2025, respectively.',
    'The cornerstone investors in Coliwoo are Albizia Capital, Avanda Investment Management, B&I Capital, ICHAM Master Fund VCC, Maybank Asset Management, Maybank Securities, UOB Asset Management, Value Partners Hong Kong and Whitefield Capital Management.',
  ]);
  expect(cleaned.text).toBe(cleaned.paragraphs.join('\n\n'));
  expect(cleaned.text).not.toContain('What do you think of this article?');
  expect(cleaned.text).not.toContain('❤️');
  expect(cleaned.text).not.toContain('😡');
  expect(cleaned.html).not.toContain('article-reaction-container');
  expect(cleaned.html).not.toContain('What do you think of this article?');
  expect(cleaned.html).not.toContain('related-news');
  expect(cleaned.html).toContain('Coliwoo had cash and cash equivalents');
  expect(cleaned.html).toContain('The cornerstone investors in Coliwoo');
});

test('strips the SEAA reaction widget merged after the final editorial paragraph', () => {
  const seaa = articleWidgets.seaaReactionAfterProse;
  const cleaned = cleanArticleBody({ html: seaa.html, paragraphs: seaa.paragraphs });

  expect(cleaned.paragraphs.slice(0, 5)).toEqual(seaa.paragraphs.slice(0, 5));
  expect(cleaned.paragraphs[5]).toBe(
    'Our new identity and logo reflect our vision for a future where estate agents are recognised for their integrity, expertise, and contribution to Singapore’s property market."Read also: SEAA and EdgeProp launch multi-listing system (MLS) for co-broking among real estate agent members',
  );
  expect(cleaned.text).toBe(cleaned.paragraphs.join('\n\n'));
  expect(cleaned.text).not.toContain('What do you think of this article?');
  expect(cleaned.text).not.toContain('❤️');
  expect(cleaned.html).not.toContain('article-reaction-container');
  expect(cleaned.html).not.toContain('What do you think of this article?');
  expect(cleaned.html).toContain('Our new identity and logo reflect');
});

test('retains the residual RELATED NEWS bundle when the html has no related-news div', () => {
  const residual = articleWidgets.hdbResidualRelatedNewsBundle;
  const cleaned = cleanArticleBody({ html: residual.html, paragraphs: residual.paragraphs });

  // The captured html carries no related-news element for this bundle, so its text
  // has no source-backed removal evidence: keep it verbatim for controller
  // withholding instead of truncating from the uppercase label.
  expect(cleaned.paragraphs).toEqual(residual.paragraphs);
  expect(cleaned.text).toBe(cleaned.paragraphs.join('\n\n'));
  expect(cleaned.html).not.toContain('related-news');
  expect(cleaned.html).toContain('For eligible buyers, the BTO flat');
});

test('keeps editorial emoji that is not part of the reaction widget', () => {
  const cleaned = cleanArticleBody({
    html: '<p>Occupancy crossed 95% 🎉 this quarter.</p>',
    paragraphs: ['Occupancy crossed 95% 🎉 this quarter.'],
  });

  expect(cleaned.paragraphs).toEqual(['Occupancy crossed 95% 🎉 this quarter.']);
});

test('keeps uppercase editorial RELATED NEWS prose when no related-news widget exists', () => {
  const paragraph = 'The editor wrote RELATED NEWS coverage should preserve this genuine sentence.';
  const cleaned = cleanArticleBody({ html: `<p>${paragraph}</p>`, paragraphs: [paragraph] });

  expect(cleaned.text).toBe(paragraph);
  expect(cleaned.paragraphs).toEqual([paragraph]);
  expect(cleaned.html).toBe(`<p>${paragraph}</p>`);
});

test('keeps an editorial reaction-prompt quotation when no reaction widget exists', () => {
  const paragraph = 'A reader asked, "What do you think of this article?" in the comments.';
  const cleaned = cleanArticleBody({ html: `<p>${paragraph}</p>`, paragraphs: [paragraph] });

  expect(cleaned.text).toBe(paragraph);
  expect(cleaned.paragraphs).toEqual([paragraph]);
  expect(cleaned.html).toBe(`<p>${paragraph}</p>`);
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
