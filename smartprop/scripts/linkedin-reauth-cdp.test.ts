import { describe, expect, test } from 'bun:test';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

import type { Browser, BrowserContext, Page } from 'playwright-core';
import {
  REAUTH_CATCH_UP_URL,
  REAUTH_FEED_URL,
  acquireReauthBrowser,
  matchesExpectedLinkedInLocation,
  persistVerifiedStorageState,
  resolveExplicitCdpUrl,
  verifyAuthenticatedLinkedInPage,
  verifyReauthAuthentication,
  type CloudBrowserInfo,
  type LinkedInAuthSignals,
} from '../src/lib/linkedin/reauth-browser';
import { fillVisibleInput, tryCredentialLogin } from './linkedin-reauth';

const EXPLICIT_CDP_URL = 'http://127.0.0.1:9222';

const authenticatedSignals: LinkedInAuthSignals = {
  visibleLoginInputs: 0,
  navLinks: { mynetwork: 2, messaging: 1, notifications: 1 },
};
const navMissingSignals: LinkedInAuthSignals = {
  visibleLoginInputs: 0,
  navLinks: { mynetwork: 0, messaging: 0, notifications: 0 },
};
const loginFormSignals: LinkedInAuthSignals = {
  visibleLoginInputs: 1,
  navLinks: { mynetwork: 2, messaging: 1, notifications: 1 },
};

describe('linkedin-reauth explicit CDP routing', () => {
  test('resolveExplicitCdpUrl trims values and treats blank as unset', () => {
    expect(resolveExplicitCdpUrl({ LINKEDIN_REAUTH_CDP_URL: `  ${EXPLICIT_CDP_URL} ` })).toBe(EXPLICIT_CDP_URL);
    expect(resolveExplicitCdpUrl({ LINKEDIN_REAUTH_CDP_URL: '' })).toBeUndefined();
    expect(resolveExplicitCdpUrl({ LINKEDIN_REAUTH_CDP_URL: '   ' })).toBeUndefined();
    expect(resolveExplicitCdpUrl({})).toBeUndefined();
  });

  test('explicit CDP URL attaches directly without any Browser Use cloud call', async () => {
    const harness = createAcquireHarness();
    const lease = await acquireReauthBrowser({
      env: { LINKEDIN_REAUTH_CDP_URL: EXPLICIT_CDP_URL },
      createCloudBrowser: harness.createCloudBrowser,
      stopCloudBrowser: harness.stopCloudBrowser,
      connectOverCDP: harness.connectOverCDP,
    });

    expect(lease.mode).toBe('explicit-cdp');
    expect(harness.connectCalls).toHaveLength(1);
    expect(harness.connectCalls[0].url).toBe(EXPLICIT_CDP_URL);
    expect(harness.createdCloud).toHaveLength(0);
    expect(lease.cloudBrowserId).toBeUndefined();
    expect(lease.liveUrl).toBeNull();

    // Task-owned context/page: never touches the attached browser's existing tabs.
    expect(harness.log).toContain('browser.newContext');
    expect(lease.context).toBe(harness.taskContext);
    expect(lease.page).toBe(harness.taskPages[0]);
    expect(harness.existingPagesTouched).toBe(false);
  });

  test('failed explicit CDP connection rejects without falling back to the paid cloud', async () => {
    const harness = createAcquireHarness({ connectError: new Error('ECONNREFUSED 127.0.0.1:9222') });
    await expect(
      acquireReauthBrowser({
        env: { LINKEDIN_REAUTH_CDP_URL: EXPLICIT_CDP_URL },
        createCloudBrowser: harness.createCloudBrowser,
        stopCloudBrowser: harness.stopCloudBrowser,
        connectOverCDP: harness.connectOverCDP,
      }),
    ).rejects.toThrow('ECONNREFUSED');

    expect(harness.createdCloud).toHaveLength(0);
    expect(harness.stoppedCloudIds).toHaveLength(0);
  });

  test('release of an explicit CDP lease closes only the task context and disconnects', async () => {
    const harness = createAcquireHarness();
    const lease = await acquireReauthBrowser({
      env: { LINKEDIN_REAUTH_CDP_URL: EXPLICIT_CDP_URL },
      createCloudBrowser: harness.createCloudBrowser,
      stopCloudBrowser: harness.stopCloudBrowser,
      connectOverCDP: harness.connectOverCDP,
    });

    await lease.release();

    expect(harness.taskContextClosed).toBe(true);
    expect(harness.existingContextClosed).toBe(false);
    expect(harness.log).toContain('browser.close');
    expect(harness.stoppedCloudIds).toHaveLength(0);
  });

  test('without an explicit CDP URL the Browser Use cloud path is preserved', async () => {
    const harness = createAcquireHarness();
    const lease = await acquireReauthBrowser({
      env: {},
      createCloudBrowser: harness.createCloudBrowser,
      stopCloudBrowser: harness.stopCloudBrowser,
      connectOverCDP: harness.connectOverCDP,
    });

    expect(lease.mode).toBe('browser-use-cloud');
    expect(harness.createdCloud).toHaveLength(1);
    expect(harness.connectCalls[0].url).toBe(harness.cloudBrowser.cdpUrl);
    expect(lease.context).toBe(harness.existingContext);
    expect(lease.page).toBe(harness.existingPages[0]);
    expect(lease.cloudBrowserId).toBe('cloud-1');
    expect(lease.liveUrl).toBe('https://live.example/browser-use');

    await lease.release();
    expect(harness.log).toContain('browser.close');
    expect(harness.stoppedCloudIds).toEqual(['cloud-1']);
  });

  test('cloud connect failure after creation still stops the paid cloud browser', async () => {
    const harness = createAcquireHarness({ connectError: new Error('cdp handshake failed') });
    await expect(
      acquireReauthBrowser({
        env: {},
        createCloudBrowser: harness.createCloudBrowser,
        stopCloudBrowser: harness.stopCloudBrowser,
        connectOverCDP: harness.connectOverCDP,
      }),
    ).rejects.toThrow('cdp handshake failed');

    expect(harness.stoppedCloudIds).toEqual(['cloud-1']);
  });

  test('explicit CDP context failure after a successful connection releases the connection', async () => {
    const harness = createAcquireHarness({ newContextError: new Error('context creation refused') });
    await expect(
      acquireReauthBrowser({
        env: { LINKEDIN_REAUTH_CDP_URL: EXPLICIT_CDP_URL },
        createCloudBrowser: harness.createCloudBrowser,
        stopCloudBrowser: harness.stopCloudBrowser,
        connectOverCDP: harness.connectOverCDP,
      }),
    ).rejects.toThrow('context creation refused');

    expect(harness.log).toContain('browser.close');
    expect(harness.stoppedCloudIds).toHaveLength(0);
  });

  test('explicit CDP page failure closes the created task context and disconnects', async () => {
    const harness = createAcquireHarness({ taskNewPageError: new Error('target closed') });
    await expect(
      acquireReauthBrowser({
        env: { LINKEDIN_REAUTH_CDP_URL: EXPLICIT_CDP_URL },
        createCloudBrowser: harness.createCloudBrowser,
        stopCloudBrowser: harness.stopCloudBrowser,
        connectOverCDP: harness.connectOverCDP,
      }),
    ).rejects.toThrow('target closed');

    expect(harness.taskContextClosed).toBe(true);
    expect(harness.existingContextClosed).toBe(false);
    expect(harness.log).toContain('browser.close');
  });

  test('cloud context failure after a successful connection stops the paid cloud browser', async () => {
    const harness = createAcquireHarness({ existingContextsEmpty: true, newContextError: new Error('newContext failed') });
    await expect(
      acquireReauthBrowser({
        env: {},
        createCloudBrowser: harness.createCloudBrowser,
        stopCloudBrowser: harness.stopCloudBrowser,
        connectOverCDP: harness.connectOverCDP,
      }),
    ).rejects.toThrow('newContext failed');

    expect(harness.log).toContain('browser.close');
    expect(harness.stoppedCloudIds).toEqual(['cloud-1']);
  });

  test('cloud page failure on the existing context stops the paid browser without closing that context', async () => {
    const harness = createAcquireHarness({
      existingPagesEmpty: true,
      existingContextNewPageError: new Error('page crashed'),
    });
    await expect(
      acquireReauthBrowser({
        env: {},
        createCloudBrowser: harness.createCloudBrowser,
        stopCloudBrowser: harness.stopCloudBrowser,
        connectOverCDP: harness.connectOverCDP,
      }),
    ).rejects.toThrow('page crashed');

    expect(harness.log).toContain('browser.close');
    expect(harness.stoppedCloudIds).toEqual(['cloud-1']);
    expect(harness.existingContextClosed).toBe(false);
  });

  test('cloud page failure on a created context closes only that created context', async () => {
    const harness = createAcquireHarness({ existingContextsEmpty: true, taskNewPageError: new Error('target closed') });
    await expect(
      acquireReauthBrowser({
        env: {},
        createCloudBrowser: harness.createCloudBrowser,
        stopCloudBrowser: harness.stopCloudBrowser,
        connectOverCDP: harness.connectOverCDP,
      }),
    ).rejects.toThrow('target closed');

    expect(harness.taskContextClosed).toBe(true);
    expect(harness.existingContextClosed).toBe(false);
    expect(harness.log).toContain('browser.close');
    expect(harness.stoppedCloudIds).toEqual(['cloud-1']);
  });
});

describe('linkedin-reauth authenticated page verification', () => {
  test('a failed navigation is never reported as authenticated', async () => {
    // Navigation throws; the page URL still looks like the feed and the DOM
    // signals look authenticated — only the failed navigation itself matters.
    const { page } = createProbePage(
      [
        { kind: 'throw' },
        { kind: 'throw' },
      ],
      () => authenticatedSignals,
    );

    const result = await verifyAuthenticatedLinkedInPage(page, REAUTH_FEED_URL, { settleMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('navigation-failed');
  });

  test('an HTTP error response is not authenticated', async () => {
    const { page } = createProbePage(
      [
        { kind: 'respond', status: 503, landOn: REAUTH_FEED_URL },
        { kind: 'respond', status: 503, landOn: REAUTH_FEED_URL },
      ],
      () => authenticatedSignals,
    );

    const result = await verifyAuthenticatedLinkedInPage(page, REAUTH_FEED_URL, { settleMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('http-not-ok');
  });

  test('a navigation without any HTTP response is not authenticated', async () => {
    // goto resolving null (no committed response) on a page whose URL and DOM
    // signals look fully authenticated must never verify.
    const { page } = createProbePage(
      [
        { kind: 'no-response', landOn: REAUTH_FEED_URL },
        { kind: 'no-response', landOn: REAUTH_FEED_URL },
      ],
      () => authenticatedSignals,
    );

    const result = await verifyAuthenticatedLinkedInPage(page, REAUTH_FEED_URL, { settleMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no-http-response');
  });

  test('a redirect to a login URL is not authenticated even with friendly DOM signals', async () => {
    const { page } = createProbePage(
      [
        { kind: 'respond', status: 200, landOn: 'https://www.linkedin.com/login' },
        { kind: 'respond', status: 200, landOn: 'https://www.linkedin.com/login' },
      ],
      () => authenticatedSignals,
    );

    const result = await verifyAuthenticatedLinkedInPage(page, REAUTH_FEED_URL, { settleMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('unexpected-location');
  });

  test('a visible login form on the requested page is not authenticated', async () => {
    const { page } = createProbePage(
      [{ kind: 'respond', status: 200, landOn: REAUTH_FEED_URL }],
      () => loginFormSignals,
    );

    const result = await verifyAuthenticatedLinkedInPage(page, REAUTH_FEED_URL, { settleMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('login-form-visible');
  });

  test('an HTTP (non-HTTPS) landing URL is not authenticated', async () => {
    const { page } = createProbePage(
      [
        { kind: 'respond', status: 200, landOn: 'http://www.linkedin.com/feed/' },
        { kind: 'respond', status: 200, landOn: 'http://www.linkedin.com/feed/' },
      ],
      () => authenticatedSignals,
    );

    const result = await verifyAuthenticatedLinkedInPage(page, REAUTH_FEED_URL, { settleMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('unexpected-location');
  });

  test('missing authenticated nav links are not sufficient (generic shell rejected)', async () => {
    const { page } = createProbePage(
      [
        { kind: 'respond', status: 200, landOn: REAUTH_FEED_URL },
        { kind: 'respond', status: 200, landOn: REAUTH_FEED_URL },
      ],
      () => navMissingSignals,
    );

    const result = await verifyAuthenticatedLinkedInPage(page, REAUTH_FEED_URL, { settleMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('authenticated-nav-links-missing');
  });

  test('exact host, HTTP success, no login form, and full nav links verify', async () => {
    const { page, requestedUrls } = createProbePage(
      [{ kind: 'respond', status: 200, landOn: REAUTH_FEED_URL }],
      () => authenticatedSignals,
    );

    const result = await verifyAuthenticatedLinkedInPage(page, REAUTH_FEED_URL, { settleMs: 0 });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('authenticated');
    expect(result.currentUrl).toBe(REAUTH_FEED_URL);
    expect(requestedUrls()).toEqual([REAUTH_FEED_URL]);
  });

  test('bounded retries recover from a transient failure', async () => {
    const { page, requestedUrls } = createProbePage(
      [
        { kind: 'respond', status: 503, landOn: REAUTH_FEED_URL },
        { kind: 'respond', status: 200, landOn: `${REAUTH_FEED_URL}?trk=home` },
      ],
      () => authenticatedSignals,
    );

    const result = await verifyAuthenticatedLinkedInPage(page, REAUTH_FEED_URL, { settleMs: 0 });
    expect(result.ok).toBe(true);
    expect(requestedUrls()).toHaveLength(2);
  });

  test('authentication requires both Feed and Catch Up, and skips Catch Up when Feed fails', async () => {
    const passing = createProbePage(
      [
        { kind: 'respond', status: 200, landOn: REAUTH_FEED_URL },
        { kind: 'respond', status: 200, landOn: REAUTH_CATCH_UP_URL },
      ],
      () => authenticatedSignals,
    );
    const passingOutcome = await verifyReauthAuthentication(passing.page, { settleMs: 0 });
    expect(passingOutcome.ok).toBe(true);
    expect(passing.requestedUrls()).toEqual([REAUTH_FEED_URL, REAUTH_CATCH_UP_URL]);

    const failing = createProbePage(
      [
        { kind: 'throw' },
        { kind: 'throw' },
      ],
      () => authenticatedSignals,
    );
    const failingOutcome = await verifyReauthAuthentication(failing.page, { settleMs: 0 });
    expect(failingOutcome.ok).toBe(false);
    expect(failingOutcome.feed.ok).toBe(false);
    expect(failingOutcome.catchUp).toBeNull();
    expect(failing.requestedUrls().every((url) => url === REAUTH_FEED_URL)).toBe(true);
  });
});

describe('linkedin-reauth location matching and storage persistence', () => {
  test('location matching accepts only https www.linkedin.com at the exact requested path', () => {
    expect(matchesExpectedLinkedInLocation('https://www.linkedin.com/feed/', REAUTH_FEED_URL)).toBe(true);
    expect(matchesExpectedLinkedInLocation('https://www.linkedin.com/feed/?trk=guest_home', REAUTH_FEED_URL)).toBe(true);
    // A single trailing slash is insignificant: /feed and /feed/ are one page.
    expect(matchesExpectedLinkedInLocation('https://www.linkedin.com/feed', REAUTH_FEED_URL)).toBe(true);
    expect(matchesExpectedLinkedInLocation('https://www.linkedin.com/mynetwork/catch-up/all/', REAUTH_CATCH_UP_URL)).toBe(true);
    // HTTP never satisfies an HTTPS request (controller falsifier).
    expect(matchesExpectedLinkedInLocation('http://www.linkedin.com/feed/', REAUTH_FEED_URL)).toBe(false);
    // Exact pathname only: nested Feed pages are not the Feed itself.
    expect(matchesExpectedLinkedInLocation('https://www.linkedin.com/feed/update-urn-123/', REAUTH_FEED_URL)).toBe(false);
    expect(matchesExpectedLinkedInLocation('https://www.linkedin.com/feed/', REAUTH_CATCH_UP_URL)).toBe(false);
    expect(matchesExpectedLinkedInLocation('https://linkedin.com/feed/', REAUTH_FEED_URL)).toBe(false);
    expect(matchesExpectedLinkedInLocation('https://www.linkedin.com/login', REAUTH_FEED_URL)).toBe(false);
    expect(matchesExpectedLinkedInLocation('https://www.linkedin.com/checkpoint/lgc/login-submit', REAUTH_FEED_URL)).toBe(false);
    expect(matchesExpectedLinkedInLocation('https://www.linkedin.com/authwall', REAUTH_FEED_URL)).toBe(false);
    expect(matchesExpectedLinkedInLocation('https://www.linkedin.com/mynetwork', REAUTH_CATCH_UP_URL)).toBe(false);
    expect(matchesExpectedLinkedInLocation('not a url', REAUTH_FEED_URL)).toBe(false);
  });

  test('storage persistence failure is surfaced instead of swallowed', async () => {
    const failing = {
      storageState: async () => {
        throw new Error('EACCES: permission denied');
      },
    };
    await expect(
      persistVerifiedStorageState(failing as unknown as Parameters<typeof persistVerifiedStorageState>[0], '/tmp/linkedin.state.json'),
    ).rejects.toThrow('Failed to save LinkedIn storage state');

    const savedPaths: string[] = [];
    const working = {
      storageState: async (options: { path: string }) => {
        savedPaths.push(options.path);
      },
    };
    await expect(
      persistVerifiedStorageState(working as unknown as Parameters<typeof persistVerifiedStorageState>[0], '/tmp/linkedin.state.json'),
    ).resolves.toBeUndefined();
    expect(savedPaths).toEqual(['/tmp/linkedin.state.json']);
  });
});

describe('linkedin-reauth serialized auth-signals callback under the actual tsx loader', () => {
  test('tsx-emitted collectAuthSignals executes in a clean browser realm', () => {
    // The reauth script is transformed by the real cached tsx ESM loader via
    // `node --import` — how the passing VPS harness runs it. The tsx CLI itself
    // binds a Unix IPC pipe that network-deny sandboxes refuse. tsx/esbuild
    // wraps named nested arrow bindings in a __name(...) helper that exists only
    // in the loader realm; Playwright serializes the function source into the
    // page, where __name is undefined (VPS proof 2026-09-09:
    // page-signals-unavailable). This fixture exercises the REAL emitted source.
    const source = emitCollectAuthSignalsThroughTsx();

    expect(source).toContain('collectAuthSignals');
    expect(source).not.toContain('__name');

    const signals = runSerializedSignalsInCleanRealm(source);
    expect(signals).toEqual({
      visibleLoginInputs: 1,
      navLinks: { mynetwork: 1, messaging: 1, notifications: 1 },
    });
  }, 120_000);
});

describe('linkedin-reauth credential form selection', () => {
  const EMAIL_SELECTOR =
    'input[name="session_key"], input#username, input[autocomplete*="username"], input[type="email"]';

  test('fillVisibleInput fills the first visible match and skips hidden duplicates', async () => {
    // Real LinkedIn login renders duplicated responsive fields whose first DOM
    // match can be hidden (controller login proof, 2026-09-09).
    const emailFields = [
      { visible: false, filledWith: undefined as string | undefined },
      { visible: true, filledWith: undefined as string | undefined },
    ];
    const { page } = createCredentialPage({ emailFields, passwordFields: [], submitButtons: [] });

    const filled = await fillVisibleInput(page, EMAIL_SELECTOR, 'user@example.com');

    expect(filled).toBe(true);
    expect(emailFields[0].filledWith).toBeUndefined();
    expect(emailFields[1].filledWith).toBe('user@example.com');
  });

  test('fillVisibleInput returns false when every match is hidden', async () => {
    const emailFields = [{ visible: false, filledWith: undefined as string | undefined }];
    const { page } = createCredentialPage({ emailFields, passwordFields: [], submitButtons: [] });

    await expect(fillVisibleInput(page, EMAIL_SELECTOR, 'user@example.com')).resolves.toBe(false);
    expect(emailFields[0].filledWith).toBeUndefined();
  });

  test('tryCredentialLogin fills the visible duplicated fields and clicks the visible Sign in button', async () => {
    const previousEmail = process.env.LINKEDIN_EMAIL;
    const previousPassword = process.env.LINKEDIN_PASSWORD;
    process.env.LINKEDIN_EMAIL = 'user@example.com';
    process.env.LINKEDIN_PASSWORD = 'secret-password';
    try {
      const emailFields = [
        { visible: false, filledWith: undefined as string | undefined },
        { visible: true, filledWith: undefined as string | undefined },
      ];
      const passwordFields = [
        { visible: false, filledWith: undefined as string | undefined },
        { visible: true, filledWith: undefined as string | undefined },
      ];
      const submitButtons = [
        { visible: false, clicked: false },
        { visible: true, clicked: false },
      ];
      const { page, keyboardPresses } = createCredentialPage({ emailFields, passwordFields, submitButtons });

      const outcome = await tryCredentialLogin(page as unknown as Page);

      expect(outcome).toBe('submitted');
      expect(emailFields[0].filledWith).toBeUndefined();
      expect(emailFields[1].filledWith).toBe('user@example.com');
      expect(passwordFields[1].filledWith).toBe('secret-password');
      expect(submitButtons[0].clicked).toBe(false);
      expect(submitButtons[1].clicked).toBe(true);
      expect(keyboardPresses).toEqual([]);
    } finally {
      if (previousEmail === undefined) {
        delete process.env.LINKEDIN_EMAIL;
      } else {
        process.env.LINKEDIN_EMAIL = previousEmail;
      }
      if (previousPassword === undefined) {
        delete process.env.LINKEDIN_PASSWORD;
      } else {
        process.env.LINKEDIN_PASSWORD = previousPassword;
      }
    }
  });
});

type ProbeScript =
  | { kind: 'throw' }
  | { kind: 'no-response'; landOn: string }
  | { kind: 'respond'; status: number; landOn: string };

function createProbePage(scripts: ProbeScript[], signalsFor: (landedUrl: string) => LinkedInAuthSignals | null) {
  const requestedUrls: string[] = [];
  let currentUrl = 'https://www.linkedin.com/feed/';
  const page = {
    url: () => currentUrl,
    goto: async (url: string) => {
      requestedUrls.push(url);
      const script = scripts[requestedUrls.length - 1] ?? { kind: 'respond' as const, status: 200, landOn: url };
      if (script.kind === 'throw') {
        throw new Error('net::ERR_CONNECTION_RESET');
      }
      currentUrl = script.landOn;
      if (script.kind === 'no-response') {
        return null;
      }
      return { ok: () => script.status >= 200 && script.status < 400 };
    },
    waitForTimeout: async () => {},
    evaluate: async () => signalsFor(currentUrl),
  };
  return { page: page as unknown as Page, requestedUrls: () => requestedUrls };
}

function createAcquireHarness(options?: {
  connectError?: Error;
  newContextError?: Error;
  taskNewPageError?: Error;
  existingContextsEmpty?: boolean;
  existingPagesEmpty?: boolean;
  existingContextNewPageError?: Error;
}) {
  const log: string[] = [];
  const connectCalls: Array<{ url: string; options?: { timeout?: number } }> = [];
  const createdCloud: CloudBrowserInfo[] = [];
  const stoppedCloudIds: Array<string | undefined> = [];

  const existingPages: Page[] = [{ id: 'existing-page' } as unknown as Page];
  const taskPages: Page[] = [];
  const state = {
    existingContextClosed: false,
    taskContextClosed: false,
    existingPagesTouched: false,
  };

  const existingContext = {
    pages: () => {
      state.existingPagesTouched = true;
      return options?.existingPagesEmpty ? [] : existingPages;
    },
    newPage: async () => {
      state.existingPagesTouched = true;
      if (options?.existingContextNewPageError) throw options.existingContextNewPageError;
      return existingPages[0];
    },
    close: async () => {
      state.existingContextClosed = true;
    },
    storageState: async () => ({}),
  };

  const taskContext = {
    pages: () => taskPages,
    newPage: async () => {
      if (options?.taskNewPageError) throw options.taskNewPageError;
      const page = { id: `task-page-${taskPages.length + 1}` } as unknown as Page;
      taskPages.push(page);
      return page;
    },
    close: async () => {
      state.taskContextClosed = true;
    },
    storageState: async () => ({}),
  };

  const browser = {
    contexts: () => (options?.existingContextsEmpty ? [] : [existingContext]),
    newContext: async () => {
      log.push('browser.newContext');
      if (options?.newContextError) throw options.newContextError;
      return taskContext;
    },
    close: async () => {
      log.push('browser.close');
    },
  };

  const cloudBrowser: CloudBrowserInfo = {
    id: 'cloud-1',
    liveUrl: 'https://live.example/browser-use',
    cdpUrl: 'wss://cdp.cloud.example/devtools/browser',
  };

  const connectOverCDP = async (url: string, connectOptions?: { timeout?: number }) => {
    connectCalls.push({ url, options: connectOptions });
    if (options?.connectError) throw options.connectError;
    return browser as unknown as Browser;
  };

  const createCloudBrowser = async () => {
    log.push('createCloudBrowser');
    createdCloud.push(cloudBrowser);
    return cloudBrowser;
  };

  const stopCloudBrowser = async (id: string | undefined) => {
    log.push(`stopCloudBrowser:${id ?? 'undefined'}`);
    stoppedCloudIds.push(id);
  };

  return {
    log,
    connectCalls,
    createdCloud,
    stoppedCloudIds,
    cloudBrowser,
    connectOverCDP,
    createCloudBrowser,
    stopCloudBrowser,
    existingContext: existingContext as unknown as BrowserContext,
    taskContext: taskContext as unknown as BrowserContext,
    existingPages,
    taskPages,
    get existingContextClosed() {
      return state.existingContextClosed;
    },
    get taskContextClosed() {
      return state.taskContextClosed;
    },
    get existingPagesTouched() {
      return state.existingPagesTouched;
    },
  };
}

const CREDENTIAL_EMAIL_SELECTOR =
  'input[name="session_key"], input#username, input[autocomplete*="username"], input[type="email"]';
const CREDENTIAL_PASSWORD_SELECTOR =
  'input[name="session_password"], input#password, input[autocomplete*="current-password"], input[type="password"]';

type MockFieldState = {
  visible: boolean;
  filledWith?: string;
  clicked?: boolean;
};

function createCredentialPage(fields: {
  emailFields: MockFieldState[];
  passwordFields: MockFieldState[];
  submitButtons: MockFieldState[];
}) {
  const keyboardPresses: string[] = [];
  const selectorFields = new Map<string, MockFieldState[]>([
    [CREDENTIAL_EMAIL_SELECTOR, fields.emailFields],
    [CREDENTIAL_PASSWORD_SELECTOR, fields.passwordFields],
    ['button[type="submit"]', fields.submitButtons],
    ['button[data-litms-control-urn*="login-submit"]', []],
    ['form button', []],
  ]);
  const handle = (list: MockFieldState[], index: number) => ({
    count: async () => list.length,
    isVisible: async () => list[index]?.visible ?? false,
    fill: async (value: string) => {
      if (list[index]) list[index].filledWith = value;
    },
    click: async () => {
      if (list[index]) list[index].clicked = true;
    },
    dispatchEvent: async () => {
      if (list[index]) list[index].clicked = true;
    },
  });
  const toLocator = (list: MockFieldState[]) => ({
    count: async () => list.length,
    first: () => handle(list, 0),
    last: () => handle(list, Math.max(list.length - 1, 0)),
    nth: (index: number) => handle(list, index),
  });
  const page = {
    url: () => 'https://www.linkedin.com/login',
    evaluate: async () => ({
      visibleLoginInputs: 2,
      navLinks: { mynetwork: 0, messaging: 0, notifications: 0 },
    }),
    waitForTimeout: async () => {},
    locator: (selector: string) => toLocator(selectorFields.get(selector) ?? []),
    getByRole: () => toLocator([]),
    keyboard: {
      press: async (key: string) => {
        keyboardPresses.push(key);
      },
    },
  };
  return { page, keyboardPresses };
}

function resolveCachedTsxLoader(): string {
  // Resolve an existing tsx install only — project node_modules first, then the
  // warm npm cache. Never installs and never touches the network.
  const packageRoots: string[] = [];
  const localRoot = join(import.meta.dir, '../node_modules/tsx');
  if (existsSync(localRoot)) packageRoots.push(localRoot);
  const npxCache = join(homedir(), '.npm/_npx');
  if (existsSync(npxCache)) {
    for (const entry of readdirSync(npxCache)) {
      const cached = join(npxCache, entry, 'node_modules/tsx');
      if (existsSync(cached)) packageRoots.push(cached);
    }
  }
  for (const root of packageRoots) {
    try {
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      if (manifest.name !== 'tsx') continue;
      const exported = manifest.exports?.['.'];
      const loaderRelative = typeof exported === 'string' ? exported : 'dist/loader.mjs';
      const loader = join(root, loaderRelative);
      if (existsSync(loader)) return loader;
    } catch {
      // Not a readable tsx install; try the next candidate.
    }
  }
  throw new Error(
    'No installed or npx-cached tsx loader found (node_modules or ~/.npm/_npx); refusing to install from the network.',
  );
}

function emitCollectAuthSignalsThroughTsx(): string {
  const smartpropRoot = join(import.meta.dir, '..');
  const dir = mkdtempSync(join(tmpdir(), 'reauth-tsx-emit-'));
  try {
    const entry = join(dir, 'emit.ts');
    const modulePath = join(smartpropRoot, 'src/lib/linkedin/reauth-browser.ts');
    writeFileSync(
      entry,
      `import { collectAuthSignals } from ${JSON.stringify(modulePath)};\n` +
        'process.stdout.write(collectAuthSignals.toString());\n',
    );
    // node --import with the cached tsx ESM loader: the same transform the
    // passing VPS harness uses. No tsx CLI, whose Unix IPC named pipe is denied
    // under network-isolated verification sandboxes (listen EPERM tsx-501/*).
    const loader = resolveCachedTsxLoader();
    try {
      return execFileSync('node', ['--import', loader, entry], {
        cwd: smartpropRoot,
        encoding: 'utf8',
        timeout: 60_000,
      }).trim();
    } catch (error) {
      throw new Error(
        `Node tsx-loader emit failed via ${loader}. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type RealmStyle = { visibility: string; display: string };
type RealmElement = {
  style: RealmStyle;
  getClientRects: () => unknown[];
};

function runSerializedSignalsInCleanRealm(source: string): LinkedInAuthSignals {
  const makeElement = (style: RealmStyle, clientRects: unknown[]): RealmElement => ({
    style,
    getClientRects: () => clientRects,
  });
  // One hidden and one visible login input; nav anchors for mynetwork, messaging
  // and notifications (plus a feed anchor that must count for none of them).
  const loginInputs = [
    makeElement({ visibility: 'hidden', display: 'block' }, []),
    makeElement({ visibility: 'visible', display: 'block' }, [{}]),
  ];
  const anchors = ['/feed/', '/mynetwork/', '/messaging/', '/notifications/'].map((href) => ({
    getAttribute: (name: string) => (name === 'href' ? href : null),
  }));
  const realm = createContext({
    document: {
      querySelectorAll: (selector: string) => (selector.includes('input') ? loginInputs : anchors),
    },
    window: {
      getComputedStyle: (element: RealmElement) => element.style,
    },
  });
  const evaluate = runInContext(`(${source})`, realm) as () => LinkedInAuthSignals;
  return evaluate();
}
