import { describe, expect, test } from 'bun:test';
const matcher = await import('../src/jobs/matcher-selection').catch(() => null);

const NOW = new Date('2026-09-08T04:00:00.000Z');

describe('recently refreshed matcher selection', () => {
  test('selects each recently refreshed listing only for its own active agent', () => {
    expect(matcher).not.toBeNull();
    const { selectRecentListingAgentOutreach } = matcher!;
    const selected = selectRecentListingAgentOutreach({
      now: NOW,
      listings: [
        { id: 'fresh', agent_id: 'agent-owner', price: 1_850_000, scraped_at: '2026-09-08T03:30:00.000Z', title: 'Fresh listing', url: 'https://example.test/fresh' },
        { id: 'stale', agent_id: 'agent-owner', price: 1_850_000, scraped_at: '2026-09-07T03:59:59.000Z', title: 'Stale listing', url: 'https://example.test/stale' },
        { id: 'bad-price', agent_id: 'agent-owner', price: 950_000, scraped_at: '2026-09-08T03:30:00.000Z', title: 'Outside price range', url: 'https://example.test/bad-price' },
        { id: 'missing-agent', agent_id: null, price: 1_850_000, scraped_at: '2026-09-08T03:30:00.000Z', title: 'Missing agent', url: 'https://example.test/missing-agent' },
      ],
      agents: [
        { id: 'agent-owner', name: 'Owner Agent', phone: '91234567' },
        { id: 'agent-other', name: 'Other Agent', phone: '98765432' },
      ],
      existingOutreach: [],
      optedOutAgentIds: [],
    });

    expect(selected).toEqual([
      expect.objectContaining({ listing_id: 'fresh', agent_id: 'agent-owner' }),
    ]);
  });

  test('excludes opted-out agents and every existing agent-listing pair', () => {
    expect(matcher).not.toBeNull();
    const { selectRecentListingAgentOutreach } = matcher!;
    const listings = [
      { id: 'opted-out', agent_id: 'agent-opted-out', price: 1_850_000, scraped_at: '2026-09-08T03:30:00.000Z', title: 'Suppressed', url: 'https://example.test/suppressed' },
      { id: 'duplicate', agent_id: 'agent-duplicate', price: 1_850_000, scraped_at: '2026-09-08T03:30:00.000Z', title: 'Already prepared', url: 'https://example.test/duplicate' },
    ];

    const selected = selectRecentListingAgentOutreach({
      now: NOW,
      listings,
      agents: [
        { id: 'agent-opted-out', name: 'Opted Out', phone: '91111111' },
        { id: 'agent-duplicate', name: 'Duplicate', phone: '92222222' },
      ],
      existingOutreach: [{ agent_id: 'agent-duplicate', listing_id: 'duplicate', status: 'failed' }],
      optedOutAgentIds: ['agent-opted-out'],
    });

    expect(selected).toEqual([]);
  });

  test('uses preview as the default and makes no rows or sends until a selected confirmation', () => {
    expect(matcher).not.toBeNull();
    const { matcherExecutionPlan } = matcher!;
    expect(matcherExecutionPlan({})).toEqual({ mode: 'preview', writesOutreach: false, sendsMessages: false });
    expect(matcherExecutionPlan({ confirmedListingIds: ['listing-1'] })).toEqual({
      mode: 'prepare_selected',
      writesOutreach: true,
      sendsMessages: false,
    });
  });
});
