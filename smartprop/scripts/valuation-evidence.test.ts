import { describe, expect, test } from 'bun:test';

import {
  ValuationEvidenceValidationError,
  validateValuationEvidence,
  type ValuationEvidenceContext,
} from '../src/lib/newsletter/valuation-evidence';
import { resolveValuationSource } from '../src/lib/newsletter/valuation-source-registry';

const context: ValuationEvidenceContext = {
  projectSlug: 'cliften',
  projectTitle: 'The Cliften',
  location: 'Pasir Panjang, Singapore',
  propertyType: 'Condominium',
  tenure: 'Freehold',
  areaDistribution: [{ areaSqft: 1000, count: 2 }],
  runDate: '2026-07-14',
  now: new Date('2026-07-14T01:00:00.000Z'),
  agentIdentity: 'chloe',
  sourceRevision: 'openclaw:2026.7.14',
};

function validEvidence() {
  return {
    projectSlug: 'cliften',
    projectTitle: 'The Cliften',
    propertyType: 'Condominium',
    location: 'Pasir Panjang, Singapore',
    lowSgd: 1_500_000,
    midSgd: 1_600_000,
    highSgd: 1_700_000,
    psfLow: 1500,
    psfHigh: 1700,
    areaSqft: 1000,
    comparablesCount: 4,
    confidence: 'high',
    basis: 'Four recent project transactions support the indicative range.',
    asOf: '2026-07-14',
    acquisitionMethod: 'ura',
    sources: [
      {
        url: 'https://eservice.ura.gov.sg/property-market-information/example',
        evidenceDate: '2026-06-30',
        evidenceType: 'transaction',
        detail: 'Four registered project transactions from the recent period.',
        contentHash: 'a'.repeat(64),
      },
      {
        url: 'https://nexthome.sg/?ac=pc&pc=259342',
        evidenceDate: '2026-07-10',
        evidenceType: 'market-analysis',
        detail: 'Project page corroborates the transaction range and tenure.',
        contentHash: 'b'.repeat(64),
      },
    ],
  };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected validation failure');
  } catch (error) {
    expect(error).toBeInstanceOf(ValuationEvidenceValidationError);
    expect((error as ValuationEvidenceValidationError).code).toBe(code);
  }
}

describe('valuation source registry', () => {
  test('resolves canonical HTTPS hosts and allowed subdomains', () => {
    expect(resolveValuationSource('https://eservice.ura.gov.sg/a')).toMatchObject({
      ownershipGroup: 'singapore-government',
    });
    expect(resolveValuationSource('https://www.propnex.com/property-value')).toMatchObject({
      ownershipGroup: 'propnex',
    });
  });

  test('rejects non-HTTPS, credentials, ports, fragments, look-alikes, and redirect wrappers', () => {
    for (const url of [
      'http://eservice.ura.gov.sg/a',
      'https://user:pass@eservice.ura.gov.sg/a',
      'https://eservice.ura.gov.sg:444/a',
      'https://eservice.ura.gov.sg/a#fragment',
      'https://eservice.ura.gov.sg.evil.example/a',
      'https://evil.example/?redirect=https://eservice.ura.gov.sg/a',
    ]) {
      expect(resolveValuationSource(url)).toBeNull();
    }
  });
});

describe('validateValuationEvidence', () => {
  test('normalizes supported evidence with server-owned identity and deterministic hash', () => {
    const first = validateValuationEvidence(validEvidence(), context);
    const second = validateValuationEvidence(validEvidence(), context);

    expect(first).toMatchObject({
      projectSlug: 'cliften',
      projectTitle: 'The Cliften',
      propertyType: 'Condominium',
      confidence: 'high',
      acquisitionMethod: 'ura',
      agentIdentity: 'chloe',
      sourceRevision: 'openclaw:2026.7.14',
      evidenceContractVersion: 'chloe-valuation-v1',
      contentHashAlgorithm: 'sha256-utf8-v1',
      expiresAt: '2026-08-13T01:00:00.000Z',
    });
    expect(first.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.evidenceHash).toBe(second.evidenceHash);
    expect(first.sources[0]).toMatchObject({
      ownershipGroup: 'singapore-government',
      sourceName: 'eservice.ura.gov.sg',
    });
  });

  test('rejects caller-controlled identity and source classification overrides', () => {
    expectCode(() => validateValuationEvidence({
      ...validEvidence(),
      agentIdentity: 'someone-else',
    }, context), 'caller_owned_field');
    const input = validEvidence();
    input.sources[0] = {
      ...input.sources[0],
      ownershipGroup: 'independent',
    } as typeof input.sources[number];
    expectCode(() => validateValuationEvidence(input, context), 'source_override');
  });

  test('rejects two hostnames owned by the same source group', () => {
    const input = validEvidence();
    input.sources[1] = {
      ...input.sources[1],
      url: 'https://data.gov.sg/datasets/example',
      evidenceType: 'transaction',
    };
    expect(() => validateValuationEvidence(input, context)).toThrow(
      'two independent source ownership groups',
    );
  });

  test('rejects stale/future analysis and missing recent transaction evidence', () => {
    expectCode(() => validateValuationEvidence({
      ...validEvidence(),
      asOf: '2026-07-06',
    }, context), 'stale_as_of');
    expectCode(() => validateValuationEvidence({
      ...validEvidence(),
      asOf: '2026-07-15',
    }, context), 'future_as_of');

    const input = validEvidence();
    input.sources = input.sources.map((source) => ({
      ...source,
      evidenceDate: '2025-06-01',
    }));
    expectCode(() => validateValuationEvidence(input, context), 'missing_recent_transaction');
  });

  test('rejects low confidence, inverted or absent values, and unsupported acquisition methods', () => {
    expectCode(() => validateValuationEvidence({
      ...validEvidence(), confidence: 'low',
    }, context), 'unsupported_confidence');
    expectCode(() => validateValuationEvidence({
      ...validEvidence(), lowSgd: 2_000_000, highSgd: 1_000_000,
    }, context), 'inverted_range');
    expectCode(() => validateValuationEvidence({
      ...validEvidence(), lowSgd: null, midSgd: null, highSgd: null,
    }, context), 'missing_value');
    expectCode(() => validateValuationEvidence({
      ...validEvidence(), acquisitionMethod: 'ai-estimate',
    }, context), 'unsupported_acquisition_method');
  });

  test('rejects unit/address identity, mismatched profiles, unsupported area, and weak source artifacts', () => {
    expectCode(() => validateValuationEvidence({
      ...validEvidence(), unitNumber: '#10-01',
    }, context), 'unit_specific_identity');
    expectCode(() => validateValuationEvidence({
      ...validEvidence(), propertyType: 'Landed',
    }, context), 'project_profile_mismatch');
    expectCode(() => validateValuationEvidence({
      ...validEvidence(), areaSqft: 888,
    }, context), 'unsupported_area');

    const noDetail = validEvidence();
    noDetail.sources[0].detail = '';
    expectCode(() => validateValuationEvidence(noDetail, context), 'invalid_source_detail');
    const badHash = validEvidence();
    badHash.sources[0].contentHash = 'not-a-hash';
    expectCode(() => validateValuationEvidence(badHash, context), 'invalid_content_hash');
  });
});
