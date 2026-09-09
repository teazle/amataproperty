#!/usr/bin/env bun

import { config } from 'dotenv';
import { type Page } from 'puppeteer-core';
import {
  type LinkedInNewsletterRecipientInput,
} from '../src/lib/linkedin/newsletter';
import { acquireScanBrowser, resolveExplicitScanCdpUrl } from '../src/lib/linkedin/scan-browser';
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

const DEFAULT_SEARCH_URL =
  'https://www.linkedin.com/search/results/people/?keywords=Singapore&network=%5B%22F%22%5D&origin=GLOBAL_SEARCH_HEADER';

function argValue(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
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
  const session = await acquireScanBrowser({
    explicitCdpUrl: argValue('--cdp-url') || resolveExplicitScanCdpUrl(process.env),
  });
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
