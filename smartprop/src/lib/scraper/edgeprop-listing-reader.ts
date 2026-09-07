export interface EdgePropListingLocator {
  count(): Promise<number>;
  textContent(options?: { timeout?: number }): Promise<string | null>;
}

export interface EdgePropListingPage {
  title(): Promise<string>;
  textContent(selector: string): Promise<string | null>;
  locator(selector: string): { first(): EdgePropListingLocator };
  getByText(text: RegExp): { all(): Promise<EdgePropListingLocator[]> };
}

export type EdgePropListingReadResult =
  | { status: 'ok'; title: string; price: number; rawPrice: string }
  | { status: 'challenge' }
  | { status: 'empty' };

/** Matches the current EdgeProp worker's numeric price parsing behavior. */
export function parseEdgePropPrice(priceStr: string): number | undefined {
  if (!priceStr) return undefined;

  const cleaned = priceStr.replace(/[$,\s]/g, '');

  if (cleaned.toLowerCase().includes('m')) {
    const num = parseFloat(cleaned.replace(/m/i, ''));
    return Math.round(num * 1_000_000);
  }

  if (cleaned.toLowerCase().includes('k')) {
    const num = parseFloat(cleaned.replace(/k/i, ''));
    return Math.round(num * 1_000);
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

export function validateEdgePropListingUrl(value: string): string {
  const url = new URL(value);
  const isListingRoute = /^\/listing\/[^/]+/.test(url.pathname);

  if (url.protocol !== 'https:' || url.hostname !== 'www.edgeprop.sg' || url.port || !isListingRoute) {
    throw new Error('EP_LISTING_URL must be an HTTPS www.edgeprop.sg listing route');
  }

  return url.toString();
}

function isChallengePage(title: string, body: string): boolean {
  const hasActualError = body.includes('Bad gateway') ||
    body.includes('Error code 502') ||
    body.includes('Error code 503') ||
    body.includes('Pardon Our Interruption') ||
    body.includes('Verify you are human') ||
    body.includes('Enable JavaScript and cookies to continue') ||
    (body.includes('Just a moment') && body.length < 500) ||
    (title.includes('Just a moment') && body.length < 500);
  const hasListingContent = body.includes('Bed') ||
    body.includes('Bath') ||
    body.includes('sqft') ||
    body.includes('Property Type') ||
    body.includes('District') ||
    body.includes('Bedrooms') ||
    body.includes('Bathrooms') ||
    body.length > 10_000;

  return hasActualError && !hasListingContent;
}

async function readFirstText(page: EdgePropListingPage, selector: string): Promise<string> {
  const locator = page.locator(selector).first();
  if (await locator.count() === 0) return '';
  return (await locator.textContent({ timeout: 2_000 }) || '').trim();
}

/**
 * Reads title and price only. It deliberately has no navigation, interaction,
 * persistence, authentication, or browser-launch responsibilities.
 */
export async function readEdgePropListing(page: EdgePropListingPage): Promise<EdgePropListingReadResult> {
  const [pageTitle, body] = await Promise.all([
    page.title(),
    page.textContent('body'),
  ]);
  const normalizedBody = body || '';

  if (isChallengePage(pageTitle || '', normalizedBody)) return { status: 'challenge' };

  const title = await readFirstText(page, 'h1') || (pageTitle || '').trim();
  const priceTexts = await page.getByText(/\$\s*[\d,]+/).all();
  const priceElement = priceTexts.length > 1 ? priceTexts[1] : priceTexts[0];
  const rawPrice = priceElement ? (await priceElement.textContent({ timeout: 1_000 }) || '') : '';
  const price = rawPrice ? parseEdgePropPrice(rawPrice) : undefined;

  if (!title || price === undefined || title === 'www.edgeprop.sg') return { status: 'empty' };

  return { status: 'ok', title, price, rawPrice };
}
