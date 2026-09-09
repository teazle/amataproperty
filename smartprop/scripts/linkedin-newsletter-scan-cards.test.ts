import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import {
  collectLinkedInResultCards,
  countVisibleResultProfileLinks,
  dedupeSingaporeResultCards,
  extractionMismatchDiagnostic,
  identifiableProfileCount,
  linkedInResultsReady,
} from '../src/lib/linkedin/scan-extraction';

// Offline, task-owned browser fixture: synthetic HTML only. No navigation,
// credentials, sessions, or network access. Codex proves real LinkedIn DOM
// serialization on the VPS separately.
const CHROME_CANDIDATES = [
  process.env.LINKEDIN_SCAN_TEST_CHROME,
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((candidate): candidate is string => Boolean(candidate));
const chromeExecutable = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

const FIXTURE_LAUNCH_ARGS = ['--no-first-run', '--no-default-browser-check'];

// One-time pre-flight: some verification sandboxes cannot launch a local
// Chrome at all (ProcessSingleton creation fails under (deny network*)).
// Skip the offline fixture tests explicitly in that case; live DOM
// serialization is proven on the VPS. LINKEDIN_SCAN_REQUIRE_BROWSER=1 makes
// unavailability a hard failure instead of a skip, for standalone acceptance.
const requireBrowser = process.env.LINKEDIN_SCAN_REQUIRE_BROWSER === '1';

async function probeFixtureBrowserAvailable(): Promise<{ available: boolean; reason: string }> {
  if (!chromeExecutable) return { available: false, reason: 'no local Chrome/Chromium executable discovered' };
  let userDataDir: string | undefined;
  try {
    userDataDir = mkdtempSync(join(tmpdir(), 'scan-cards-probe-'));
    const browser = await puppeteer.launch({
      executablePath: chromeExecutable,
      headless: true,
      args: FIXTURE_LAUNCH_ARGS,
      userDataDir,
      timeout: 15000,
    });
    await browser.close();
    return { available: true, reason: '' };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message.split('\n')[0] : String(error),
    };
  } finally {
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  }
}

const fixtureProbe = await probeFixtureBrowserAvailable();
if (!fixtureProbe.available) {
  if (requireBrowser) {
    throw new Error(
      `LINKEDIN_SCAN_REQUIRE_BROWSER=1: offline Chrome fixtures are required but unavailable (${fixtureProbe.reason})`,
    );
  }
  console.log(`[scan-cards-test] skipping offline Chrome fixture tests: owned browser launch unavailable (${fixtureProbe.reason})`);
}
const fixtureBrowserAvailable = fixtureProbe.available;

let ownedBrowserPid: number | undefined;
let fixtureHarness: Promise<{ browser: Browser; page: Page; userDataDir: string }> | undefined;

type FixtureBrowserLauncher = (options: {
  executablePath: string;
  headless: boolean;
  args: string[];
  userDataDir: string;
}) => Promise<Browser>;

// Local browser reference with try/catch: a launch/newPage failure closes the
// browser it owns and rethrows. Never awaits the promise being initialized.
// A unique userDataDir per attempt avoids ProcessSingleton collisions with
// puppeteer's shared deterministic temp profile path across concurrent runs.
async function launchFixtureHarness(
  launchBrowser: FixtureBrowserLauncher = (options) => {
    if (!chromeExecutable) throw new Error('No local Chrome/Chromium executable found for scan fixture tests');
    return puppeteer.launch({ ...options, timeout: 15000 });
  },
): Promise<{ browser: Browser; page: Page; userDataDir: string }> {
  let userDataDir: string | undefined;
  let browser: Browser | undefined;
  try {
    userDataDir = mkdtempSync(join(tmpdir(), 'scan-cards-fixture-'));
    browser = await launchBrowser({
      executablePath: chromeExecutable as string,
      headless: true,
      args: FIXTURE_LAUNCH_ARGS,
      userDataDir,
    });
    ownedBrowserPid = browser.process()?.pid;
    const page = await browser.newPage();
    return { browser, page, userDataDir };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    ownedBrowserPid = undefined;
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

// Lazy on purpose: pure tests run everywhere; the offline browser fixture
// launches only when a fixture test actually executes on a machine with a
// discovered Chrome/Chromium executable. A failed launch resets the harness
// so later tests retry with a fresh profile dir instead of reusing the
// cached rejection.
function fixturePage(): Promise<Page> {
  fixtureHarness ??= launchFixtureHarness().catch((error: unknown) => {
    fixtureHarness = undefined;
    throw error;
  });
  return fixtureHarness.then((harness) => harness.page);
}

afterAll(async () => {
  const harness = await fixtureHarness?.catch(() => undefined);
  if (!harness) return;
  await harness.browser.close();
  rmSync(harness.userDataDir, { recursive: true, force: true });
  if (ownedBrowserPid !== undefined) {
    console.log(`[scan-cards-test] task-owned browser pid=${ownedBrowserPid} closed; profile dir removed`);
  }
});

// Mirrors the sanitized ancestor shape from linkedin-scan-dom-proof-20260909:
// main > div > div[role="list"] > div[role="listitem"] > div > div > a
function semanticCard(name: string, slug: string, headline: string, location: string): string {
  return `
      <div role="listitem">
        <div>
          <div>
            <a href="https://www.linkedin.com/in/${slug}?miniProfileUrn=urn:li:fs_miniProfile:${slug}">${name}</a>
            <p>${headline}</p>
            <div>${location}</div>
          </div>
        </div>
      </div>`;
}

const SEMANTIC_SEARCH_PAGE = `<!DOCTYPE html>
<html><head><title>Search | LinkedIn</title></head>
<body>
<main>
  <div>
    <div role="list">
      ${semanticCard('Alice Teo', 'alice-teo', 'Real Estate Agent at PropertyNest', 'Singapore')}
      ${semanticCard('Bernard Lim', 'bernard-lim', 'Mortgage Consultant', 'Central Region, Singapore')}
      ${semanticCard('Catherine Wong', 'catherine-wong', 'PropNex Realtor', 'Singapore, Singapore')}
      ${semanticCard('Devi Menon', 'devi-meno', 'Regional Property Advisor', 'Kuala Lumpur, Malaysia')}
    </div>
    <a href="https://www.linkedin.com/in/footer-decoy">LinkedIn Member</a>
  </div>
</main>
</body></html>`;

const LEGACY_SEARCH_PAGE = `<!DOCTYPE html>
<html><head><title>Search | LinkedIn</title></head>
<body>
<main>
  <ul>
    <li class="reusable-search__result-container">
      <a href="https://www.linkedin.com/in/grace-chan?miniProfileUrn=urn:li:fs_miniProfile:grace-chan">Grace Chan</a>
      <div>Property Manager</div>
      <div>Singapore</div>
    </li>
    <li class="reusable-search__result-container">
      <a href="https://www.linkedin.com/in/henry-ong?miniProfileUrn=urn:li:fs_miniProfile:henry-ong">Henry Ong</a>
      <div>Investor</div>
      <div>Jakarta, Indonesia</div>
    </li>
  </ul>
</main>
</body></html>`;

// A card matched by both the legacy li selector and the semantic
// role="listitem" selector must dedupe to a single candidate.
const OVERLAP_SEARCH_PAGE = `<!DOCTYPE html>
<html><head><title>Search | LinkedIn</title></head>
<body>
<main>
  <div role="list">
    <div role="listitem">
      <ul>
        <li>
          <a href="https://www.linkedin.com/in/james-tan?miniProfileUrn=urn:li:fs_miniProfile:james-tan">James Tan</a>
          <div>Agent</div>
          <div>Singapore</div>
        </li>
      </ul>
    </div>
  </div>
</main>
</body></html>`;

async function extractCandidates(fixtureHtml: string) {
  const page = await fixturePage();
  await page.setContent(fixtureHtml);
  return dedupeSingaporeResultCards(await page.evaluate(collectLinkedInResultCards));
}

describe('linkedin-newsletter-scan result-card extraction (pure)', () => {
  test('skips entries without a profile URL or name, and non-Singapore locations', () => {
    const candidates = dedupeSingaporeResultCards([
      { name: 'No Link', profileUrl: '', location: 'Singapore', headline: null },
      { name: '', profileUrl: 'https://www.linkedin.com/in/no-name', location: 'Singapore', headline: null },
      { name: 'Far Away', profileUrl: 'https://www.linkedin.com/in/far-away', location: 'Tokyo, Japan', headline: null },
    ]);
    expect(candidates).toEqual([]);
  });

  test('normalizes tracking query params so duplicate profile URLs collapse', () => {
    const candidates = dedupeSingaporeResultCards([
      { name: 'Alice Teo', profileUrl: 'https://www.linkedin.com/in/alice-teo?miniProfileUrn=urn:one', location: 'Singapore', headline: 'Agent' },
      { name: 'Alice Teo', profileUrl: 'https://www.linkedin.com/in/alice-teo?miniProfileUrn=urn:two', location: 'Singapore', headline: 'Agent' },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].profileUrl).toBe('https://www.linkedin.com/in/alice-teo');
  });
});

const LOADING_SEARCH_PAGE = `<!DOCTYPE html>
<html><head><title>Search | LinkedIn</title></head>
<body>
<main><div></div></main>
</body></html>`;

const NO_RESULTS_SEARCH_PAGE = `<!DOCTYPE html>
<html><head><title>Search | LinkedIn</title></head>
<body>
<main><div>No results found. Try different keywords.</div></main>
</body></html>`;

// The original failing page matched thirty irrelevant li elements with zero
// profile links; such li must never satisfy readiness on its own.
const IRRELEVANT_LI_SEARCH_PAGE = `<!DOCTYPE html>
<html><head><title>Search | LinkedIn</title></head>
<body>
<main>
  <ul>
    <li>People filters</li>
    <li>Page 1 of 25</li>
  </ul>
</main>
</body></html>`;

const HIDDEN_ANCHOR_SEARCH_PAGE = `<!DOCTYPE html>
<html><head><title>Search | LinkedIn</title></head>
<body>
<main>
  <div role="list">
    <div role="listitem">
      <a href="https://www.linkedin.com/in/visible-vic">Visible Vic</a>
      <a href="https://www.linkedin.com/in/hidden-hal" style="display:none">Hidden Hal</a>
      <a href="https://www.linkedin.com/in/cloaked-cal" style="visibility:hidden">Cloaked Cal</a>
      <div>Singapore</div>
    </div>
  </div>
</main>
</body></html>`;

describe('linkedin-newsletter-scan extraction mismatch diagnostic (pure)', () => {
  test('diagnoses zero identifiable profiles while visible profile links exist in main', () => {
    expect(extractionMismatchDiagnostic({ pageNumber: 1, extractedProfileCount: 0, visibleProfileCount: 40 })).toBe(
      'linkedin scan page 1: extracted 0 identifiable profiles while 40 profile links are visible in main; result-card selectors no longer match the rendered LinkedIn layout',
    );
  });

  test('stays silent when identifiable profiles were extracted, even with zero Singapore candidates', () => {
    // A correctly extracted all-non-Singapore page is a success with zero candidates.
    expect(extractionMismatchDiagnostic({ pageNumber: 1, extractedProfileCount: 4, visibleProfileCount: 40 })).toBeNull();
    expect(extractionMismatchDiagnostic({ pageNumber: 2, extractedProfileCount: 0, visibleProfileCount: 0 })).toBeNull();
  });
});

describe('linkedin-newsletter-scan identifiable profile count (pure)', () => {
  test('counts raw identifiable profiles before Singapore filtering', () => {
    expect(identifiableProfileCount([
      { name: 'Amir Rahman', profileUrl: 'https://www.linkedin.com/in/amir-rah', location: 'Kuala Lumpur, Malaysia', headline: null },
      { name: 'No Link', profileUrl: '', location: 'Singapore', headline: null },
      { name: '', profileUrl: 'https://www.linkedin.com/in/no-name', location: 'Singapore', headline: null },
    ])).toBe(1);
  });
});

const ALL_MALAYSIA_SEARCH_PAGE = `<!DOCTYPE html>
<html><head><title>Search | LinkedIn</title></head>
<body>
<main>
  <div>
    <div role="list">
      ${semanticCard('Amir Rahman', 'amir-rahman', 'Property Agent', 'Kuala Lumpur, Malaysia')}
      ${semanticCard('Nurul Ismail', 'nurul-ismail', 'Negotiator', 'Johor Bahru, Malaysia')}
      ${semanticCard('Ken Chong', 'ken-chong', 'Investor', 'Penang, Malaysia')}
    </div>
  </div>
</main>
</body></html>`;

// A genuinely changed layout: visible profile links render in main, but no
// supported result-card selector matches, so nothing is extractable.
const CHANGED_LAYOUT_SEARCH_PAGE = `<!DOCTYPE html>
<html><head><title>Search | LinkedIn</title></head>
<body>
<main>
  <section data-view-name="profile-search-card">
    <a href="https://www.linkedin.com/in/new-layout-one">New Layout One</a>
    <div>Singapore</div>
  </section>
  <section data-view-name="profile-search-card">
    <a href="https://www.linkedin.com/in/new-layout-two">New Layout Two</a>
    <div>Singapore</div>
  </section>
</main>
</body></html>`;

describe('linkedin-newsletter-scan owned browser lifecycle (pure)', () => {
  test('newPage setup failure closes the owned browser once and rethrows without deadlock', async () => {
    let closeCalls = 0;
    const failingLauncher = async (): Promise<Browser> =>
      ({
        process: () => ({ pid: 424242 }),
        newPage: () => Promise.reject(new Error('injected newPage rejection')),
        close: async () => {
          closeCalls += 1;
        },
      }) as unknown as Browser;

    await expect(launchFixtureHarness(failingLauncher)).rejects.toThrow('injected newPage rejection');
    expect(closeCalls).toBe(1);
    expect(ownedBrowserPid).toBeUndefined();
  }, 10000);

  test('LINKEDIN_SCAN_REQUIRE_BROWSER=1 fails loudly when the fixture browser is unavailable', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: {
        ...process.env,
        LINKEDIN_SCAN_REQUIRE_BROWSER: '1',
        TMPDIR: '/nonexistent-scan-cards-tmpdir',
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const exitCode = await child.exited;
    expect(exitCode).not.toBe(0);
  }, 30000);
});

describe.skipIf(!fixtureBrowserAvailable)('linkedin-newsletter-scan diagnostic pipeline (offline Chrome fixture)', () => {
  test('an all-non-Singapore page extracts profiles successfully and does not trip the mismatch diagnostic', async () => {
    const page = await fixturePage();
    await page.setContent(ALL_MALAYSIA_SEARCH_PAGE);

    const snapshots = await page.evaluate(collectLinkedInResultCards);
    const candidates = dedupeSingaporeResultCards(snapshots);
    const extractedProfileCount = identifiableProfileCount(snapshots);
    const visibleProfileCount = await page.evaluate(countVisibleResultProfileLinks);

    expect(candidates).toEqual([]);
    expect(extractedProfileCount).toBe(3);
    expect(visibleProfileCount).toBe(3);
    expect(extractionMismatchDiagnostic({ pageNumber: 1, extractedProfileCount, visibleProfileCount })).toBeNull();
  }, 30000);

  test('a changed layout with visible but unextractable profiles fails diagnostically', async () => {
    const page = await fixturePage();
    await page.setContent(CHANGED_LAYOUT_SEARCH_PAGE);

    const snapshots = await page.evaluate(collectLinkedInResultCards);
    const extractedProfileCount = identifiableProfileCount(snapshots);
    const visibleProfileCount = await page.evaluate(countVisibleResultProfileLinks);

    expect(extractedProfileCount).toBe(0);
    expect(visibleProfileCount).toBe(2);
    expect(await page.evaluate(linkedInResultsReady)).toBe(false);
    expect(extractionMismatchDiagnostic({ pageNumber: 1, extractedProfileCount, visibleProfileCount })).toBe(
      'linkedin scan page 1: extracted 0 identifiable profiles while 2 profile links are visible in main; result-card selectors no longer match the rendered LinkedIn layout',
    );
  }, 30000);
});

describe.skipIf(!fixtureBrowserAvailable)('linkedin-newsletter-scan page readiness and tripwire (offline Chrome fixture)', () => {
  test('counts only genuinely visible profile links inside main', async () => {
    const page = await fixturePage();
    await page.setContent(SEMANTIC_SEARCH_PAGE);

    // 4 visible card anchors + 1 visible bare profile link outside result cards.
    expect(await page.evaluate(countVisibleResultProfileLinks)).toBe(5);

    await page.setContent(HIDDEN_ANCHOR_SEARCH_PAGE);
    // display:none and visibility:hidden anchors are not visible.
    expect(await page.evaluate(countVisibleResultProfileLinks)).toBe(1);
  }, 30000);

  test('readiness requires a visible profile link inside a supported card, or an explicit no-results state', async () => {
    const page = await fixturePage();
    await page.setContent(LOADING_SEARCH_PAGE);
    expect(await page.evaluate(linkedInResultsReady)).toBe(false);

    // Irrelevant li without profile links must not satisfy readiness.
    await page.setContent(IRRELEVANT_LI_SEARCH_PAGE);
    expect(await page.evaluate(linkedInResultsReady)).toBe(false);

    await page.setContent(NO_RESULTS_SEARCH_PAGE);
    expect(await page.evaluate(linkedInResultsReady)).toBe(true);

    await page.setContent(SEMANTIC_SEARCH_PAGE);
    expect(await page.evaluate(linkedInResultsReady)).toBe(true);
  }, 30000);
});

describe.skipIf(!fixtureBrowserAvailable)('linkedin-newsletter-scan result-card extraction (offline Chrome fixture)', () => {
  test('extracts Singapore candidates from semantic div[role="listitem"] result cards', async () => {
    const candidates = await extractCandidates(SEMANTIC_SEARCH_PAGE);

    expect(candidates.map((candidate) => candidate.profileUrl).sort()).toEqual([
      'https://www.linkedin.com/in/alice-teo',
      'https://www.linkedin.com/in/bernard-lim',
      'https://www.linkedin.com/in/catherine-wong',
    ]);
    expect(candidates.find((candidate) => candidate.name === 'Alice Teo')).toMatchObject({
      location: 'Singapore',
      headline: 'Real Estate Agent at PropertyNest',
    });
    // The non-Singapore card and the bare profile link outside result cards
    // must never be extracted.
    expect(candidates.some((candidate) => candidate.name === 'Devi Menon')).toBe(false);
    expect(candidates.some((candidate) => candidate.profileUrl.includes('footer-decoy'))).toBe(false);
  }, 30000);

  test('still extracts the legacy li.reusable-search__result-container layout', async () => {
    const candidates = await extractCandidates(LEGACY_SEARCH_PAGE);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: 'Grace Chan',
      profileUrl: 'https://www.linkedin.com/in/grace-chan',
      location: 'Singapore',
    });
  }, 30000);

  test('deduplicates a card matched by both legacy and semantic selectors', async () => {
    const candidates = await extractCandidates(OVERLAP_SEARCH_PAGE);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].profileUrl).toBe('https://www.linkedin.com/in/james-tan');
  }, 30000);
});
