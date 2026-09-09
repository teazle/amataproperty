#!/usr/bin/env bun

import { config } from 'dotenv';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import {
  type LinkedInNewsletterRecipientInput,
} from '../src/lib/linkedin/newsletter';
import {
  collectLinkedInResultCards,
  countVisibleResultProfileLinks,
  dedupeSingaporeResultCards,
  extractionMismatchDiagnostic,
  identifiableProfileCount,
  linkedInResultsReady,
  type LinkedInResultCardSnapshot,
} from '../src/lib/linkedin/scan-extraction';
import {
  upsertLinkedInNewsletterDraftCampaign,
  upsertLinkedInNewsletterRecipients,
} from '../src/lib/linkedin/newsletter-store';

config({ path: '/root/.openclaw/workspace/linkedin.env', override: false, quiet: true });
config({ path: '.env.local', override: false, quiet: true });
config({ path: '.env', override: false, quiet: true });

const BROWSER_USE_API = 'https://api.browser-use.com/api/v3';
const DEFAULT_OPENCLAW_CDP_URL = 'http://127.0.0.1:18800';
const DEFAULT_SEARCH_URL =
  'https://www.linkedin.com/search/results/people/?keywords=Singapore&network=%5B%22F%22%5D&origin=GLOBAL_SEARCH_HEADER';

type BrowserSession = {
  browser: Browser;
  page: Page;
  stop: () => Promise<void>;
};

function argValue(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function browserUseFetch<T>(pathName: string, method: string, body?: unknown): Promise<T> {
  if (!process.env.BROWSER_USE_API_KEY) {
    throw new Error('BROWSER_USE_API_KEY is required when LINKEDIN_BROWSER_CDP_URL is not set');
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

async function connectLinkedInBrowser(): Promise<BrowserSession> {
  const configuredCdp =
    argValue('--cdp-url') ||
    process.env.LINKEDIN_NEWSLETTER_CDP_URL ||
    process.env.OPENCLAW_BROWSER_CDP_URL ||
    process.env.LINKEDIN_BROWSER_CDP_URL ||
    DEFAULT_OPENCLAW_CDP_URL;
  const explicitCdp = Boolean(
    argValue('--cdp-url') ||
    process.env.LINKEDIN_NEWSLETTER_CDP_URL ||
    process.env.OPENCLAW_BROWSER_CDP_URL ||
    process.env.LINKEDIN_BROWSER_CDP_URL,
  );

  try {
    const browser = await connectOverCdp(configuredCdp);
    const pages = await browser.pages();
    const page = pages.find((candidate) => /linkedin\.com/i.test(candidate.url())) || pages[0] || await browser.newPage();
    return {
      browser,
      page,
      stop: async () => {
        await browser.disconnect();
      },
    };
  } catch (error) {
    if (explicitCdp) {
      throw error;
    }
    console.warn(`[scan] local OpenClaw CDP unavailable at ${configuredCdp}; falling back to Browser Use cloud`);
  }

  const profileId = process.env.LINKEDIN_BROWSER_USE_PROFILE_ID || process.env.BROWSER_USE_PROFILE_ID;
  const profileName = process.env.LINKEDIN_BROWSER_USE_PROFILE_NAME || process.env.BROWSER_USE_PROFILE_NAME || 'smartprop-linkedin';
  const cloud = await browserUseFetch<{ id: string; cdpUrl: string }>('/browsers', 'POST', {
    profileId,
    profileName: profileId ? undefined : profileName,
    proxyCountryCode: process.env.LINKEDIN_BROWSER_USE_PROXY_COUNTRY || 'sg',
    browserScreenWidth: Number(process.env.LINKEDIN_BROWSER_USE_SCREEN_WIDTH || 1280),
    browserScreenHeight: Number(process.env.LINKEDIN_BROWSER_USE_SCREEN_HEIGHT || 900),
    timeout: Number(process.env.LINKEDIN_BROWSER_USE_TIMEOUT_MINUTES || 45),
    allowResizing: true,
  });

  const browser = await connectOverCdp(cloud.cdpUrl);
  const pages = await browser.pages();
  const page = pages.find((candidate) => /linkedin\.com/i.test(candidate.url())) || pages[0] || await browser.newPage();

  return {
    browser,
    page,
    stop: async () => {
      browser.disconnect?.();
      await browserUseFetch(`/browsers/${cloud.id}`, 'PATCH', { action: 'stop' }).catch(() => undefined);
    },
  };
}

async function connectOverCdp(cdpUrl: string): Promise<Browser> {
  if (/^wss?:\/\//i.test(cdpUrl)) {
    return puppeteer.connect({ browserWSEndpoint: cdpUrl, protocolTimeout: 60000 });
  }
  return puppeteer.connect({ browserURL: cdpUrl, protocolTimeout: 60000 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLinkedInAuthWall(url: string): boolean {
  return /linkedin\.com\/(login|checkpoint|challenge|authwall|uas\/login)/i.test(url);
}

async function assertLinkedInAuthenticated(page: Page): Promise<void> {
  const state = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: document.body?.innerText?.slice(0, 500) || '',
  }));
  if (
    isLinkedInAuthWall(state.url) ||
    /linkedin login|sign in \| linkedin/i.test(state.title) ||
    (/^sign in\b/i.test(state.text) && /email or phone/i.test(state.text))
  ) {
    throw new Error('LinkedIn session is not authenticated or is at a checkpoint');
  }
}

async function extractSingaporeCandidates(page: Page): Promise<{
  candidates: LinkedInNewsletterRecipientInput[];
  snapshots: LinkedInResultCardSnapshot[];
}> {
  const snapshots = await page.evaluate(collectLinkedInResultCards);
  return { candidates: dedupeSingaporeResultCards(snapshots), snapshots };
}

async function goToNextResultsPage(page: Page): Promise<boolean> {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="Next"]'));
    const next = buttons.find((button) => !button.disabled && button.getAttribute('aria-disabled') !== 'true');
    if (!next) return false;
    next.click();
    return true;
  });
  if (!clicked) return false;
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
  await sleep(2500);
  return true;
}

async function main() {
  const campaignSlug = argValue('--campaign-slug');
  if (!campaignSlug) {
    throw new Error('Usage: bun scripts/linkedin-newsletter-scan.ts --campaign-slug <slug> [--search-url <url>] [--cdp-url <url>] [--max-pages 5] [--dry-run]');
  }

  const dryRun = hasFlag('--dry-run');
  const maxPages = Number(argValue('--max-pages', process.env.LINKEDIN_NEWSLETTER_SCAN_MAX_PAGES || '5'));
  const searchUrl = argValue('--search-url', process.env.LINKEDIN_NEWSLETTER_SEARCH_URL || DEFAULT_SEARCH_URL)!;
  const session = await connectLinkedInBrowser();
  const candidates = new Map<string, LinkedInNewsletterRecipientInput>();

  try {
    await session.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3500);
    await assertLinkedInAuthenticated(session.page);
    await session.page
      .waitForFunction(linkedInResultsReady, { polling: 500, timeout: 20000 })
      .catch(() => console.warn('[scan] results readiness check timed out; continuing with extraction'));

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      await assertLinkedInAuthenticated(session.page);
      const { candidates: pageCandidates, snapshots } = await extractSingaporeCandidates(session.page);
      for (const candidate of pageCandidates) {
        candidates.set(candidate.profileUrl, candidate);
      }
      console.log(`[scan] page=${pageNumber} singaporeCandidates=${pageCandidates.length} total=${candidates.size}`);

      // Diagnose selector drift on raw identifiable profiles, before Singapore
      // filtering: an all-non-Singapore page legitimately yields zero candidates.
      const extractedProfileCount = identifiableProfileCount(snapshots);
      if (extractedProfileCount === 0) {
        const visibleProfileCount = await session.page.evaluate(countVisibleResultProfileLinks);
        const mismatch = extractionMismatchDiagnostic({ pageNumber, extractedProfileCount, visibleProfileCount });
        if (mismatch) throw new Error(mismatch);
      }

      if (pageNumber === maxPages) break;
      if (!(await goToNextResultsPage(session.page))) break;
    }
  } finally {
    await session.stop();
  }

  const recipients = Array.from(candidates.values());
  if (!dryRun) {
    const campaignId = await upsertLinkedInNewsletterDraftCampaign({ campaignSlug });
    await upsertLinkedInNewsletterRecipients(campaignId, recipients, 'candidate');
  }

  console.log(JSON.stringify({
    dryRun,
    campaignSlug,
    searchUrl,
    candidates: recipients.length,
    stored: dryRun ? 0 : recipients.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
