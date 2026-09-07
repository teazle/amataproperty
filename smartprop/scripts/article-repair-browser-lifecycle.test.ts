import { beforeEach, describe, expect, mock, test } from 'bun:test';

type Counters = {
  browserClosed: number;
  pageClosed: number;
  pagesCreated: number;
  launches: number;
};

const launches: unknown[] = [];
let launchedBrowser: ReturnType<typeof browserDouble>;

mock.module('playwright', () => ({
  chromium: {
    launch: async () => {
      launches.push(true);
      return launchedBrowser;
    },
  },
}));

const { scrapeArticleContent } = await import('../src/lib/scraper/edgeprop-content-scraper');

function articleData() {
  return {
    title: 'Private home buyers return as borrowing costs ease',
    author: 'Reporter',
    publishedDate: '2026-09-07',
    mainImage: '',
    mainImageCaption: '',
    paragraphs: ['Private home buyers returned to the market after borrowing costs eased and new listings gave households more choice.'],
    images: [],
    links: [],
    tags: [],
    htmlContent: '<p>Private home buyers returned to the market after borrowing costs eased and new listings gave households more choice.</p>',
    textContent: 'Private home buyers returned to the market after borrowing costs eased and new listings gave households more choice.',
    wordCount: 18,
    readingTime: 1,
  };
}

function pageDouble(counters: Counters, gotoError?: Error) {
  return {
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
    goto: async () => {
      if (gotoError) throw gotoError;
    },
    waitForTimeout: async () => undefined,
    evaluate: async () => articleData(),
    close: async () => {
      counters.pageClosed++;
    },
  };
}

function browserDouble(counters: Counters = { browserClosed: 0, pageClosed: 0, pagesCreated: 0, launches: 0 }, gotoError?: Error) {
  const page = pageDouble(counters, gotoError);
  return {
    counters,
    page,
    newPage: async () => {
      counters.pagesCreated++;
      return page;
    },
    close: async () => {
      counters.browserClosed++;
    },
  };
}

function contextDouble(counters: Counters = { browserClosed: 0, pageClosed: 0, pagesCreated: 0, launches: 0 }, gotoError?: Error) {
  const page = pageDouble(counters, gotoError);
  return {
    counters,
    newPage: async () => {
      counters.pagesCreated++;
      return page;
    },
  };
}

beforeEach(() => {
  launches.length = 0;
  launchedBrowser = browserDouble();
});

describe('scrapeArticleContent browser ownership', () => {
  test('closes the page but preserves a caller-owned context after a valid scrape', async () => {
    const suppliedContext = contextDouble();

    const result = await scrapeArticleContent('/property-news/rowell-road', 'rowell-1', { context: suppliedContext as never });

    expect(result).toMatchObject({ nid: 'rowell-1', path: '/property-news/rowell-road' });
    expect(suppliedContext.counters).toEqual({ browserClosed: 0, pageClosed: 1, pagesCreated: 1, launches: 0 });
    expect(launches).toHaveLength(0);
  });

  test('closes the page but preserves a caller-owned context when navigation fails', async () => {
    const suppliedContext = contextDouble(undefined, new Error('navigation failed'));

    await expect(scrapeArticleContent('/property-news/rowell-road', 'rowell-1', { context: suppliedContext as never })).resolves.toBeNull();
    expect(suppliedContext.counters).toEqual({ browserClosed: 0, pageClosed: 1, pagesCreated: 1, launches: 0 });
  });

  test('owns and closes both browser and page when no browser is supplied', async () => {
    const ownedBrowser = browserDouble();
    launchedBrowser = ownedBrowser;

    await expect(scrapeArticleContent('/property-news/rowell-road', 'rowell-1')).resolves.toMatchObject({ nid: 'rowell-1' });
    expect(ownedBrowser.counters).toEqual({ browserClosed: 1, pageClosed: 1, pagesCreated: 1, launches: 0 });
    expect(launches).toHaveLength(1);
  });

  test('owns and closes both browser and page when default navigation fails', async () => {
    const ownedBrowser = browserDouble(undefined, new Error('navigation failed'));
    launchedBrowser = ownedBrowser;

    await expect(scrapeArticleContent('/property-news/rowell-road', 'rowell-1')).resolves.toBeNull();
    expect(ownedBrowser.counters).toEqual({ browserClosed: 1, pageClosed: 1, pagesCreated: 1, launches: 0 });
    expect(launches).toHaveLength(1);
  });
});
