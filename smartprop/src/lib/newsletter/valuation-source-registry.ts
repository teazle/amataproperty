export type ValuationEvidenceClass =
  | 'official-valuation'
  | 'transaction'
  | 'market-analysis'
  | 'listing';

export interface RegisteredValuationSource {
  sourceName: string;
  hostname: string;
  ownershipGroup: string;
  allowedEvidenceClasses: readonly ValuationEvidenceClass[];
  canonicalUrl: string;
}

export const VALUATION_SOURCE_REGISTRY_REVISION = '2026-07-14-v1' as const;

export const VALUATION_SOURCES = [
  { hostname: 'eservice.ura.gov.sg', group: 'singapore-government', classes: ['official-valuation', 'transaction'] },
  { hostname: 'data.gov.sg', group: 'singapore-government', classes: ['transaction'] },
  { hostname: 'edgeprop.sg', group: 'edgeprop', classes: ['transaction', 'market-analysis'] },
  { hostname: '99.co', group: '99co', classes: ['transaction', 'market-analysis'] },
  { hostname: 'srx.com.sg', group: 'srx', classes: ['transaction', 'market-analysis'] },
  { hostname: 'propertyguru.com.sg', group: 'propertyguru', classes: ['transaction', 'market-analysis', 'listing'] },
  { hostname: 'homejourney.sg', group: 'homejourney', classes: ['transaction', 'market-analysis'] },
  { hostname: 'nexthome.sg', group: 'nexthome', classes: ['transaction', 'market-analysis'] },
  { hostname: 'propnex.com', group: 'propnex', classes: ['official-valuation', 'transaction', 'market-analysis'] },
] as const;

export function resolveValuationSource(urlValue: string): RegisteredValuationSource | null {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const source = VALUATION_SOURCES.find((candidate) =>
    hostname === candidate.hostname || hostname.endsWith(`.${candidate.hostname}`));
  if (!source) return null;

  return {
    sourceName: source.hostname,
    hostname,
    ownershipGroup: source.group,
    allowedEvidenceClasses: source.classes,
    canonicalUrl: url.toString(),
  };
}
