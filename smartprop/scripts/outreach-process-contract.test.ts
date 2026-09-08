import { beforeEach, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';

const calls: Array<[number | undefined, number | undefined, Record<string, unknown>]> = [];

const { createOutreachProcessHandler } = await import('../src/lib/matcher/job-handlers');
const POST = createOutreachProcessHandler(async (limit, delay, options) => {
  calls.push([limit, delay, options]);
  return { processed: 1, sent: 1, failed: 0 };
});

beforeEach(() => calls.splice(0));

describe('selected outreach processing contract', () => {
  test('passes only explicitly confirmed outreach ids to the claim-backed processor', async () => {
    const response = await POST(new NextRequest('http://localhost/api/outreach/process', {
      method: 'POST',
      body: JSON.stringify({ confirmed: true, confirmedOutreachIds: ['outreach-a', 'outreach-b'] }),
    }));

    expect(response.status).toBe(200);
    expect(calls).toEqual([[2, undefined, { selectedOutreachIds: ['outreach-a', 'outreach-b'] }]]);
  });

  test('rejects selected rows without an explicit confirmation', async () => {
    const response = await POST(new NextRequest('http://localhost/api/outreach/process', {
      method: 'POST',
      body: JSON.stringify({ confirmedOutreachIds: ['outreach-a'] }),
    }));

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});
