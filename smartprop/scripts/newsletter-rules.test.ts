import { describe, expect, test } from 'bun:test';

import { normalizeSingaporeRecipient } from '../src/lib/newsletter/recipient';
import { aggregateProjectValuation } from '../src/lib/newsletter/valuation';

describe('normalizeSingaporeRecipient', () => {
  test('normalizes only Singapore mobile recipients', () => {
    expect(normalizeSingaporeRecipient('9105 1399')).toBe('+6591051399');
    expect(normalizeSingaporeRecipient('6591051399@c.us')).toBe('+6591051399');
    expect(normalizeSingaporeRecipient('+65 8123-4567')).toBe('+6581234567');
    expect(normalizeSingaporeRecipient('(9105)-1399')).toBe('+6591051399');
    expect(normalizeSingaporeRecipient('123')).toBeNull();
    expect(normalizeSingaporeRecipient('+6571234567')).toBeNull();
    expect(normalizeSingaporeRecipient('+65910513990')).toBeNull();
  });

  test('rejects text and punctuation outside documented phone syntax', () => {
    expect(normalizeSingaporeRecipient('customer id 91051399')).toBeNull();
    expect(normalizeSingaporeRecipient('call 9105-1399')).toBeNull();
    expect(normalizeSingaporeRecipient('9105/1399')).toBeNull();
    expect(normalizeSingaporeRecipient('+6591051399 ext 1')).toBeNull();
  });
});

describe('aggregateProjectValuation', () => {
  const now = new Date('2026-07-13T00:00:00Z');
  const valuationRows = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      project_slug: 'cliften',
      project_name: 'The Cliften',
      low_sgd: 1_000_000,
      mid_sgd: 1_100_000,
      high_sgd: 1_200_000,
      comparables_count: 2,
      as_of: '2026-07-10',
      expires_at: '2026-07-20T00:00:00Z',
      fetched_at: '2026-07-12T00:00:00Z',
      evidence_status: 'accepted',
      evidence_contract_version: 'chloe-valuation-v1',
      evidence_item_id: '10000000-0000-4000-8000-000000000001',
      validated_confidence: 'high',
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      project_slug: 'cliften',
      project_name: 'Cliften Residences',
      low_sgd: 1_050_000,
      mid_sgd: 1_200_000,
      high_sgd: 1_300_000,
      comparables_count: 3,
      as_of: '2026-07-12',
      expires_at: '2026-07-21T00:00:00Z',
      fetched_at: '2026-07-13T00:00:00Z',
      evidence_status: 'accepted',
      evidence_contract_version: 'chloe-valuation-v1',
      evidence_item_id: '10000000-0000-4000-8000-000000000002',
      validated_confidence: 'medium',
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      project_slug: 'cliften',
      project_name: 'Cliften',
      low_sgd: null,
      mid_sgd: 1_300_000,
      high_sgd: null,
      comparables_count: 1,
      as_of: '2026-07-11',
      expires_at: '2026-07-22T00:00:00Z',
      fetched_at: '2026-07-11T00:00:00Z',
      evidence_status: 'accepted',
      evidence_contract_version: 'chloe-valuation-v1',
      evidence_item_id: '10000000-0000-4000-8000-000000000003',
      validated_confidence: 'high',
    },
    {
      id: '00000000-0000-4000-8000-000000000004',
      project_slug: 'cliften',
      project_name: 'Cliften',
      low_sgd: 500_000,
      mid_sgd: 600_000,
      high_sgd: 700_000,
      comparables_count: 50,
      as_of: '2026-06-01',
      expires_at: '2026-07-12T23:59:59Z',
      fetched_at: '2026-06-01T00:00:00Z',
      evidence_status: 'accepted',
      evidence_contract_version: 'chloe-valuation-v1',
      evidence_item_id: '10000000-0000-4000-8000-000000000004',
      validated_confidence: 'high',
    },
    {
      id: '00000000-0000-4000-8000-000000000005',
      project_slug: 'cliften',
      project_name: 'Cliften',
      low_sgd: null,
      mid_sgd: null,
      high_sgd: null,
      comparables_count: 100,
      as_of: '2026-07-13',
      expires_at: '2026-07-22T00:00:00Z',
      fetched_at: '2026-07-13T00:00:00Z',
      evidence_status: 'accepted',
      evidence_contract_version: 'chloe-valuation-v1',
      evidence_item_id: '10000000-0000-4000-8000-000000000005',
      validated_confidence: 'high',
    },
    {
      id: '00000000-0000-4000-8000-000000000006',
      project_slug: 'different-project',
      project_name: 'Different Project',
      low_sgd: 100,
      mid_sgd: 200,
      high_sgd: 300,
      comparables_count: 100,
      as_of: '2026-07-13',
      expires_at: '2026-07-22T00:00:00Z',
      fetched_at: '2026-07-13T00:00:00Z',
      evidence_status: 'accepted',
      evidence_contract_version: 'chloe-valuation-v1',
      evidence_item_id: '10000000-0000-4000-8000-000000000006',
      validated_confidence: 'high',
    },
    {
      id: '00000000-0000-4000-8000-000000000007',
      project_slug: 'cliften',
      project_name: 'Cliften',
      low_sgd: 900_000,
      mid_sgd: 950_000,
      high_sgd: 800_000,
      comparables_count: 500,
      as_of: '2026-07-13',
      expires_at: '2026-07-22T00:00:00Z',
      fetched_at: '2026-07-13T00:00:00Z',
      evidence_status: 'accepted',
      evidence_contract_version: 'chloe-valuation-v1',
      evidence_item_id: '10000000-0000-4000-8000-000000000007',
      validated_confidence: 'high',
    },
  ];

  test('aggregates only fresh project-matching supported valuations', () => {
    expect(aggregateProjectValuation('cliften', valuationRows, now)).toEqual({
      basis: 'project-level',
      lowSgd: 1_000_000,
      midSgd: 1_200_000,
      highSgd: 1_300_000,
      comparablesCount: 6,
      asOf: '2026-07-12',
      evidenceItemId: '10000000-0000-4000-8000-000000000002',
      valuationId: '00000000-0000-4000-8000-000000000002',
      projectSlug: 'cliften',
      evidenceContractVersion: 'chloe-valuation-v1',
      confidence: 'medium',
    });
  });

  test('returns null when no fresh supported row matches the project', () => {
    expect(aggregateProjectValuation('Missing', valuationRows, now)).toBeNull();
    expect(aggregateProjectValuation('', valuationRows, now)).toBeNull();
  });

  test('does not let an inverted valuation range influence aggregation', () => {
    const invertedOnly = valuationRows.at(-1);

    expect(invertedOnly).toBeDefined();
    expect(aggregateProjectValuation('cliften', [invertedOnly!], now)).toBeNull();
  });

  test('rejects fuzzy and legacy cache rows even when fresh', () => {
    const fuzzy = { ...valuationRows[0], project_slug: 'the-cliften' };
    const legacy = {
      ...valuationRows[0],
      evidence_contract_version: null,
      evidence_item_id: null,
    };
    expect(aggregateProjectValuation('cliften', [fuzzy], now)).toBeNull();
    expect(aggregateProjectValuation('cliften', [legacy], now)).toBeNull();
  });
});
