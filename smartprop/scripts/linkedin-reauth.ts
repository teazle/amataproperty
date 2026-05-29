#!/usr/bin/env node
import { config } from 'dotenv';
import path from 'path';
import { chromium } from 'playwright-core';
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

async function isAuthenticatedLinkedInPage(page: unknown): Promise<boolean> {
  const url = page.url();
  const loginFormCount = await page
    .locator('input[name="session_key"], input[name="session_password"], .login-form, form[action*="login"]')
    .count()
    .catch(() => 0);
  const loginUrl = /linkedin\.com\/(login|uas\/login|checkpoint|challenge|authwall)/i.test(url);
  const hasShell = await page
    .locator('nav[role="navigation"], nav.global-nav, header[role="banner"], main')
    .count()
    .catch(() => 0);
  return !loginUrl && loginFormCount === 0 && hasShell > 0;
}

async function verifyUrl(page: unknown, url: string): Promise<boolean> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return isAuthenticatedLinkedInPage(page);
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

async function fillVisibleInput(page: unknown, selector: string, value: string): Promise<boolean> {
  const locator = page.locator(selector).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) return false;

  const visible = await locator.isVisible().catch(() => false);
  if (!visible) return false;

  await locator.fill(value, { timeout: 10000 });
  return true;
}

async function tryCredentialLogin(page: unknown): Promise<'already_authenticated' | 'submitted' | 'missing_credentials' | 'no_form'> {
  if (await isAuthenticatedLinkedInPage(page)) {
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
    const button = page.locator(selector).first();
    const count = await button.count().catch(() => 0);
    if (count === 0) continue;

    const visible = await button.isVisible().catch(() => false);
    if (!visible) continue;

    await button.click({ timeout: 10000 }).catch(async () => {
      await button.dispatchEvent('click').catch(() => {});
    });
    await page.waitForTimeout(5000);
    return 'submitted';
  }

  const namedButton = page.getByRole('button', { name: /^Sign in$/ }).last();
  const namedCount = await namedButton.count().catch(() => 0);
  if (namedCount > 0 && await namedButton.isVisible().catch(() => false)) {
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
  let cloud: BrowserUseBrowser | null = null;
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
    cloud = await createCloudBrowser();
    lock = {
      ...lock,
      reauthLiveUrl: cloud.liveUrl || null,
      reauthBrowserId: cloud.id,
    };
    writeLockFile(lock);

    console.log(`BROWSER_USE_LIVE_URL=${cloud.liveUrl || ''}`);
    console.log(`BROWSER_ID=${cloud.id}`);
    console.log(`REAUTH_DEADLINE=${deadlineAt.toISOString()}`);
    console.log(`REAUTH_PROXY=${DISABLE_PROXY ? 'disabled' : 'enabled'}`);

    const browser = await chromium.connectOverCDP(cloud.cdpUrl, { timeout: 120000 });
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
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

    let verified = false;
    let lastVerifyAttemptAt = 0;
    while (Date.now() < deadlineAt.getTime()) {
      await page.waitForTimeout(5000);
      lock.lastHeartbeatAt = new Date().toISOString();
      writeLockFile(lock);

      if (await isAuthenticatedLinkedInPage(page)) {
        const catchUp = await verifyUrl(page, 'https://www.linkedin.com/mynetwork/catch-up/all/');
        lock.authCheck = {
          feed: true,
          catchUp,
          currentUrl: page.url(),
          reason: catchUp ? 'authenticated' : 'catch-up did not authenticate',
        };
        writeLockFile(lock);

        if (catchUp) {
          verified = true;
          break;
        }
      }

      const summary = await getPageSummary(page);
      const lowerText = summary.text.toLowerCase();
      const waitingForChallenge =
        /checkpoint|challenge|two-step|verification|verify|security|approval|authwall/i.test(summary.url) ||
        /check your linkedin app|verification|security check|approve|two-step|authenticator|enter the code/i.test(lowerText);
      const loginError = /unexpected error|try again|incorrect|wrong|unable/i.test(lowerText);

      console.log(`AUTH_WAIT url=${summary.url} loginForm=${summary.hasLoginForm} challenge=${waitingForChallenge} error=${loginError} text="${summary.text.slice(0, 180)}"`);

      if (waitingForChallenge || summary.hasLoginForm || loginError) {
        continue;
      }

      const now = Date.now();
      if (now - lastVerifyAttemptAt < 30000) {
        continue;
      }
      lastVerifyAttemptAt = now;

      const feed = await verifyUrl(page, 'https://www.linkedin.com/feed/');
      if (!feed) {
        console.log(`AUTH_CHECK feed=false currentUrl=${page.url()}`);
        continue;
      }

      const catchUp = await verifyUrl(page, 'https://www.linkedin.com/mynetwork/catch-up/all/');
      lock.authCheck = {
        feed,
        catchUp,
        currentUrl: page.url(),
        reason: catchUp ? 'authenticated' : 'catch-up did not authenticate',
      };
      writeLockFile(lock);

      if (catchUp) {
        verified = true;
        break;
      }
      console.log(`AUTH_CHECK feed=${feed} catchUp=${catchUp} currentUrl=${page.url()}`);
    }

    if (!verified) {
      lock.status = 'reauth_required';
      lock.error = 'Manual LinkedIn reauth timed out before feed and Catch Up were verified';
      lock.stoppedAt = new Date().toISOString();
      writeLockFile(lock);
      throw new Error(lock.error);
    }

    await context.storageState({ path: getStorageStatePath() }).catch(() => {});
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

    await browser.close().catch(() => {});
    await stopCloudBrowser(cloud?.id);
    deleteLockFile();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lock.status = 'reauth_required';
    lock.error = message;
    lock.stoppedAt = new Date().toISOString();
    writeLockFile(lock);
    await stopCloudBrowser(cloud?.id);
    console.error(`LINKEDIN_REAUTH_FAILED=${message}`);
    process.exit(1);
  }
}

main();
