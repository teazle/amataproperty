import { describe, expect, test } from 'bun:test';

const now = new Date().toISOString();
const listings = Array.from({ length: 1001 }, (_, index) => ({
  id: `listing-${index + 1}`,
  agent_id: `agent-${index + 1}`,
  price: 1_500_000,
  scraped_at: now,
  title: `Listing ${index + 1}`,
  url: `https://example.test/listing-${index + 1}`,
  portal: 'edgeprop',
}));
const agents = Array.from({ length: 1001 }, (_, index) => ({
  id: `agent-${index + 1}`,
  name: `Agent ${index + 1}`,
  phone: `9${String(index + 1).padStart(7, '0')}`,
}));
const outreachRows = [
  ...Array.from({ length: 1000 }, (_, index) => ({
    agent_id: `unrelated-${index + 1}`,
    listing_id: `listing-${index + 1}`,
    status: 'sent',
  })),
  { agent_id: 'agent-1001', listing_id: 'listing-1001', status: 'sent' },
];
const suppressionRows = [{ recipient_key: '+6590001000' }];
const upsertCalls: Array<{ rows: unknown; options: unknown }> = [];

function pageRows(table: string, filters: { ids?: string[]; status?: string }, from: number, to: number) {
  const rows = table === 'listings'
    ? listings
    : table === 'agents'
      ? agents.filter((agent) => !filters.ids || filters.ids.includes(agent.id))
      : table === 'outreach'
        ? outreachRows.filter((row) =>
          (!filters.ids || filters.ids.includes(row.listing_id) || filters.ids.includes(row.agent_id))
          && (!filters.status || row.status === filters.status),
        )
        : table === 'newsletter_suppressions'
          ? suppressionRows.filter((row) => !filters.ids || filters.ids.includes(row.recipient_key))
        : [];
  return { data: rows.slice(from, to + 1), error: null };
}

function database() {
  return {
    from(table: string) {
      const filters: { ids?: string[]; status?: string } = {};
      const query = {
        select: () => query,
        gte: () => query,
        lte: () => query,
        eq: (column: string, value: string) => {
          if (column === 'status') filters.status = value;
          return query;
        },
        in: (_column: string, values: string[]) => {
          filters.ids = values;
          return query;
        },
        order: () => query,
        range: async (from: number, to: number) => pageRows(table, filters, from, to),
        upsert: (rows: unknown, options: unknown) => ({
          select: async () => {
            upsertCalls.push({ rows, options });
            return { data: rows, error: null };
          },
        }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(pageRows(table, filters, 0, 999)).then(resolve, reject),
      };
      return query;
    },
  };
}

const { runMatchingJob } = await import('../src/jobs/match');

describe('matcher pagination', () => {
  test('keeps an owner beyond the first agent page while reading a duplicate guard beyond the first outreach page', async () => {
    const result = await runMatchingJob(undefined, {}, { matcherDatabase: database() as never });

    expect(result).toMatchObject({ success: true, stats: { listingsFound: 1001, agentsFound: 1001, outreachCreated: 0, previewMessages: 999 } });
    expect(result.previews).not.toContainEqual(expect.objectContaining({ listingId: 'listing-1000' }));
    expect(result.previews).not.toContainEqual(expect.objectContaining({ listingId: 'listing-1001' }));
  });

  test('prepares selected rows through the database uniqueness contract', async () => {
    upsertCalls.splice(0);
    const result = await runMatchingJob(undefined, { confirmedListingIds: ['listing-1'] }, { matcherDatabase: database() as never });

    expect(result.stats).toMatchObject({ outreachCreated: 1, messagesQueued: 1, previewMessages: undefined });
    expect(upsertCalls).toEqual([{
      rows: [expect.objectContaining({ agent_id: 'agent-1', listing_id: 'listing-1' })],
      options: { ignoreDuplicates: true, onConflict: 'agent_id,listing_id' },
    }]);
  });
});
