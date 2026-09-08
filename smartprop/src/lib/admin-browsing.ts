export const DEFAULT_BROWSE_PAGE_SIZE = 50;
export const MAX_BROWSE_PAGE_SIZE = 100;

export type FilterQuery = {
  or: (filters: string) => FilterQuery;
  ilike: (column: string, value: string) => FilterQuery;
  eq: (column: string, value: string) => FilterQuery;
  in: (column: string, values: string[]) => FilterQuery;
  is: (column: string, value: null) => FilterQuery;
  gte: (column: string, value: number | string) => FilterQuery;
  lte: (column: string, value: number | string) => FilterQuery;
};

export type BrowsePagination = {
  page: number;
  limit: number;
};

export type ListingBrowseParams = BrowsePagination & {
  search: string;
  district: string;
  portal: string;
  minPrice: number | null;
  maxPrice: number | null;
  beds: string;
  baths: string;
  status: string;
};

export type AgentBrowseParams = BrowsePagination & {
  search: string;
  letter: string;
  source: string;
  agency: string;
  sort: 'asc' | 'desc';
};

function boundedInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function optionalNumber(value: string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeSearch(value: string | null): string {
  return (value || '').trim().replace(/[%,()]/g, ' ');
}

export function parseListingBrowseParams(searchParams: URLSearchParams): ListingBrowseParams {
  return {
    page: boundedInteger(searchParams.get('page'), 1, Number.MAX_SAFE_INTEGER),
    limit: boundedInteger(searchParams.get('limit'), DEFAULT_BROWSE_PAGE_SIZE, MAX_BROWSE_PAGE_SIZE),
    search: safeSearch(searchParams.get('search')),
    district: searchParams.get('district') || 'All',
    portal: searchParams.get('portal') || 'All',
    minPrice: optionalNumber(searchParams.get('minPrice')),
    maxPrice: optionalNumber(searchParams.get('maxPrice')),
    beds: searchParams.get('beds') || 'All',
    baths: searchParams.get('baths') || 'All',
    status: searchParams.get('status') || '',
  };
}

export function parseAgentBrowseParams(searchParams: URLSearchParams): AgentBrowseParams {
  const sort = searchParams.get('sort');
  return {
    page: boundedInteger(searchParams.get('page'), 1, Number.MAX_SAFE_INTEGER),
    limit: boundedInteger(searchParams.get('limit'), DEFAULT_BROWSE_PAGE_SIZE, MAX_BROWSE_PAGE_SIZE),
    search: safeSearch(searchParams.get('search')),
    letter: searchParams.get('letter') || 'all',
    source: searchParams.get('source') || 'all',
    agency: searchParams.get('agency') || 'all',
    sort: sort === 'desc' ? 'desc' : 'asc',
  };
}

export function districtAliases(district: string): string[] {
  const numeric = district.replace(/^D/i, '').replace(/^0+/, '') || '0';
  const padded = numeric.padStart(2, '0');
  return [...new Set([`D${padded}`, padded, `D${numeric}`, numeric])];
}

function listingSearchFilter(search: string): string {
  return `title.ilike.%${search}%,address.ilike.%${search}%,district.ilike.%${search}%,property_type.ilike.%${search}%,matched_agent.not.is.null`;
}

export function applyListingBrowseFilters(query: FilterQuery, params: ListingBrowseParams): FilterQuery {
  if (params.search) {
    query = query.ilike('matched_agent.name', `%${params.search}%`).or(listingSearchFilter(params.search));
  }
  if (params.district === 'No District') {
    query = query.is('district', null);
  } else if (params.district !== 'All') {
    query = query.in('district', districtAliases(params.district));
  }
  if (params.portal !== 'All') query = query.eq('portal', params.portal);
  if (params.minPrice !== null) query = query.gte('price', params.minPrice);
  if (params.maxPrice !== null) query = query.lte('price', params.maxPrice);
  if (params.beds !== 'All') {
    query = params.beds === '5+' ? query.gte('beds', 5) : query.eq('beds', params.beds);
  }
  if (params.baths !== 'All') {
    query = params.baths === '5+' ? query.gte('baths', 5) : query.eq('baths', params.baths);
  }
  if (params.status) query = query.eq('viewing_status', params.status);
  return query;
}

export function applyAgentBrowseFilters(query: FilterQuery, params: AgentBrowseParams): FilterQuery {
  if (params.search) {
    query = query.or(`name.ilike.%${params.search}%,phone.ilike.%${params.search}%,agency.ilike.%${params.search}%,source.ilike.%${params.search}%`);
  }
  if (params.letter !== 'all') {
    const [start, end = start] = params.letter.toUpperCase().split('-');
    query = query.gte('name', start).lte('name', `${end}\uffff`);
  }
  if (params.source !== 'all') query = query.eq('source', params.source);
  if (params.agency !== 'all') query = query.eq('agency', params.agency);
  return query;
}

export function getShowingRange({ total, page, limit, received }: BrowsePagination & { total: number; received: number }) {
  if (total === 0 || received === 0) return { start: 0, end: 0 };
  const start = (page - 1) * limit + 1;
  return { start, end: Math.min(start + received - 1, total) };
}
