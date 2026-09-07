import { describe, expect, test } from 'bun:test';
import { planApprovedArticleRepair } from './article-repair-guard';

const editorialParagraphOne = 'Singapore home buyers returned to the private market this quarter as lower borrowing costs and a wider choice of completed units encouraged more viewings across mature estates. Agents said households remained selective, comparing transport links, school catchments, maintenance fees and renovation needs before making an offer. The strongest interest was concentrated in well-priced homes with practical layouts, while sellers who set expectations from recent transactions received earlier enquiries.';
const editorialParagraphTwo = 'Developers also reported steadier weekend traffic at launches near established amenities. Analysts expect resale activity to remain measured because buyers continue to watch employment conditions and new supply, but they said transparent pricing can help serious parties reach agreement. Homeowners considering a sale were advised to prepare documents early and to discuss timing with a qualified property professional before listing the home.';
const editorialText = `${editorialParagraphOne}\n\n${editorialParagraphTwo}`;

function article() {
  return {
    id: 'article-1',
    nid: 'edgeprop-321',
    path: '/property-news/home-market-update',
    title: 'Private home buyers return as borrowing costs ease',
  };
}

function originalRow() {
  return {
    id: 'content-1',
    article_id: 'article-1',
    text_content: 'www.edgeprop.sg Performing security verification',
    html_content: '<span id="challenge-error-text">Enable JavaScript and cookies to continue</span>',
    paragraphs: ['www.edgeprop.sg Performing security verification'],
    images: [],
    links: [],
    main_image_url: '',
    main_image_caption: '',
    tags: [],
    word_count: 6,
    reading_time_minutes: 1,
    scraped_at: '2026-09-06T10:00:00.000Z',
    created_at: '2026-09-06T10:00:00.000Z',
    updated_at: '2026-09-06T10:00:00.000Z',
  };
}

function replacement() {
  return {
    nid: 'edgeprop-321',
    path: 'https://www.edgeprop.sg/property-news/home-market-update',
    title: 'Private home buyers return as borrowing costs ease',
    text_content: editorialText,
    html_content: `<p>${editorialParagraphOne}</p><p>${editorialParagraphTwo}</p>`,
    paragraphs: [editorialParagraphOne, editorialParagraphTwo],
    images: ['https://cdn.example.invalid/market.jpg'],
    links: [{ text: 'Market data', url: 'https://www.edgeprop.sg/market', type: 'internal' }],
    main_image_url: 'https://cdn.example.invalid/market.jpg',
    main_image_caption: 'Apartments in Singapore',
    tags: ['market'],
    word_count: 119,
    reading_time_minutes: 1,
    scraped_at: '2026-09-07T10:00:00.000Z',
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return planApprovedArticleRepair({
    backup: originalRow(),
    current: originalRow(),
    article: article(),
    content: replacement(),
    ...overrides,
  });
}

describe('planApprovedArticleRepair', () => {
  test('skips when the current row differs from the immutable backup', () => {
    const current = { ...originalRow(), word_count: 7 };

    expect(plan({ current })).toEqual({ status: 'skip', reason: 'original_changed' });
  });

  test('skips when content and article identities are unrelated', () => {
    expect(plan({ current: { ...originalRow(), article_id: 'article-2' } }))
      .toEqual({ status: 'skip', reason: 'id_mismatch' });
  });

  test('skips a current row that already contains valid editorial content', () => {
    const current = { ...originalRow(), ...replacement() };

    expect(plan({ backup: current, current })).toEqual({ status: 'skip', reason: 'current_valid' });
  });

  test('skips challenge, empty, and editorially insufficient replacements', () => {
    const challenge = { ...replacement(), title: 'www.edgeprop.sg', text_content: 'Performing security verification Enable JavaScript and cookies to continue', html_content: '<span id="challenge-error-text">Enable JavaScript and cookies to continue</span>', paragraphs: ['Performing security verification', 'Enable JavaScript and cookies to continue'] };
    const empty = { ...replacement(), text_content: ' ', html_content: '<div> </div>', paragraphs: ['', ''] };
    const short = { ...replacement(), text_content: 'A short body is not an adequate editorial replacement.', paragraphs: ['A short body is not an adequate editorial replacement.', 'Another short paragraph.'] };

    expect(plan({ content: challenge })).toEqual({ status: 'skip', reason: 'replacement_invalid' });
    expect(plan({ content: empty })).toEqual({ status: 'skip', reason: 'replacement_invalid' });
    expect(plan({ content: short })).toEqual({ status: 'skip', reason: 'replacement_insufficient' });
  });

  test('skips a replacement whose nid or normalized EdgeProp path does not match the article', () => {
    expect(plan({ content: { ...replacement(), nid: 'other-nid' } }))
      .toEqual({ status: 'skip', reason: 'replacement_identity_mismatch' });
    expect(plan({ content: { ...replacement(), path: 'https://elsewhere.invalid/property-news/home-market-update' } }))
      .toEqual({ status: 'skip', reason: 'replacement_identity_mismatch' });
  });

  test('skips malformed paths even when both values normalize to no path', () => {
    const malformedArticle = { ...article(), path: '/property-news/home-market-update?source=feed' };
    const malformedContent = { ...replacement(), path: '/property-news/home-market-update?source=feed' };

    expect(plan({ article: malformedArticle, content: malformedContent }))
      .toEqual({ status: 'skip', reason: 'replacement_identity_mismatch' });
  });

  test('returns only established content fields for a matching editorial replacement', () => {
    const result = plan();

    expect(result).toEqual({
      status: 'ready',
      patch: {
        text_content: editorialText,
        html_content: `<p>${editorialParagraphOne}</p><p>${editorialParagraphTwo}</p>`,
        paragraphs: [editorialParagraphOne, editorialParagraphTwo],
        images: ['https://cdn.example.invalid/market.jpg'],
        links: [{ text: 'Market data', url: 'https://www.edgeprop.sg/market', type: 'internal' }],
        main_image_url: 'https://cdn.example.invalid/market.jpg',
        main_image_caption: 'Apartments in Singapore',
        tags: ['market'],
        word_count: 119,
        reading_time_minutes: 1,
        scraped_at: '2026-09-07T10:00:00.000Z',
      },
    });
  });

  test('fails closed for malformed inputs and invalid immutable timestamps', () => {
    expect(planApprovedArticleRepair({ backup: null, current: originalRow(), article: article(), content: replacement() }))
      .toEqual({ status: 'skip', reason: 'malformed_input' });
    const invalidTimestampRow = { ...originalRow(), updated_at: 'not-a-date' };
    expect(plan({ backup: invalidTimestampRow, current: invalidTimestampRow }))
      .toEqual({ status: 'skip', reason: 'invalid_timestamp' });
    expect(plan({ content: { ...replacement(), scraped_at: 'not-a-date' } }))
      .toEqual({ status: 'skip', reason: 'invalid_timestamp' });
  });

  test('accepts a nullable stored body as an invalid current row without altering its snapshot', () => {
    const nullableOriginal = { ...originalRow(), text_content: null, html_content: null };

    expect(plan({ backup: nullableOriginal, current: nullableOriginal })).toMatchObject({ status: 'ready' });
  });

  test('projects absent captions and empty main-image URLs as database nulls', () => {
    const { main_image_caption: _caption, ...withoutCaption } = replacement();
    const result = plan({ content: { ...withoutCaption, main_image_url: '' } });

    expect(result).toEqual({
      status: 'ready',
      patch: expect.objectContaining({ main_image_url: null, main_image_caption: null }),
    });
  });
});
