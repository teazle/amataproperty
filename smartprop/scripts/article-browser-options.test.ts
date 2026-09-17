import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const metadataLaunches: Array<Record<string, unknown>> = [];
const contentLaunches: Array<Record<string, unknown>> = [];

const metadataBrowser = {
  newPage: async () => ({
    on: () => undefined,
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    reload: async () => undefined,
    close: async () => undefined,
  }),
  close: async () => undefined,
};

const contentBrowser = {
  newPage: async () => ({
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
    goto: async () => {
      throw new Error('offline fixture navigation');
    },
    waitForTimeout: async () => undefined,
    evaluate: async () => ({}),
    close: async () => undefined,
  }),
  close: async () => undefined,
};

mock.module('playwright', () => ({
  chromium: {
    launch: async (options: Record<string, unknown>) => {
      metadataLaunches.push(options);
      return metadataBrowser;
    },
  },
}));

mock.module('patchright', () => ({
  chromium: {
    launch: async (options: Record<string, unknown>) => {
      contentLaunches.push(options);
      return contentBrowser;
    },
  },
}));

const { scrapeEdgeProp } = await import('../src/lib/scraper/edgeprop-scraper');
const { scrapeArticleContent } = await import('../src/lib/scraper/edgeprop-content-scraper');
const { articleBrowserLaunchOptions } = await import('../src/lib/scraper/article-browser-options');

describe('scheduled article browser options', () => {
  beforeEach(() => {
    metadataLaunches.length = 0;
    contentLaunches.length = 0;
    process.env.SMARTPROP_ARTICLE_BROWSER_EXECUTABLE = '/tmp/smartprop-article-chrome';
  });

  afterEach(() => {
    delete process.env.SMARTPROP_ARTICLE_BROWSER_EXECUTABLE;
  });

  test('uses the configured executable and enables the Chromium sandbox for metadata and content launches', async () => {
    await scrapeEdgeProp(1, () => undefined);
    await scrapeArticleContent('/property-news/fixture', 'fixture');

    expect(metadataLaunches).toHaveLength(1);
    expect(contentLaunches).toHaveLength(1);

    for (const options of [...metadataLaunches, ...contentLaunches]) {
      expect(options).toMatchObject({
        executablePath: '/tmp/smartprop-article-chrome',
        chromiumSandbox: true,
      });
      expect(options.channel).toBeUndefined();
      expect(options.args ?? []).not.toContain('--no-sandbox');
      expect(options.args ?? []).not.toContain('--disable-setuid-sandbox');
    }
  });

  test('preserves current launch options when no scheduled executable is configured', async () => {
    delete process.env.SMARTPROP_ARTICLE_BROWSER_EXECUTABLE;

    await scrapeEdgeProp(1, () => undefined);
    await scrapeArticleContent('/property-news/fixture', 'fixture');

    expect(metadataLaunches).toEqual([{ headless: true }]);
    expect(contentLaunches).toEqual([{
      channel: 'chrome',
      headless: true,
      timeout: 15000,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    }]);
  });

  test('rejects a non-absolute scheduled executable before browser launch', () => {
    process.env.SMARTPROP_ARTICLE_BROWSER_EXECUTABLE = 'chrome';

    expect(() => articleBrowserLaunchOptions({ headless: true })).toThrow(
      'SMARTPROP_ARTICLE_BROWSER_EXECUTABLE must be an absolute path',
    );
  });
});
