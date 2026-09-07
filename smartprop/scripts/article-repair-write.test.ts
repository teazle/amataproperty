import { expect, test } from 'bun:test';
import { PostgrestClient } from '@supabase/postgrest-js';
import { conditionalArticleRepair } from './article-repair-write';

// Removing either identity predicate or the version predicate must prevent a write.
test('updates exactly one unchanged content row through the real PostgREST client', async () => {
  const row = { id: 'content-1', article_id: 'article-1', updated_at: '2026-09-07T08:00:00+00:00', text_content: 'old' };
  const client = new PostgrestClient('https://fixture.invalid/rest/v1', {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (init?.method !== 'PATCH' || url.pathname !== '/rest/v1/article_full_content' ||
        url.searchParams.get('id') !== 'eq.content-1' ||
        url.searchParams.get('article_id') !== 'eq.article-1' ||
        url.searchParams.get('updated_at') !== 'eq.2026-09-07T08:00:00+00:00') {
        return new Response(JSON.stringify({ message: 'unsafe predicate' }), { status: 400 });
      }
      Object.assign(row, JSON.parse(String(init.body)));
      return new Response(JSON.stringify([row]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const result = await conditionalArticleRepair(client, row, { text_content: 'new editorial body' });
  expect(result.status).toBe('updated');
  expect(row.text_content).toBe('new editorial body');
  expect(result.row?.article_id).toBe('article-1');
});

test('an optimistic concurrency miss is a skip, never an upsert or retry', async () => {
  let requests = 0;
  const client = new PostgrestClient('https://fixture.invalid/rest/v1', {
    fetch: async () => {
      requests++;
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const result = await conditionalArticleRepair(client, { id: 'content-1', article_id: 'article-1', updated_at: 'old-version' }, { text_content: 'new' });
  expect(result.status).toBe('concurrent-change');
  expect(requests).toBe(1);
});

test('database errors propagate without retry or overwrite', async () => {
  let requests = 0;
  const client = new PostgrestClient('https://fixture.invalid/rest/v1', {
    fetch: async () => {
      requests++;
      return new Response(JSON.stringify({ message: 'write refused' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    },
  });
  await expect(conditionalArticleRepair(client, { id: 'content-1', article_id: 'article-1', updated_at: 'version' }, { text_content: 'new' })).rejects.toThrow('write refused');
  expect(requests).toBe(1);
});
