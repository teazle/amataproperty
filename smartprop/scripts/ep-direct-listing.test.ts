import { describe, expect, test } from 'bun:test';
import {
  parseEdgePropPrice,
  readEdgePropListing,
  validateEdgePropListingUrl,
  type EdgePropListingPage,
} from '../src/lib/scraper/edgeprop-listing-reader';

function pageFixture({
  title = '1,485 sqft condominium for sale',
  body = '4 Beds 3 Baths 1,485 sqft',
  heading = 'Daintree Residence',
  prices = ['$1,000', '$2,280,000'],
}: {
  title?: string;
  body?: string;
  heading?: string;
  prices?: string[];
} = {}): EdgePropListingPage {
  return {
    title: async () => title,
    textContent: async (selector) => selector === 'body' ? body : null,
    locator: () => ({
      first: () => ({
        count: async () => 1,
        textContent: async () => heading,
      }),
    }),
    getByText: () => ({
      all: async () => prices.map((value) => ({
        count: async () => 1,
        textContent: async () => value,
      })),
    }),
  };
}

describe('EdgeProp direct listing reader', () => {
  test('returns the listing h1 and the worker-compatible selected price', async () => {
    await expect(readEdgePropListing(pageFixture())).resolves.toEqual({
      status: 'ok',
      title: 'Daintree Residence',
      price: 2_280_000,
      rawPrice: '$2,280,000',
    });
  });

  test('preserves the worker price parser for million and thousand shorthand', () => {
    expect(parseEdgePropPrice('$1.5m')).toBe(1_500_000);
    expect(parseEdgePropPrice('$850k')).toBe(850_000);
    expect(parseEdgePropPrice('not priced')).toBeUndefined();
  });

  test('classifies a short EdgeProp verification page as challenge instead of a listing', async () => {
    await expect(readEdgePropListing(pageFixture({
      title: 'Just a moment...',
      heading: '',
      body: 'Verify you are human. Enable JavaScript and cookies to continue.',
      prices: [],
    }))).resolves.toEqual({ status: 'challenge' });
  });

  test('rejects non-HTTPS, non-EdgeProp, and non-listing probe URLs', () => {
    expect(() => validateEdgePropListingUrl('http://www.edgeprop.sg/listing/test')).toThrow();
    expect(() => validateEdgePropListingUrl('https://edgeprop.sg/listing/test')).toThrow();
    expect(() => validateEdgePropListingUrl('https://www.edgeprop.sg/property-news/test')).toThrow();
    expect(validateEdgePropListingUrl('https://www.edgeprop.sg/listing/daintree-residence-123')).toBe(
      'https://www.edgeprop.sg/listing/daintree-residence-123',
    );
  });
});
