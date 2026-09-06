import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type LaunchOptions,
  type Page,
} from 'playwright';

import { validateArticleContent } from '../src/lib/scraper/article-content-validation';

export type BrowserAcceptanceFixture = {
  id: string;
  path: string;
};

export type BrowserAcceptanceOptions = {
  browserType?: BrowserType;
  launchOptions?: Pick<LaunchOptions, 'channel' | 'executablePath'>;
  launchTimeoutMs?: number;
  navigationTimeoutMs?: number;
  actionTimeoutMs?: number;
};

export type BrowserAcceptanceStatus = 'valid' | 'blocked' | 'empty' | 'error';

export type BrowserAcceptanceResult = {
  id: string;
  sourcePath: string;
  status: BrowserAcceptanceStatus;
  validationReason: 'valid' | 'challenge' | 'empty' | 'not_article' | 'error';
  page: {
    url: string;
    title: string;
    textExcerpt: string;
    textLength: number;
    htmlLength: number;
  };
  title: {
    value: string;
    selector: 'h1' | 'document.title' | null;
    length: number;
  };
  body: {
    selector: string | null;
    textExcerpt: string;
    textLength: number;
    htmlLength: number;
    paragraphCount: number;
  };
  timing: {
    startedAt: string;
    durationMs: number;
  };
  error?: string;
};

type RenderedArticleEvidence = {
  pageTitle: string;
  pageText: string;
  pageHtml: string;
  articleTitle: string;
  bodySelector: string | null;
  bodyText: string;
  bodyHtml: string;
  paragraphCount: number;
};

const DEFAULT_LAUNCH_TIMEOUT_MS = 15_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 10_000;
const DEFAULT_ACTION_TIMEOUT_MS = 5_000;

function excerpt(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function assertLocalFixturePaths(fixtures: BrowserAcceptanceFixture[]) {
  for (const fixture of fixtures) {
    const candidate = fixture.path.trim();
    if (!candidate || /^[a-z][a-z\d+.-]*:/i.test(candidate) || candidate.startsWith('//')) {
      throw new Error(`Local fixture paths only; refused input for ${fixture.id}: ${fixture.path}`);
    }
  }
}

function emptyResult(
  fixture: BrowserAcceptanceFixture,
  sourcePath: string,
  startedAt: string,
  startedMs: number,
  error: unknown,
): BrowserAcceptanceResult {
  return {
    id: fixture.id,
    sourcePath,
    status: 'error',
    validationReason: 'error',
    page: {
      url: pathToFileURL(sourcePath).href,
      title: '',
      textExcerpt: '',
      textLength: 0,
      htmlLength: 0,
    },
    title: { value: '', selector: null, length: 0 },
    body: {
      selector: null,
      textExcerpt: '',
      textLength: 0,
      htmlLength: 0,
      paragraphCount: 0,
    },
    timing: {
      startedAt,
      durationMs: Math.max(0, performance.now() - startedMs),
    },
    error: error instanceof Error ? error.message : String(error),
  };
}

async function extractRenderedArticle(page: Page): Promise<RenderedArticleEvidence> {
  return page.evaluate(() => {
    const articleTitle = document.querySelector('h1')?.textContent?.trim() || '';
    const contentSelectors = [
      '.detail-content',
      '[class*="detail-content"]',
      '.article-detail.left-section',
      '[class*="article-detail"][class*="left-section"]',
      '.article-content',
      '.post-content',
      '.article-body',
      '.post-body',
      'article',
      '.story-content',
      '.news-content',
      '.content',
      '[class*="content"]',
    ];

    let contentElements: Element[] = [];
    let bodySelector: string | null = null;

    for (const selector of contentSelectors) {
      const substantialElements = Array.from(document.querySelectorAll(selector)).filter((element) => {
        const text = element.textContent || '';
        return text.length > 200 &&
          !text.includes('!function') &&
          !text.includes('fbq(') &&
          !text.includes('obApi(') &&
          !text.includes('vgo(') &&
          !text.includes('window._peq');
      });

      if (substantialElements.length > 0) {
        contentElements = substantialElements;
        bodySelector = selector;
        break;
      }
    }

    if (contentElements.length === 0) {
      contentElements = Array.from(document.querySelectorAll('div')).filter((element) => {
        const text = element.textContent || '';
        return text.length > 100 &&
          !element.querySelector('h1, h2, h3') &&
          !element.querySelector('button') &&
          !element.querySelector('input') &&
          !element.querySelector('script') &&
          !element.querySelector('style') &&
          !text.includes('Subscribe') &&
          !text.includes('!function') &&
          !text.includes('fbq(') &&
          !text.includes('obApi(') &&
          !text.includes('vgo(') &&
          !text.includes('window._peq') &&
          !text.includes('Check out our insightful property news') &&
          !text.includes('We also provide fruitful information') &&
          element.children.length === 0;
      });
      if (contentElements.length > 0) bodySelector = 'div:leaf-fallback';
    }

    const rawParagraphs: string[] = [];
    const splitTextIntoParagraphs = (text: string) => {
      const normalized = text
        .replace(/\s+/g, ' ')
        .replace(/([.!?])([A-Z])/g, '$1 $2')
        .trim();
      const sentences = normalized.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim().length > 20);
      return sentences.length > 1
        ? sentences.map((sentence) => sentence.trim())
        : normalized.length > 50 ? [normalized] : [];
    };

    for (const contentElement of contentElements) {
      const paragraphTexts = Array.from(contentElement.querySelectorAll('p'))
        .map((paragraph) => paragraph.textContent?.trim() || '')
        .filter((text) => text.length > 20);
      const containerText = contentElement.textContent?.trim() || '';
      const paragraphTextLength = paragraphTexts.join(' ').length;

      if (paragraphTexts.length > 1 && paragraphTextLength > containerText.length * 0.5) {
        rawParagraphs.push(...paragraphTexts);
      } else {
        rawParagraphs.push(...splitTextIntoParagraphs(containerText));
      }
    }

    const paragraphs = rawParagraphs
      .filter((paragraph) => {
        const cleanParagraph = paragraph.trim();
        const lowerParagraph = cleanParagraph.toLowerCase();
        return cleanParagraph.length > 20 &&
          !cleanParagraph.includes('!function') &&
          !cleanParagraph.includes('fbq(') &&
          !cleanParagraph.includes('obApi(') &&
          !cleanParagraph.includes('vgo(') &&
          !cleanParagraph.includes('window._peq') &&
          !cleanParagraph.includes('in_article_inread_ad') &&
          !cleanParagraph.includes('Banner_Article') &&
          !cleanParagraph.includes('<img height="1"') &&
          !cleanParagraph.includes('Check out our insightful property news') &&
          !cleanParagraph.includes('We also provide fruitful information') &&
          !cleanParagraph.includes('Click into any listing to check out the new AI Redesign tool') &&
          !cleanParagraph.includes('Make data-driven property decisions with our easy-to-use free and paid tools') &&
          !lowerParagraph.includes('facebook sharing button') &&
          !lowerParagraph.includes('twitter sharing button') &&
          !lowerParagraph.includes('linkedin sharing button') &&
          !lowerParagraph.includes('messenger sharing button') &&
          !lowerParagraph.includes('whatsapp sharing button') &&
          !lowerParagraph.includes('email sharing button') &&
          !lowerParagraph.includes('wechat sharing button');
      })
      .filter((paragraph, index, allParagraphs) => allParagraphs.indexOf(paragraph) === index);

    return {
      pageTitle: document.title.trim(),
      pageText: document.body?.innerText || '',
      pageHtml: document.documentElement?.outerHTML || '',
      articleTitle,
      bodySelector,
      bodyText: paragraphs.join('\n\n'),
      bodyHtml: contentElements.map((element) => element.outerHTML).join('\n'),
      paragraphCount: paragraphs.length,
    };
  });
}

function classifyRenderedFixture(
  fixture: BrowserAcceptanceFixture,
  sourcePath: string,
  pageUrl: string,
  evidence: RenderedArticleEvidence,
  startedAt: string,
  startedMs: number,
): BrowserAcceptanceResult {
  const title = evidence.articleTitle || evidence.pageTitle;
  const pageValidation = validateArticleContent({
    title,
    text: evidence.pageText,
    html: evidence.pageHtml,
  });
  const bodyValidation = validateArticleContent({
    title,
    text: evidence.bodyText,
    html: evidence.bodyHtml,
  });
  const validation = !pageValidation.valid && pageValidation.reason === 'challenge'
    ? pageValidation
    : bodyValidation;
  const status: BrowserAcceptanceStatus = validation.valid
    ? 'valid'
    : validation.reason === 'challenge' ? 'blocked' : 'empty';

  return {
    id: fixture.id,
    sourcePath,
    status,
    validationReason: validation.valid ? 'valid' : validation.reason,
    page: {
      url: pageUrl,
      title: evidence.pageTitle,
      textExcerpt: excerpt(evidence.pageText),
      textLength: evidence.pageText.length,
      htmlLength: evidence.pageHtml.length,
    },
    title: {
      value: title,
      selector: evidence.articleTitle ? 'h1' : evidence.pageTitle ? 'document.title' : null,
      length: title.length,
    },
    body: {
      selector: evidence.bodySelector,
      textExcerpt: excerpt(evidence.bodyText),
      textLength: evidence.bodyText.length,
      htmlLength: evidence.bodyHtml.length,
      paragraphCount: evidence.paragraphCount,
    },
    timing: {
      startedAt,
      durationMs: Math.max(0, performance.now() - startedMs),
    },
  };
}

export async function runBrowserAcceptance(
  fixtures: BrowserAcceptanceFixture[],
  options: BrowserAcceptanceOptions = {},
): Promise<BrowserAcceptanceResult[]> {
  assertLocalFixturePaths(fixtures);
  if (fixtures.length === 0) return [];

  const browserType = options.browserType ?? chromium;
  const launchTimeoutMs = options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  const navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
  const actionTimeoutMs = options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  try {
    browser = await browserType.launch({
      headless: true,
      ...options.launchOptions,
      timeout: launchTimeoutMs,
    });
    context = await browser.newContext();
    context.setDefaultTimeout(actionTimeoutMs);
    context.setDefaultNavigationTimeout(navigationTimeoutMs);
    page = await context.newPage();

    const results: BrowserAcceptanceResult[] = [];
    for (const fixture of fixtures) {
      const sourcePath = resolve(fixture.path);
      const fixtureUrl = pathToFileURL(sourcePath).href;
      const startedAt = new Date().toISOString();
      const startedMs = performance.now();

      try {
        await page.goto(fixtureUrl, {
          waitUntil: 'domcontentloaded',
          timeout: navigationTimeoutMs,
        });
        const evidence = await extractRenderedArticle(page);
        results.push(classifyRenderedFixture(
          fixture,
          sourcePath,
          page.url(),
          evidence,
          startedAt,
          startedMs,
        ));
      } catch (error) {
        results.push(emptyResult(fixture, sourcePath, startedAt, startedMs, error));
      }
    }

    return results;
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

async function createDefaultLocalFixtures(): Promise<{
  directory: string;
  fixtures: BrowserAcceptanceFixture[];
}> {
  const directory = await mkdtemp(`${tmpdir()}/smartprop-browser-acceptance-`);
  const articlePath = resolve(directory, 'synthetic-article.html');
  const challengePath = resolve(directory, 'synthetic-challenge.html');
  const editorialPath = resolve(directory, 'synthetic-editorial-cloudflare.html');

  await Promise.all([
    writeFile(articlePath, `<!doctype html><html><head><title>Local article fixture</title></head><body>
      <article><h1>Local housing market update</h1><div class="detail-content">
      <p>Transaction activity improved as buyers returned to viewings with clearer budgets and a wider selection of homes across the market.</p>
      <p>Analysts said correctly priced properties continued to attract interest while sellers used recent comparable sales to guide decisions.</p>
      </div></article></body></html>`),
    writeFile(challengePath, `<!doctype html><html><head><title>www.edgeprop.sg</title></head><body>
      <main class="challenge-content"><h1>www.edgeprop.sg</h1><h2>Performing security verification</h2>
      <p>This website uses a security service to protect against malicious bots. This page is displayed while the website verifies you are not a bot.</p>
      <p>Verification successful. Waiting for www.edgeprop.sg to respond.</p>
      <span id="challenge-error-text">Enable JavaScript and cookies to continue</span></main></body></html>`),
    writeFile(editorialPath, `<!doctype html><html><head><title>Local editorial fixture</title></head><body>
      <article><h1>Why Cloudflare verification can appear</h1><div class="detail-content">
      <p>Cloudflare security verification can appear when a visitor changes networks, according to researchers reviewing property search traffic.</p>
      <p>The publisher said this verification protects readers without changing the editorial article itself or preventing ordinary access.</p>
      </div></article></body></html>`),
  ]);

  return {
    directory,
    fixtures: [
      { id: 'synthetic-article', path: articlePath },
      { id: 'synthetic-challenge', path: challengePath },
      { id: 'synthetic-editorial-cloudflare', path: editorialPath },
    ],
  };
}

async function main() {
  const argumentsAsPaths = process.argv.slice(2);
  let generatedDirectory: string | undefined;
  let fixtures = argumentsAsPaths.map((path, index) => ({
    id: basename(path) || `fixture-${index + 1}`,
    path,
  }));

  if (fixtures.length === 0) {
    const defaults = await createDefaultLocalFixtures();
    generatedDirectory = defaults.directory;
    fixtures = defaults.fixtures;
  }

  try {
    const configuredChannel = process.env.BROWSER_ACCEPTANCE_CHANNEL?.trim();
    const samples = await runBrowserAcceptance(fixtures, {
      launchOptions: configuredChannel ? { channel: configuredChannel } : undefined,
    });
    console.log(JSON.stringify({
      mode: 'provider-free-local-fixtures',
      liveAntiBotAccessProven: false,
      samples,
    }, null, 2));
    if (samples.some((sample) => sample.status === 'error')) process.exitCode = 1;
  } finally {
    if (generatedDirectory) {
      await rm(generatedDirectory, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  await main();
}
