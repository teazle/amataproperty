import { createHash } from 'node:crypto';

import {
  resolveValuationSource,
  VALUATION_SOURCE_REGISTRY_REVISION,
  type ValuationEvidenceClass,
} from './valuation-source-registry';

export const VALUATION_EVIDENCE_CONTRACT = 'chloe-valuation-v1' as const;
export const VALUATION_CONTENT_HASH_ALGORITHM = 'sha256-utf8-v1' as const;

export type AcquisitionMethod = 'propnex' | 'ura' | 'public-comparables';
export type EvidenceConfidence = 'medium' | 'high';

export interface ValuationEvidenceContext {
  projectSlug: string;
  projectTitle: string;
  location: string;
  propertyType: string;
  tenure: string;
  areaDistribution: Array<{ areaSqft: number; count: number }>;
  runDate: string;
  now: Date;
  agentIdentity: string;
  sourceRevision: string;
}

export interface ValidatedValuationSource {
  sourceName: string;
  url: string;
  evidenceDate: string;
  evidenceType: ValuationEvidenceClass;
  ownershipGroup: string;
  detail: string;
  contentHash: string;
}

export interface ValidatedValuationEvidence {
  projectSlug: string;
  projectTitle: string;
  location: string;
  propertyType: string;
  tenure: string;
  lowSgd: number | null;
  midSgd: number | null;
  highSgd: number | null;
  psfLow: number | null;
  psfHigh: number | null;
  areaSqft: number | null;
  comparablesCount: number;
  confidence: EvidenceConfidence;
  basis: string;
  asOf: string;
  expiresAt: string;
  acquisitionMethod: AcquisitionMethod;
  sources: ValidatedValuationSource[];
  agentIdentity: string;
  sourceRevision: string;
  evidenceContractVersion: typeof VALUATION_EVIDENCE_CONTRACT;
  registryRevision: typeof VALUATION_SOURCE_REGISTRY_REVISION;
  contentHashAlgorithm: typeof VALUATION_CONTENT_HASH_ALGORITHM;
  evidenceHash: string;
}

export class ValuationEvidenceValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ValuationEvidenceValidationError';
  }
}

function fail(code: string, message: string): never {
  throw new ValuationEvidenceValidationError(code, message);
}

function record(value: unknown, code = 'invalid_evidence'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, 'valuation evidence must be an object');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code: string, label: string, max = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    fail(code, `${label} is required`);
  }
  return value.trim();
}

function optionalPositive(value: unknown, code: string, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) fail(code, `${label} must be positive`);
  return number;
}

function normalizedIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dateOnly(value: unknown, code: string, label: string): { value: string; time: number } {
  const text = requiredString(value, code, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(code, `${label} must use YYYY-MM-DD`);
  const time = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== text) {
    fail(code, `${label} is invalid`);
  }
  return { value: text, time };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value)), 'utf8').digest('hex');
}

function assertSame(input: Record<string, unknown>, key: string, expected: string): void {
  if (input[key] !== undefined && (
    typeof input[key] !== 'string' ||
    normalizedIdentity(input[key] as string) !== normalizedIdentity(expected)
  )) {
    fail('project_profile_mismatch', `${key} does not match the server-owned project profile`);
  }
}

export function validateValuationEvidence(
  inputValue: unknown,
  context: ValuationEvidenceContext,
): ValidatedValuationEvidence {
  if (!Number.isFinite(context.now.getTime())) fail('invalid_context', 'server clock is invalid');
  const input = record(inputValue);

  for (const field of [
    'agentIdentity', 'sourceRevision', 'runDate', 'expiresAt',
    'evidenceContractVersion', 'registryRevision', 'evidenceHash', 'contentHashAlgorithm',
  ]) {
    if (field in input) fail('caller_owned_field', `${field} is server-owned`);
  }
  for (const field of ['unit', 'unitNumber', 'stack', 'floor', 'address', 'postalCode']) {
    if (field in input) fail('unit_specific_identity', 'unit or address-specific identity is not allowed');
  }

  assertSame(input, 'projectSlug', context.projectSlug);
  assertSame(input, 'projectTitle', context.projectTitle);
  assertSame(input, 'location', context.location);
  assertSame(input, 'propertyType', context.propertyType);
  assertSame(input, 'tenure', context.tenure);

  const lowSgd = optionalPositive(input.lowSgd, 'invalid_value', 'lowSgd');
  const midSgd = optionalPositive(input.midSgd, 'invalid_value', 'midSgd');
  const highSgd = optionalPositive(input.highSgd, 'invalid_value', 'highSgd');
  if (midSgd === null && (lowSgd === null || highSgd === null)) {
    fail('missing_value', 'a midpoint or complete range is required');
  }
  if (lowSgd !== null && highSgd !== null && lowSgd > highSgd) {
    fail('inverted_range', 'valuation low cannot exceed high');
  }

  const psfLow = optionalPositive(input.psfLow, 'invalid_psf', 'psfLow');
  const psfHigh = optionalPositive(input.psfHigh, 'invalid_psf', 'psfHigh');
  if (psfLow !== null && psfHigh !== null && psfLow > psfHigh) {
    fail('inverted_psf_range', 'PSF low cannot exceed high');
  }
  const areaSqft = optionalPositive(input.areaSqft, 'unsupported_area', 'areaSqft');
  if (areaSqft !== null && !context.areaDistribution.some((entry) =>
    Number.isFinite(entry.areaSqft) && Math.abs(entry.areaSqft - areaSqft) < 0.01)) {
    fail('unsupported_area', 'areaSqft is not present in the server-owned project profile');
  }

  const comparablesCount = optionalPositive(
    input.comparablesCount,
    'invalid_comparables_count',
    'comparablesCount',
  );
  if (comparablesCount === null || !Number.isInteger(comparablesCount)) {
    fail('invalid_comparables_count', 'comparablesCount must be a positive integer');
  }
  if (input.confidence !== 'medium' && input.confidence !== 'high') {
    fail('unsupported_confidence', 'confidence must be medium or high');
  }
  const confidence = input.confidence as EvidenceConfidence;
  const basis = requiredString(input.basis, 'invalid_basis', 'basis');

  const asOf = dateOnly(input.asOf, 'invalid_as_of', 'asOf');
  const runDate = dateOnly(context.runDate, 'invalid_context', 'runDate');
  const analysisAgeDays = Math.floor((runDate.time - asOf.time) / 86_400_000);
  if (analysisAgeDays < 0) fail('future_as_of', 'asOf cannot be in the future');
  if (analysisAgeDays > 7) fail('stale_as_of', 'asOf cannot be more than seven days old');

  if (!['propnex', 'ura', 'public-comparables'].includes(String(input.acquisitionMethod))) {
    fail('unsupported_acquisition_method', 'acquisitionMethod is unsupported');
  }
  const acquisitionMethod = input.acquisitionMethod as AcquisitionMethod;

  if (!Array.isArray(input.sources) || input.sources.length < 2 || input.sources.length > 8) {
    fail('invalid_sources', 'at least two bounded sources are required');
  }
  const sourceOverrides = ['sourceName', 'ownershipGroup', 'group', 'classes', 'allowedEvidenceClasses'];
  const sources = input.sources.map((sourceValue): ValidatedValuationSource => {
    const source = record(sourceValue, 'invalid_source');
    if (sourceOverrides.some((field) => field in source)) {
      fail('source_override', 'source ownership and classification are registry-owned');
    }
    const url = requiredString(source.url, 'invalid_source_url', 'source URL', 2_000);
    const registered = resolveValuationSource(url);
    if (!registered) fail('unregistered_source', 'source URL is not an approved canonical HTTPS source');
    const evidenceType = source.evidenceType as ValuationEvidenceClass;
    if (!registered.allowedEvidenceClasses.includes(evidenceType as never)) {
      fail('unsupported_source_class', 'source evidenceType is not allowed for its registry entry');
    }
    const evidenceDate = dateOnly(source.evidenceDate, 'invalid_source_date', 'evidenceDate');
    if (evidenceDate.time > runDate.time) fail('future_source_date', 'source evidenceDate is in the future');
    const detail = requiredString(source.detail, 'invalid_source_detail', 'source detail', 1_000);
    if (detail.length < 10) fail('invalid_source_detail', 'source detail is too short');
    const contentHash = requiredString(source.contentHash, 'invalid_content_hash', 'contentHash', 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(contentHash)) {
      fail('invalid_content_hash', 'contentHash must be a SHA-256 hex digest');
    }
    return {
      sourceName: registered.sourceName,
      url: registered.canonicalUrl,
      evidenceDate: evidenceDate.value,
      evidenceType,
      ownershipGroup: registered.ownershipGroup,
      detail,
      contentHash,
    };
  }).sort((left, right) => left.url.localeCompare(right.url));

  if (new Set(sources.map((source) => source.ownershipGroup)).size < 2) {
    fail('source_independence', 'two independent source ownership groups are required');
  }
  const recentCutoff = new Date(runDate.time);
  recentCutoff.setUTCFullYear(recentCutoff.getUTCFullYear() - 1);
  if (!sources.some((source) =>
    (source.evidenceType === 'transaction' || source.evidenceType === 'official-valuation') &&
    Date.parse(`${source.evidenceDate}T00:00:00.000Z`) >= recentCutoff.getTime())) {
    fail('missing_recent_transaction', 'a recent transaction or official valuation source is required');
  }
  if (acquisitionMethod === 'propnex' && !sources.some((source) => source.ownershipGroup === 'propnex')) {
    fail('acquisition_source_mismatch', 'PropNex acquisition requires a PropNex source');
  }
  if (acquisitionMethod === 'ura' && !sources.some((source) =>
    source.ownershipGroup === 'singapore-government')) {
    fail('acquisition_source_mismatch', 'URA acquisition requires a Singapore government source');
  }

  const hashPayload = {
    projectSlug: context.projectSlug,
    projectTitle: context.projectTitle,
    location: context.location,
    propertyType: context.propertyType,
    tenure: context.tenure,
    lowSgd, midSgd, highSgd, psfLow, psfHigh, areaSqft,
    comparablesCount, confidence, basis, asOf: asOf.value,
    acquisitionMethod, sources,
    agentIdentity: context.agentIdentity,
    sourceRevision: context.sourceRevision,
    evidenceContractVersion: VALUATION_EVIDENCE_CONTRACT,
    registryRevision: VALUATION_SOURCE_REGISTRY_REVISION,
    contentHashAlgorithm: VALUATION_CONTENT_HASH_ALGORITHM,
  };

  return {
    ...hashPayload,
    expiresAt: new Date(context.now.getTime() + 30 * 86_400_000).toISOString(),
    evidenceHash: sha256(hashPayload),
  };
}
