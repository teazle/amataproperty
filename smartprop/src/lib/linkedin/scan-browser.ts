import puppeteer, { type Browser, type Page } from 'puppeteer-core';

export const DEFAULT_SCAN_CDP_URL = 'http://127.0.0.1:18800';
export const ALLOW_BROWSER_USE_ENV = 'LINKEDIN_NEWSLETTER_ALLOW_BROWSER_USE';
const BROWSER_USE_API = 'https://api.browser-use.com/api/v3';

export type ScanEnv = Record<string, string | undefined>;
export type CloudBrowserInfo = { id: string; cdpUrl: string };
export type ConnectOverCDP = (cdpUrl: string) => Promise<Browser>;
export type CreateCloudBrowser = (env: ScanEnv) => Promise<CloudBrowserInfo>;
export type StopCloudBrowser = (cloudId: string) => Promise<void>;
export type ScanBrowserMode = 'explicit-cdp' | 'default-cdp' | 'browser-use-cloud';

export type ScanBrowserLease = {
  browser: Browser;
  page: Page;
  mode: ScanBrowserMode;
  stop: () => Promise<void>;
};

export function resolveExplicitScanCdpUrl(env: ScanEnv): string | undefined {
  const value = [env.LINKEDIN_NEWSLETTER_CDP_URL, env.OPENCLAW_BROWSER_CDP_URL, env.LINKEDIN_BROWSER_CDP_URL]
    .map((candidate) => (candidate || '').trim())
    .find((trimmed) => trimmed.length > 0);
  return value || undefined;
}

async function connectOverCdp(cdpUrl: string): Promise<Browser> {
  if (/^wss?:\/\//i.test(cdpUrl)) {
    return puppeteer.connect({ browserWSEndpoint: cdpUrl, protocolTimeout: 60000 });
  }
  return puppeteer.connect({ browserURL: cdpUrl, protocolTimeout: 60000 });
}

async function browserUseFetch<T>(env: ScanEnv, pathName: string, method: string, body?: unknown): Promise<T> {
  if (!env.BROWSER_USE_API_KEY) {
    throw new Error('BROWSER_USE_API_KEY is required when LINKEDIN_BROWSER_CDP_URL is not set');
  }

  const response = await fetch(`${BROWSER_USE_API}${pathName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Browser-Use-API-Key': env.BROWSER_USE_API_KEY,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Browser Use API ${method} ${pathName} failed: ${response.status} ${text.slice(0, 500)}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

async function createBrowserUseCloud(env: ScanEnv): Promise<CloudBrowserInfo> {
  const profileId = env.LINKEDIN_BROWSER_USE_PROFILE_ID || env.BROWSER_USE_PROFILE_ID;
  const profileName = env.LINKEDIN_BROWSER_USE_PROFILE_NAME || env.BROWSER_USE_PROFILE_NAME || 'smartprop-linkedin';
  return browserUseFetch<CloudBrowserInfo>(env, '/browsers', 'POST', {
    profileId,
    profileName: profileId ? undefined : profileName,
    proxyCountryCode: env.LINKEDIN_BROWSER_USE_PROXY_COUNTRY || 'sg',
    browserScreenWidth: Number(env.LINKEDIN_BROWSER_USE_SCREEN_WIDTH || 1280),
    browserScreenHeight: Number(env.LINKEDIN_BROWSER_USE_SCREEN_HEIGHT || 900),
    timeout: Number(env.LINKEDIN_BROWSER_USE_TIMEOUT_MINUTES || 45),
    allowResizing: true,
  });
}

async function stopBrowserUseCloud(env: ScanEnv, cloudId: string): Promise<void> {
  await browserUseFetch(env, `/browsers/${cloudId}`, 'PATCH', { action: 'stop' }).catch(() => undefined);
}

function makeLease(
  browser: Browser,
  page: Page,
  mode: ScanBrowserMode,
  cloudLease?: { id: string; stop: StopCloudBrowser },
): ScanBrowserLease {
  let stopped = false;
  return {
    browser,
    page,
    mode,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      try {
        await page.close();
      } catch {
        // page.close rejection must not skip the disconnect below
      }
      try {
        await browser.disconnect();
      } catch {
        // best-effort cleanup
      }
      if (cloudLease) {
        try {
          await cloudLease.stop(cloudLease.id);
        } catch {
          // best-effort cleanup
        }
      }
    },
  };
}

async function ownedLease(
  browser: Browser,
  mode: ScanBrowserMode,
  cloudLease?: { id: string; stop: StopCloudBrowser },
): Promise<ScanBrowserLease> {
  try {
    const page = await browser.newPage();
    return makeLease(browser, page, mode, cloudLease);
  } catch (error) {
    try {
      await browser.disconnect();
    } catch {
      // best-effort cleanup; the primary error must propagate
    }
    if (cloudLease) {
      try {
        await cloudLease.stop(cloudLease.id);
      } catch {
        // best-effort cleanup; the primary error must propagate
      }
    }
    throw error;
  }
}

export async function acquireScanBrowser(options: {
  explicitCdpUrl?: string;
  env?: ScanEnv;
  connectOverCDP?: ConnectOverCDP;
  createCloudBrowser?: CreateCloudBrowser;
  stopCloudBrowser?: StopCloudBrowser;
} = {}): Promise<ScanBrowserLease> {
  const env: ScanEnv = options.env ?? process.env;
  const connect = options.connectOverCDP ?? connectOverCdp;
  const createCloud = options.createCloudBrowser ?? ((cloudEnv: ScanEnv) => createBrowserUseCloud(cloudEnv));
  const stopCloud = options.stopCloudBrowser ?? ((cloudId: string) => stopBrowserUseCloud(env, cloudId));

  const explicitCdpUrl = (options.explicitCdpUrl || '').trim() || undefined;
  if (explicitCdpUrl) {
    // Explicit CDP fails closed: never falls back to the paid cloud path.
    const browser = await connect(explicitCdpUrl);
    return ownedLease(browser, 'explicit-cdp');
  }

  let browser: Browser;
  try {
    browser = await connect(DEFAULT_SCAN_CDP_URL);
  } catch {
    if ((env[ALLOW_BROWSER_USE_ENV] || '') !== 'true') {
      throw new Error(
        `scan CDP unavailable at ${DEFAULT_SCAN_CDP_URL} and ${ALLOW_BROWSER_USE_ENV}=true is not set; refusing paid Browser Use cloud fallback without explicit opt-in`,
      );
    }
    console.warn(`[scan] local OpenClaw CDP unavailable at ${DEFAULT_SCAN_CDP_URL}; falling back to Browser Use cloud (${ALLOW_BROWSER_USE_ENV}=true)`);
    const cloud = await createCloud(env);
    const cloudLease = { id: cloud.id, stop: stopCloud };
    let cloudBrowser: Browser;
    try {
      cloudBrowser = await connect(cloud.cdpUrl);
    } catch (error) {
      // Connect never handed the lease over, so this path owns stopping it.
      try {
        await stopCloud(cloud.id);
      } catch {
        // best-effort cleanup; the primary error must propagate
      }
      throw error;
    }
    // Post-connect failures (newPage) are cleaned up inside ownedLease, which
    // owns the lease stop from here on.
    return ownedLease(cloudBrowser, 'browser-use-cloud', cloudLease);
  }
  return ownedLease(browser, 'default-cdp');
}
