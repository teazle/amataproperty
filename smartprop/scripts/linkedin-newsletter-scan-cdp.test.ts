import { describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'puppeteer-core';
import {
  ALLOW_BROWSER_USE_ENV,
  DEFAULT_SCAN_CDP_URL,
  acquireScanBrowser,
  resolveExplicitScanCdpUrl,
} from '../src/lib/linkedin/scan-browser';

const EXPLICIT_CDP_URL = 'http://127.0.0.1:9222';
const CLOUD_CDP_URL = 'wss://cloud.example/devtools';
const CLOUD_ID = 'cloud-lease-1';

type CallLog = {
  connectUrls: string[];
  cloudCreated: number;
  cloudStopped: string[];
  newPageCalls: number;
  pagesCalls: number;
  pageCloses: number;
  disconnects: number;
  browserCloses: number;
};

function createHarness(options?: {
  connectErrorFor?: (url: string) => Error | undefined;
  createCloudError?: Error;
  newPageError?: Error;
  pageCloseError?: Error;
  stopCloudError?: Error;
}) {
  const calls: CallLog = {
    connectUrls: [],
    cloudCreated: 0,
    cloudStopped: [],
    newPageCalls: 0,
    pagesCalls: 0,
    pageCloses: 0,
    disconnects: 0,
    browserCloses: 0,
  };
  const page = {
    url: () => 'https://www.linkedin.com/feed/',
    close: async () => {
      calls.pageCloses += 1;
      if (options?.pageCloseError) throw options.pageCloseError;
    },
  } as unknown as Page;
  const browser = {
    pages: async () => {
      calls.pagesCalls += 1;
      return [page];
    },
    newPage: async () => {
      calls.newPageCalls += 1;
      if (options?.newPageError) throw options.newPageError;
      return page;
    },
    close: async () => {
      calls.browserCloses += 1;
    },
    disconnect: async () => {
      calls.disconnects += 1;
    },
  } as unknown as Browser;
  return {
    calls,
    page,
    browser,
    connectOverCDP: async (url: string) => {
      calls.connectUrls.push(url);
      const error = options?.connectErrorFor?.(url);
      if (error) throw error;
      return browser;
    },
    createCloudBrowser: async () => {
      calls.cloudCreated += 1;
      if (options?.createCloudError) throw options.createCloudError;
      return { id: CLOUD_ID, cdpUrl: CLOUD_CDP_URL };
    },
    stopCloudBrowser: async (cloudId: string) => {
      calls.cloudStopped.push(cloudId);
      if (options?.stopCloudError) throw options.stopCloudError;
    },
    env: {} as Record<string, string | undefined>,
  };
}

function acquire(harness: ReturnType<typeof createHarness>, explicitCdpUrl?: string) {
  return acquireScanBrowser({
    explicitCdpUrl,
    env: harness.env,
    connectOverCDP: harness.connectOverCDP,
    createCloudBrowser: harness.createCloudBrowser,
    stopCloudBrowser: harness.stopCloudBrowser,
  });
}

describe('resolveExplicitScanCdpUrl', () => {
  test('uses the first configured CDP env, trimming blanks', () => {
    expect(resolveExplicitScanCdpUrl({ LINKEDIN_NEWSLETTER_CDP_URL: `  ${EXPLICIT_CDP_URL} ` })).toBe(EXPLICIT_CDP_URL);
    expect(resolveExplicitScanCdpUrl({ LINKEDIN_NEWSLETTER_CDP_URL: '   ', OPENCLAW_BROWSER_CDP_URL: EXPLICIT_CDP_URL })).toBe(EXPLICIT_CDP_URL);
    expect(resolveExplicitScanCdpUrl({})).toBeUndefined();
  });
});

describe('scan browser acquisition routing', () => {
  test('explicit CDP succeeds with a task-owned page and no pages() call', async () => {
    const harness = createHarness();
    const lease = await acquire(harness, EXPLICIT_CDP_URL);

    expect(lease.mode).toBe('explicit-cdp');
    expect(lease.page).toBe(harness.page);
    expect(harness.calls.connectUrls).toEqual([EXPLICIT_CDP_URL]);
    expect(harness.calls.newPageCalls).toBe(1);
    expect(harness.calls.pagesCalls).toBe(0);
    expect(harness.calls.cloudCreated).toBe(0);
  });

  test('explicit CDP failure fails closed even with the cloud opt-in set', async () => {
    const harness = createHarness({ connectErrorFor: () => new Error('cdp refused') });
    harness.env[ALLOW_BROWSER_USE_ENV] = 'true';

    await expect(acquire(harness, EXPLICIT_CDP_URL)).rejects.toThrow('cdp refused');
    expect(harness.calls.cloudCreated).toBe(0);
  });

  test('default CDP failure without the exact opt-in never calls cloud', async () => {
    const harness = createHarness({ connectErrorFor: (url) => (url === DEFAULT_SCAN_CDP_URL ? new Error('default cdp down') : undefined) });
    harness.env[ALLOW_BROWSER_USE_ENV] = '1';

    await expect(acquire(harness)).rejects.toThrow(ALLOW_BROWSER_USE_ENV);
    expect(harness.calls.cloudCreated).toBe(0);
  });

  test('default CDP failure plus exact LINKEDIN_NEWSLETTER_ALLOW_BROWSER_USE=true uses the cloud path with a task-owned page', async () => {
    const harness = createHarness({ connectErrorFor: (url) => (url === DEFAULT_SCAN_CDP_URL ? new Error('default cdp down') : undefined) });
    harness.env[ALLOW_BROWSER_USE_ENV] = 'true';

    const lease = await acquire(harness);

    expect(lease.mode).toBe('browser-use-cloud');
    expect(lease.page).toBe(harness.page);
    expect(harness.calls.connectUrls).toEqual([DEFAULT_SCAN_CDP_URL, CLOUD_CDP_URL]);
    expect(harness.calls.newPageCalls).toBe(1);
    expect(harness.calls.pagesCalls).toBe(0);
  });

  test('default CDP success never touches cloud', async () => {
    const harness = createHarness();

    const lease = await acquire(harness);

    expect(lease.mode).toBe('default-cdp');
    expect(harness.calls.connectUrls).toEqual([DEFAULT_SCAN_CDP_URL]);
    expect(harness.calls.cloudCreated).toBe(0);
    expect(harness.calls.pagesCalls).toBe(0);
  });
});

describe('scan browser lease cleanup', () => {
  test('stop closes the owned page and disconnects, never closes the browser, and is idempotent', async () => {
    const harness = createHarness();
    const lease = await acquire(harness, EXPLICIT_CDP_URL);

    await lease.stop();
    await lease.stop();

    expect(harness.calls.pageCloses).toBe(1);
    expect(harness.calls.disconnects).toBe(1);
    expect(harness.calls.browserCloses).toBe(0);
  });

  test('disconnect still happens when page.close rejects', async () => {
    const harness = createHarness({ pageCloseError: new Error('page close rejected') });
    const lease = await acquire(harness, EXPLICIT_CDP_URL);

    await lease.stop();

    expect(harness.calls.disconnects).toBe(1);
  });

  test('cloud lease is stopped even when cloud connect fails', async () => {
    const harness = createHarness({
      connectErrorFor: (url) =>
        url === DEFAULT_SCAN_CDP_URL || url === CLOUD_CDP_URL ? new Error(url === CLOUD_CDP_URL ? 'cloud connect failed' : 'default cdp down') : undefined,
    });
    harness.env[ALLOW_BROWSER_USE_ENV] = 'true';

    await expect(acquire(harness)).rejects.toThrow('cloud connect failed');
    expect(harness.calls.cloudStopped).toEqual([CLOUD_ID]);
  });

  test('cloud lease is stopped and the CDP disconnected when cloud newPage fails', async () => {
    const harness = createHarness({
      connectErrorFor: (url) => (url === DEFAULT_SCAN_CDP_URL ? new Error('default cdp down') : undefined),
      newPageError: new Error('newPage failed'),
    });
    harness.env[ALLOW_BROWSER_USE_ENV] = 'true';

    await expect(acquire(harness)).rejects.toThrow('newPage failed');
    expect(harness.calls.disconnects).toBe(1);
    expect(harness.calls.cloudStopped).toEqual([CLOUD_ID]);
  });

  test('CDP newPage failure disconnects without any cloud involvement', async () => {
    const harness = createHarness({ newPageError: new Error('newPage failed') });

    await expect(acquire(harness, EXPLICIT_CDP_URL)).rejects.toThrow('newPage failed');
    expect(harness.calls.disconnects).toBe(1);
    expect(harness.calls.cloudCreated).toBe(0);
  });

  test('a cleanup error does not suppress the primary setup error', async () => {
    const harness = createHarness({
      connectErrorFor: (url) => (url === DEFAULT_SCAN_CDP_URL ? new Error('default cdp down') : undefined),
      newPageError: new Error('primary: newPage exploded'),
      stopCloudError: new Error('cleanup: stop cloud exploded'),
    });
    harness.env[ALLOW_BROWSER_USE_ENV] = 'true';

    await expect(acquire(harness)).rejects.toThrow('primary: newPage exploded');
    expect(harness.calls.cloudStopped).toEqual([CLOUD_ID]);
  });
});
