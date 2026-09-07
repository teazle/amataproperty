import { describe, expect, test } from 'bun:test';
import {
  formatListingRowsTouched,
  getListingRowsTouched,
} from './smartprop-daily-report';

describe('daily report listing touch preservation', () => {
  test('counts each listing portal within the report scraped_at window', async () => {
    const calls: Array<{ portal?: string; column?: string; value?: string }> = [];
    const counts = { edgeprop: 7, propertyguru: 3 };
    const createQuery = () => {
      let portal: keyof typeof counts;
      const query = {
        select(fields: string, options: { count: 'exact'; head: true }) {
          expect(fields).toBe('id');
          expect(options).toEqual({ count: 'exact', head: true });
          return query;
        },
        eq(column: string, value: string) {
          calls.push({ column, value });
          portal = value as keyof typeof counts;
          return query;
        },
        gte(column: string, value: string) {
          calls.push({ column, value });
          return query;
        },
        lt(column: string, value: string) {
          calls.push({ column, value });
          return Promise.resolve({ count: counts[portal], error: null });
        },
      };
      return query;
    };

    const listingRowsTouched = await getListingRowsTouched(
      { from: (table: string) => {
        expect(table).toBe('listings');
        return createQuery();
      } },
      { startUtc: '2026-09-07T16:00:00.000Z', endUtc: '2026-09-08T16:00:00.000Z' },
    );

    expect(listingRowsTouched).toEqual([
      { portal: 'edgeprop', count: 7 },
      { portal: 'propertyguru', count: 3 },
    ]);
    expect(calls).toEqual([
      { column: 'portal', value: 'edgeprop' },
      { column: 'scraped_at', value: '2026-09-07T16:00:00.000Z' },
      { column: 'scraped_at', value: '2026-09-08T16:00:00.000Z' },
      { column: 'portal', value: 'propertyguru' },
      { column: 'scraped_at', value: '2026-09-07T16:00:00.000Z' },
      { column: 'scraped_at', value: '2026-09-08T16:00:00.000Z' },
    ]);
  });

  test('formats per-portal touched rows separately from processed attempts', () => {
    expect(formatListingRowsTouched({
      totalJobs: 3,
      statuses: { completed: 3 },
      listingsProcessed: 11,
      listingRowsTouched: [
        { portal: 'edgeprop', count: 7 },
        { portal: 'propertyguru', count: 3 },
      ],
      byPlatform: [
        { platform: 'edgeprop', jobs: 2, listings: 8, statuses: { completed: 2 }, errors: [] },
        { platform: 'propertyguru', jobs: 1, listings: 3, statuses: { completed: 1 }, errors: ['timeout'] },
      ],
    })).toEqual([
      '- EdgeProp listing jobs: 8 processed/upsert attempts; 7 unique rows touched by scraped_at; jobs=2; statuses=completed 2; errors=0',
      '- PropertyGuru listing jobs: 3 processed/upsert attempts; 3 unique rows touched by scraped_at; jobs=1; statuses=completed 1; errors=1',
      'Listing scrapers total: 3 jobs; statuses=completed 3; processed/upsert attempts=11; unique rows touched by scraped_at=10',
    ]);
  });
});
