import { chromium } from 'patchright';
import {
  readEdgePropListing,
  validateEdgePropListingUrl,
} from '../src/lib/scraper/edgeprop-listing-reader';

const CHALLENGE_EXIT_CODE = 78;

async function main(): Promise<number> {
  const configuredUrl = process.env.EP_LISTING_URL;
  if (!configuredUrl) {
    console.error('EP_LISTING_URL is required');
    return 64;
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    const url = validateEdgePropListingUrl(configuredUrl);
    browser = await chromium.launch({
      channel: 'chrome',
      headless: process.env.EP_LISTING_HEADLESS !== 'false',
      timeout: 15_000,
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(30_000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const result = await readEdgePropListing(page);
    if (result.status === 'challenge') {
      console.error('EdgeProp challenge page detected');
      return CHALLENGE_EXIT_CODE;
    }
    if (result.status === 'empty') {
      console.error('EdgeProp listing did not expose a semantic title and price');
      return 1;
    }

    console.log(JSON.stringify({ title: result.title, price: result.price, rawPrice: result.rawPrice }));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

main().then((code) => {
  process.exitCode = code;
});
