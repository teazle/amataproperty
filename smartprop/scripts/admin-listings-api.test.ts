import { describe, expect, test } from 'bun:test';
import { ADMIN_LISTING_ROW_SELECT } from '../src/lib/admin-browsing';

const fixtureAgent = {
  id: '00000000-0000-4000-8000-000000000908',
  name: 'Fixture Agent',
  phone: '91234567',
  email: 'fixture@example.test',
  agency: 'Example Realty',
  cea_reg_no: 'R123456A',
  source: 'propertyguru',
  source_url: 'https://example.test/agent',
  last_seen_at: '2026-09-08T00:00:00.000Z',
};

const fixtureOutreach = {
  id: 'outreach-stop-1',
  status: 'stopped',
  conversation_phase: 'stopped',
  co_broking_status: 'not_willing',
  co_broking_notes: 'Do not contact',
  last_message_at: '2026-09-08T00:00:00.000Z',
  auto_reply_count: 1,
};

function projectedListing(selection: string) {
  const agent = Object.fromEntries(Object.entries(fixtureAgent).filter(([field]) => selection.includes(field)));
  const outreachSelected = selection.includes('outreach!left');
  return {
    id: 'listing-stop-1',
    title: 'Fixture listing',
    agents: agent,
    ...(outreachSelected ? { outreach: [fixtureOutreach] } : {}),
  };
}

describe('admin listings select contract', () => {
  test('projects full many-to-one agent details and STOP outreach for a listing row', () => {
    const listing = projectedListing(ADMIN_LISTING_ROW_SELECT);

    expect(listing.agents).toEqual(fixtureAgent);
    expect(listing.outreach).toEqual([fixtureOutreach]);
  });
});
