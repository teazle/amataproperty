import { expect, test } from 'bun:test';

import { lookupCustomerSuppression } from '../src/lib/wa/customer-suppression';

function client(data: unknown, error: { message: string } | null = null) {
  const calls: Array<{ table: string; column: string; recipient: string; limit: number }> = [];
  return {
    calls,
    db: {
      from: (table: 'newsletter_suppressions') => ({
        select: (column: 'recipient_key') => ({
          eq: (_field: 'recipient_key', recipient: string) => ({
            limit: async (limit: 1) => {
              calls.push({ table, column, recipient, limit });
              return { data, error };
            },
          }),
        }),
      }),
    },
  };
}

test('looks up the persisted STOP key using the shared E.164 normalization', async () => {
  const fixture = client([{ recipient_key: '+6591051399' }]);

  expect(await lookupCustomerSuppression('9105 1399@c.us', fixture.db)).toBe(true);
  expect(fixture.calls).toEqual([
    { table: 'newsletter_suppressions', column: 'recipient_key', recipient: '+6591051399', limit: 1 },
  ]);
});

test('treats an empty suppression result as sendable and malformed or failed reads as errors', async () => {
  expect(await lookupCustomerSuppression('+6591051399', client([]).db)).toBe(false);
  await expect(lookupCustomerSuppression('+6591051399', client({ recipient_key: '+6591051399' }).db)).rejects.toThrow('malformed');
  await expect(lookupCustomerSuppression('+6591051399', client([], { message: 'database unavailable' }).db)).rejects.toThrow('database unavailable');
});
