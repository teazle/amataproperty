import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

const calls: Array<{ method: string; value?: unknown }> = [];

mock.module('@/workers/supa', () => ({
  getSupabaseClient: () => ({
    from: () => ({
      select: (_columns: string, options: unknown) => {
        calls.push({ method: 'select', value: options });
        return {
          order: () => ({
            range: async (from: number, to: number) => {
              calls.push({ method: 'range', value: [from, to] });
              return { data: [{ id: 'outreach-51', status: 'queued' }], error: null, count: 151 };
            },
          }),
          eq: () => ({
            order: () => ({ range: async () => ({ data: [], error: null, count: 0 }) }),
          }),
        };
      },
    }),
  }),
}));

const { GET } = await import('../src/app/api/admin/outreach/route');

beforeEach(() => calls.splice(0));

describe('admin outreach pagination', () => {
  test('reads the requested server page and reports the full total', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/outreach?page=2&limit=50'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      { method: 'select', value: { count: 'exact' } },
      { method: 'range', value: [50, 99] },
    ]);
    expect(body.pagination).toEqual({ page: 2, limit: 50, total: 151, totalPages: 4 });
  });
});
