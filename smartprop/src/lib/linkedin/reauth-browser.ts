import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

/** Explicit opt-in endpoint for attaching the login-only reauth to a task-owned local browser over CDP. */
export const REAUTH_CDP_URL_ENV = 'LINKEDIN_REAUTH_CDP_URL';

export const REAUTH_FEED_URL = 'https://www.linkedin.com/feed/';
export const REAUTH_CATCH_UP_URL = 'https://www.linkedin.com/mynetwork/catch-up/all/';

export type CloudBrowserInfo = {
  id: string;
  liveUrl?: string | null;
  cdpUrl: string;
};

export type ConnectOverCDP = (url: string, options?: { timeout?: number }) => Promise<Browser>;

export type ReauthLease = {
  mode: 'explicit-cdp' | 'browser-use-cloud';
  browser: Browser;
  /** Owning context: task-created for explicit CDP; the attached primary context for Browser Use cloud. */
  context: BrowserContext;
  page: Page;
  cloudBrowserId?: string;
  liveUrl: string | null;
  /** Cloud mode stops the paid cloud browser; explicit CDP never touches any Browser Use API. */
  release: () => Promise<void>;
};

/** Accepts process.env or any plain env-like record. */
export type ReauthEnv = Record<string, string | undefined>;

export function resolveExplicitCdpUrl(env: ReauthEnv): string | undefined {
  const trimmed = (env[REAUTH_CDP_URL_ENV] ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Attach the reauth browser. With an explicit LINKEDIN_REAUTH_CDP_URL the script connects
 * directly to a task-owned endpoint and must never create, bill, or stop a Browser Use
 * cloud browser; a failed explicit connection propagates without cloud fallback. Without
 * it, the existing Browser Use cloud path is preserved.
 */
export async function acquireReauthBrowser(options: {
  env: ReauthEnv;
  createCloudBrowser: () => Promise<CloudBrowserInfo>;
  stopCloudBrowser: (id: string | undefined) => Promise<void>;
  connectOverCDP?: ConnectOverCDP;
}): Promise<ReauthLease> {
  const connectOverCDP: ConnectOverCDP =
    options.connectOverCDP ?? ((url, connectOptions) => chromium.connectOverCDP(url, connectOptions));
  const explicitCdpUrl = resolveExplicitCdpUrl(options.env);

  if (explicitCdpUrl) {
    const browser = await connectOverCDP(explicitCdpUrl, { timeout: 120000 });
    // New task-owned context so existing tabs of the externally owned browser are
    // neither navigated nor closed; Chrome itself keeps running after release.
    let context: BrowserContext;
    try {
      context = await browser.newContext();
    } catch (error) {
      // The connection succeeded, so a failed setup must still release it
      // (browser.close() only disconnects; the attached Chrome keeps running).
      await browser.close().catch(() => {});
      throw error;
    }
    let page: Page;
    try {
      page = await context.newPage();
    } catch (error) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      throw error;
    }
    return {
      mode: 'explicit-cdp',
      browser,
      context,
      page,
      liveUrl: null,
      release: async () => {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      },
    };
  }

  const cloud = await options.createCloudBrowser();
  let browser: Browser;
  try {
    browser = await connectOverCDP(cloud.cdpUrl, { timeout: 120000 });
  } catch (error) {
    await options.stopCloudBrowser(cloud.id);
    throw error;
  }
  let createdContext: BrowserContext | undefined;
  try {
    const existingContext = browser.contexts()[0];
    let context: BrowserContext;
    if (existingContext) {
      context = existingContext;
    } else {
      createdContext = await browser.newContext();
      context = createdContext;
    }
    const page = context.pages()[0] ?? (await context.newPage());
    return {
      mode: 'browser-use-cloud',
      browser,
      context,
      page,
      cloudBrowserId: cloud.id,
      liveUrl: cloud.liveUrl ?? null,
      release: async () => {
        await browser.close().catch(() => {});
        await options.stopCloudBrowser(cloud.id);
      },
    };
  } catch (error) {
    // The paid cloud browser is already running: a setup failure must still
    // disconnect and stop it, closing only the context this path created.
    await createdContext?.close().catch(() => {});
    await browser.close().catch(() => {});
    await options.stopCloudBrowser(cloud.id);
    throw error;
  }
}

export type LinkedInAuthSignals = {
  visibleLoginInputs: number;
  navLinks: { mynetwork: number; messaging: number; notifications: number };
};

/**
 * Runs inside the page. Must stay fully self-contained (no outer-scope references)
 * because Playwright serializes the function source into the browser context.
 * No named nested arrow bindings: tsx/esbuild keepNames wraps those in a __name
 * helper that only exists in the loader realm, so the serialized callback would
 * throw ReferenceError inside the page.
 */
export function collectAuthSignals(): LinkedInAuthSignals {
  const loginInputs = Array.from(
    document.querySelectorAll(
      'input[type="password"], input[name="session_password"], input[name="session_key"], input[type="email"]'
    )
  );
  const hrefs = Array.from(document.querySelectorAll('a[href]')).map((anchor) => anchor.getAttribute('href') || '');
  return {
    visibleLoginInputs: loginInputs.filter((element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      return element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }).length,
    navLinks: {
      mynetwork: hrefs.filter((href) => href.includes('/mynetwork')).length,
      messaging: hrefs.filter((href) => href.includes('/messaging')).length,
      notifications: hrefs.filter((href) => href.includes('/notifications')).length,
    },
  };
}

export function hasAuthenticatedNav(signals: LinkedInAuthSignals): boolean {
  return (
    signals.navLinks.mynetwork > 0 && signals.navLinks.messaging > 0 && signals.navLinks.notifications > 0
  );
}

export function matchesExpectedLinkedInLocation(currentUrl: string, requestedUrl: string): boolean {
  let current: URL;
  let requested: URL;
  try {
    current = new URL(currentUrl);
    requested = new URL(requestedUrl);
  } catch {
    return false;
  }
  if (current.protocol !== 'https:' || current.host !== 'www.linkedin.com') return false;
  // Exact requested path only (a single trailing slash is insignificant): a
  // nested page such as /feed/update-urn-123/ is not the requested page.
  return stripTrailingSlash(current.pathname) === stripTrailingSlash(requested.pathname);
}

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export type AuthProbePage = Pick<Page, 'goto' | 'url' | 'evaluate' | 'waitForTimeout'>;

export type AuthPageVerification = {
  ok: boolean;
  reason: string;
  requestedUrl: string;
  currentUrl: string;
};

const VERIFY_ATTEMPTS = 2;
const VERIFY_SETTLE_MS = 2500;
const NAVIGATE_TIMEOUT_MS = 60000;

export async function verifyAuthenticatedLinkedInPage(
  page: AuthProbePage,
  requestedUrl: string,
  options?: { attempts?: number; settleMs?: number }
): Promise<AuthPageVerification> {
  const attempts = Math.max(1, options?.attempts ?? VERIFY_ATTEMPTS);
  const settleMs = options?.settleMs ?? VERIFY_SETTLE_MS;
  let last: AuthPageVerification = {
    ok: false,
    reason: 'not-attempted',
    requestedUrl,
    currentUrl: page.url(),
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let httpOk: boolean | null = null;
    try {
      const response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT_MS });
      httpOk = response ? response.ok() : null;
    } catch (error) {
      // A failed navigation must never be reported as authenticated, even when the
      // still-current URL and DOM happen to look authenticated.
      last = {
        ok: false,
        reason: `navigation-failed: ${error instanceof Error ? error.message : String(error)}`,
        requestedUrl,
        currentUrl: page.url(),
      };
      await page.waitForTimeout(settleMs).catch(() => {});
      continue;
    }

    await page.waitForTimeout(settleMs).catch(() => {});
    const currentUrl = page.url();
    const signals = await page.evaluate(collectAuthSignals).catch(() => null);
    const rejection = (reason: string): AuthPageVerification => ({ ok: false, reason, requestedUrl, currentUrl });

    if (httpOk === null) {
      // goto resolved without a response (e.g. same-document navigation or an
      // intercepted load); without a real successful response this is not proof.
      last = rejection('no-http-response');
      continue;
    }
    if (httpOk === false) {
      last = rejection('http-not-ok');
      continue;
    }
    if (!matchesExpectedLinkedInLocation(currentUrl, requestedUrl)) {
      last = rejection(`unexpected-location: ${currentUrl}`);
      continue;
    }
    if (!signals) {
      last = rejection('page-signals-unavailable');
      continue;
    }
    if (signals.visibleLoginInputs > 0) {
      last = rejection('login-form-visible');
      continue;
    }
    if (!hasAuthenticatedNav(signals)) {
      last = rejection('authenticated-nav-links-missing');
      continue;
    }
    return { ok: true, reason: 'authenticated', requestedUrl, currentUrl };
  }

  return last;
}

export type ReauthAuthenticationVerification = {
  ok: boolean;
  feed: AuthPageVerification;
  /** Null when Feed already failed: Catch Up is only meaningful behind a verified Feed. */
  catchUp: AuthPageVerification | null;
};

export async function verifyReauthAuthentication(
  page: AuthProbePage,
  options?: { attempts?: number; settleMs?: number }
): Promise<ReauthAuthenticationVerification> {
  const feed = await verifyAuthenticatedLinkedInPage(page, REAUTH_FEED_URL, options);
  if (!feed.ok) {
    return { ok: false, feed, catchUp: null };
  }
  const catchUp = await verifyAuthenticatedLinkedInPage(page, REAUTH_CATCH_UP_URL, options);
  return { ok: catchUp.ok, feed, catchUp };
}

export async function persistVerifiedStorageState(
  context: Pick<BrowserContext, 'storageState'>,
  path: string
): Promise<void> {
  try {
    await context.storageState({ path });
  } catch (error) {
    throw new Error(
      `Failed to save LinkedIn storage state after verification: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
