#!/usr/bin/env node
import { config } from 'dotenv';
import path from 'path';
import type { Page } from 'playwright-core';
import {
  acquireReauthBrowser,
  collectAuthSignals,
  hasAuthenticatedNav,
  persistVerifiedStorageState,
  verifyReauthAuthentication,
  type ReauthLease,
} from '../src/lib/linkedin/reauth-browser';
import { writeLockFile, deleteLockFile, getStorageStatePath, type LinkedInLockData } from '../src/lib/linkedin/storage';

config({ path: path.resolve(process.cwd(), '.env.local'), override: false });
config({ path: path.resolve(process.cwd(), '.env'), override: false });

const BROWSER_USE_API = 'https://api.browser-use.com/api/v3';
const WAIT_MINUTES = Number(process.env.LINKEDIN_REAUTH_TIMEOUT_MINUTES || 30);
const WAIT_MS = Math.max(5, WAIT_MINUTES) * 60 * 1000;
const SCREEN_WIDTH = Number(process.env.LINKEDIN_REAUTH_SCREEN_WIDTH || 1280);
const SCREEN_HEIGHT = Number(process.env.LINKEDIN_REAUTH_SCREEN_HEIGHT || 720);
const DISABLE_PROXY = process.env.LINKEDIN_REAUTH_DISABLE_PROXY === 'true';

type BrowserUseBrowser = {
  id: string;
  liveUrl?: string | null;
  cdpUrl: string;
};

async function browserUseFetch<T>(pathName: string, method: string, body?: unknown): Promise<T> {
  if (!process.env.BROWSER_USE_API_KEY) {
    throw new Error('BROWSER_USE_API_KEY is required for LinkedIn Browser Use reauth');
  }

  const response = await fetch(`${BROWSER_USE_API}${pathName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Browser-Use-API-Key': process.env.BROWSER_USE_API_KEY,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Browser Use API ${method} ${pathName} failed: ${response.status} ${text.slice(0, 500)}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

async function createCloudBrowser(): Promise<BrowserUseBrowser> {
  const profileId = process.env.LINKEDIN_BROWSER_USE_PROFILE_ID || process.env.BROWSER_USE_PROFILE_ID;
  const profileName = process.env.LINKEDIN_BROWSER_USE_PROFILE_NAME || process.env.BROWSER_USE_PROFILE_NAME || 'smartprop-linkedin';
  const body: Record<string, unknown> = {
    timeout: Math.max(WAIT_MINUTES + 5, 35),
    browserScreenWidth: SCREEN_WIDTH,
    browserScreenHeight: SCREEN_HEIGHT,
    allowResizing: true,
  };

  if (!DISABLE_PROXY) {
    body.proxyCountryCode =
      process.env.LINKEDIN_REAUTH_PROXY_COUNTRY ||
      process.env.LINKEDIN_BROWSER_USE_PROXY_COUNTRY ||
      process.env.BROWSER_USE_PROXY_COUNTRY ||
      'sg';
  }

  if (profileId) {
    body.profileId = profileId;
  } else {
    body.profileName = profileName;
  }

  return browserUseFetch<BrowserUseBrowser>('/browsers', 'POST', body);
}

async function stopCloudBrowser(id: string | undefined) {
  if (!id) return;
  await browserUseFetch(`/browsers/${id}`, 'PATCH', { action: 'stop' }).catch(() => {});
}

async function looksAuthenticated(page: Page): Promise<boolean> {
  const url = page.url();
  if (!/^https:\/\/www\.linkedin\.com\//i.test(url)) return false;
  if (/linkedin\.com\/(login|uas\/login|checkpoint|challenge|authwall)/i.test(url)) return false;
  const signals = await page.evaluate(collectAuthSignals).catch(() => null);
  if (!signals || signals.visibleLoginInputs > 0) return false;
  return hasAuthenticatedNav(signals);
}

async function getPageSummary(page: unknown): Promise<{ url: string; title: string; text: string; hasLoginForm: boolean }> {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: document.body?.innerText?.replace(/\s+/g, ' ').slice(0, 500) || '',
    hasLoginForm: Boolean(
      document.querySelector('input[type="email"], input[name="session_key"], input[type="password"], input[name="session_password"]')
    ),
  })).catch(() => ({
    url: page.url(),
    title: '',
    text: '',
    hasLoginForm: false,
  }));
}

export async function fillVisibleInput(page: unknown, selector: string, value: string): Promise<boolean> {
  const locator = page.locator(selector);
  const count = await locator.count().catch(() => 0);
  // LinkedIn's login renders duplicated responsive fields whose first DOM match
  // can be hidden; only a visible field can accept the credential fill.
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) continue;

    await candidate.fill(value, { timeout: 10000 });
    return true;
  }
  return false;
}

export async function tryCredentialLogin(page: Page): Promise<'already_authenticated' | 'submitted' | 'missing_credentials' | 'no_form'> {
  if (await looksAuthenticated(page)) {
    return 'already_authenticated';
  }

  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;
  if (!email || !password) {
    return 'missing_credentials';
  }

  const hasEmail = await fillVisibleInput(
    page,
    'input[name="session_key"], input#username, input[autocomplete*="username"], input[type="email"]',
    email
  );
  const hasPassword = await fillVisibleInput(
    page,
    'input[name="session_password"], input#password, input[autocomplete*="current-password"], input[type="password"]',
    password
  );

  if (!hasEmail || !hasPassword) {
    return 'no_form';
  }

  const buttonSelectors = [
    'button[type="submit"]',
    'button[data-litms-control-urn*="login-submit"]',
    'form button',
  ];

  for (const selector of buttonSelectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const button = locator.nth(index);
      const visible = await button.isVisible().catch(() => false);
      if (!visible) continue;

      await button.click({ timeout: 10000 }).catch(async () => {
        await button.dispatchEvent('click').catch(() => {});
      });
      await page.waitForTimeout(5000);
      return 'submitted';
    }
  }

  const namedButtons = page.getByRole('button', { name: /^Sign in$/ });
  const namedCount = await namedButtons.count().catch(() => 0);
  for (let index = 0; index < namedCount; index += 1) {
    const namedButton = namedButtons.nth(index);
    const visible = await namedButton.isVisible().catch(() => false);
    if (!visible) continue;

    await namedButton.click({ timeout: 10000 }).catch(async () => {
      await namedButton.dispatchEvent('click').catch(() => {});
    });
    await page.waitForTimeout(5000);
    return 'submitted';
  }

  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(5000);
  return 'submitted';
}

async function main() {
  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + WAIT_MS);
  let lease: ReauthLease | null = null;
  let lock: LinkedInLockData = {
    pid: process.pid,
    status: 'reauth_required',
    startedAt: startedAt.toISOString(),
    lastHeartbeatAt: startedAt.toISOString(),
    contactsProcessed: 0,
    messagesSent: 0,
    messagesFailed: 0,
    currentContactIndex: 0,
    error: 'Waiting for manual LinkedIn reauth',
    reauthStartedAt: startedAt.toISOString(),
    reauthDeadlineAt: deadlineAt.toISOString(),
  };

  try {
    lease = await acquireReauthBrowser({ env: process.env, createCloudBrowser, stopCloudBrowser });
    lock = {
      ...lock,
      reauthLiveUrl: lease.liveUrl,
      reauthBrowserId: lease.cloudBrowserId ?? null,
    };
    writeLockFile(lock);

    console.log(`REAUTH_MODE=${lease.mode}`);
    console.log(`BROWSER_USE_LIVE_URL=${lease.liveUrl || ''}`);
    console.log(`BROWSER_ID=${lease.cloudBrowserId || ''}`);
    console.log(`REAUTH_DEADLINE=${deadlineAt.toISOString()}`);
    console.log(`REAUTH_PROXY=${lease.mode === 'explicit-cdp' ? 'external-browser' : DISABLE_PROXY ? 'disabled' : 'enabled'}`);

    const { context, page } = lease;
    await page.setViewportSize({ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }).catch(() => {});

    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1';
      document.body.style.zoom = '1';
    }).catch(() => {});
    console.log(`CURRENT_URL=${page.url()}`);
    const credentialLogin = await tryCredentialLogin(page);
    console.log(`CREDENTIAL_LOGIN=${credentialLogin}`);
    if (credentialLogin === 'submitted') {
      lock.error = 'Credentials submitted; waiting for LinkedIn app approval or authenticated session verification';
      lock.lastHeartbeatAt = new Date().toISOString();
      writeLockFile(lock);
    }
    console.log('WAITING_FOR_MANUAL_LINKEDIN_LOGIN=true');

    let verified: Awaited<ReturnType<typeof verifyReauthAuthentication>> | null = null;
    let lastVerifyAttemptAt = 0;
    while (Date.now() < deadlineAt.getTime()) {
      await page.waitForTimeout(5000);
      lock.lastHeartbeatAt = new Date().toISOString();
      writeLockFile(lock);

      const summary = await getPageSummary(page);
      const lowerText = summary.text.toLowerCase();
      const waitingForChallenge =
        /checkpoint|challenge|two-step|verification|verify|security|approval|authwall/i.test(summary.url) ||
        /check your linkedin app|verification|security check|approve|two-step|authenticator|enter the code/i.test(lowerText);
      const loginError = /unexpected error|try again|incorrect|wrong|unable/i.test(lowerText);

      console.log(`AUTH_WAIT url=${summary.url} loginForm=${summary.hasLoginForm} challenge=${waitingForChallenge} error=${loginError} text="${summary.text.slice(0, 180)}"`);

      // While a challenge or login form is visible, verifying would navigate this
      // page away from the in-progress login, so keep waiting instead.
      if (waitingForChallenge || summary.hasLoginForm || loginError) {
        continue;
      }

      const now = Date.now();
      if (now - lastVerifyAttemptAt < 30000) {
        continue;
      }
      lastVerifyAttemptAt = now;

      const outcome = await verifyReauthAuthentication(page);
      lock.authCheck = {
        feed: outcome.feed.ok,
        catchUp: outcome.catchUp ? outcome.catchUp.ok : false,
        currentUrl: page.url(),
        reason: outcome.ok ? 'authenticated' : outcome.catchUp ? outcome.catchUp.reason : outcome.feed.reason,
      };
      writeLockFile(lock);

      if (outcome.ok) {
        verified = outcome;
        break;
      }
      console.log(`AUTH_CHECK feed=${outcome.feed.ok} catchUp=${outcome.catchUp ? outcome.catchUp.ok : false} reason="${lock.authCheck.reason}"`);
    }

    if (!verified) {
      lock.status = 'reauth_required';
      lock.error = 'Manual LinkedIn reauth timed out before feed and Catch Up were verified';
      lock.stoppedAt = new Date().toISOString();
      writeLockFile(lock);
      throw new Error(lock.error);
    }

    // Storage is only persisted after real feed + Catch Up verification; a save
    // failure must fail the run instead of being swallowed behind a success print.
    await persistVerifiedStorageState(context, getStorageStatePath());
    lock.status = 'stopped';
    lock.error = undefined;
    lock.authVerifiedAt = new Date().toISOString();
    lock.stoppedAt = new Date().toISOString();
    lock.authCheck = {
      feed: true,
      catchUp: true,
      currentUrl: page.url(),
      reason: 'feed and Catch Up verified',
    };
    writeLockFile(lock);
    console.log('LINKEDIN_REAUTH_VERIFIED=true');

    await lease.release();
    deleteLockFile();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lock.status = 'reauth_required';
    lock.error = message;
    lock.stoppedAt = new Date().toISOString();
    writeLockFile(lock);
    await lease?.release();
    console.error(`LINKEDIN_REAUTH_FAILED=${message}`);
    process.exit(1);
  }
}

// Run only as an entry point: bun test imports (import.meta.main === false) must
// not start a reauth run; tsx has no import.meta.main (undefined) and still runs.
if (import.meta.main !== false) {
  main();
}
