import { beforeEach, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';

const calls: Array<[number | undefined, Record<string, unknown>]> = [];

const { createMatcherPostHandler } = await import('../src/lib/matcher/job-handlers');
const POST = createMatcherPostHandler(async (limit, options) => {
  calls.push([limit, options]);
  return {
    success: true,
    message: 'ok',
    stats: {
      listingsFound: 0,
      agentsFound: 0,
      outreachCreated: 0,
      messagesProcessed: 0,
      messagesSent: 0,
      messagesFailed: 0,
    },
  };
});

beforeEach(() => calls.splice(0));

describe('matcher API confirmation boundary', () => {
  test('defaults to a read-only preview', async () => {
    const response = await POST(new NextRequest('http://localhost/api/jobs/match', { method: 'POST', body: '{}' }));

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('lockKey');
    expect(calls).toEqual([[undefined, { confirmedListingIds: undefined }]]);
  });

  test('prepares rows only after explicit confirmation and selected ids', async () => {
    const response = await POST(new NextRequest('http://localhost/api/jobs/match', {
      method: 'POST',
      body: JSON.stringify({ confirmed: true, confirmedListingIds: ['listing-a', 'listing-b'] }),
    }));

    expect(response.status).toBe(200);
    expect(calls).toEqual([[undefined, { confirmedListingIds: ['listing-a', 'listing-b'] }]]);
  });

  test('refuses an unselected confirmation', async () => {
    const response = await POST(new NextRequest('http://localhost/api/jobs/match', {
      method: 'POST',
      body: JSON.stringify({ confirmed: true, confirmedListingIds: [] }),
    }));

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});
