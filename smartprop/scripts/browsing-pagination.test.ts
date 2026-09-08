import { describe, expect, test } from 'bun:test';

import {
  applyAgentBrowseFilters,
  applyListingBrowseFilters,
  getShowingRange,
  parseAgentBrowseParams,
  parseListingBrowseParams,
} from '../src/lib/admin-browsing';

type Listing = {
  id: string;
  title: string;
  address: string | null;
  district: string | null;
  price: number | null;
  portal: string;
  beds: number | null;
  baths: number | null;
  property_type: string | null;
};

type Agent = {
  id: string;
  name: string;
  phone: string;
  agency: string | null;
  source: string | null;
};

class InMemoryBrowseQuery<T extends Record<string, unknown>> {
  private rows: T[];

  constructor(rows: T[]) {
    this.rows = rows;
  }

  or(expression: string) {
    const conditions = expression.split(',').map((condition) => {
      const [field, operator, ...parts] = condition.split('.');
      return { field, operator, value: parts.join('.') };
    });
    this.rows = this.rows.filter((row) => conditions.some(({ field, operator, value }) => {
      if (operator !== 'ilike') return false;
      return String(row[field] ?? '').toLowerCase().includes(value.replaceAll('%', '').toLowerCase());
    }));
    return this;
  }

  eq(field: string, value: unknown) {
    this.rows = this.rows.filter((row) => row[field] === value);
    return this;
  }

  in(field: string, values: unknown[]) {
    this.rows = this.rows.filter((row) => values.includes(row[field]));
    return this;
  }

  is(field: string, value: unknown) {
    this.rows = this.rows.filter((row) => row[field] === value);
    return this;
  }

  gte(field: string, value: number | string) {
    this.rows = this.rows.filter((row) => row[field] !== null && row[field]! >= value);
    return this;
  }

  lte(field: string, value: number | string) {
    this.rows = this.rows.filter((row) => row[field] !== null && row[field]! <= value);
    return this;
  }

  range(from: number, to: number) {
    return this.rows.slice(from, to + 1);
  }

  count() {
    return this.rows.length;
  }
}

const listings: Listing[] = Array.from({ length: 1200 }, (_, index) => ({
  id: `listing-${index + 1}`,
  title: index < 586 ? `D09 home ${index + 1}` : `D10 home ${index + 1}`,
  address: index < 586 ? 'Orchard Road' : 'Bukit Timah Road',
  district: index < 300 ? 'D09' : index < 586 ? '09' : 'D10',
  price: index < 586 ? 2_000_000 : 800_000,
  portal: index % 2 === 0 ? 'edgeprop' : 'propertyguru',
  beds: index % 4 + 1,
  baths: index % 3 + 1,
  property_type: 'Condominium',
}));

const agents: Agent[] = Array.from({ length: 4449 }, (_, index) => ({
  id: `agent-${index + 1}`,
  name: `${index < 1200 ? 'Alice' : 'Zed'} ${index + 1}`,
  phone: `8${String(index).padStart(7, '0')}`,
  agency: index % 2 === 0 ? 'Example Realty' : 'Town Properties',
  source: index % 2 === 0 ? 'edgeprop' : 'propertyguru',
}));

describe('admin browsing query semantics', () => {
  test('keeps all 586 D09 records discoverable across server pages, including legacy district values', () => {
    const params = parseListingBrowseParams(new URLSearchParams('page=2&limit=50&district=D09&minPrice=1000000&maxPrice=2999999'));
    const query = applyListingBrowseFilters(new InMemoryBrowseQuery(listings), params);

    expect(query.count()).toBe(586);
    expect(query.range((params.page - 1) * params.limit, params.page * params.limit - 1)).toHaveLength(50);
    expect(getShowingRange({ total: 586, page: 2, limit: 50, received: 50 })).toEqual({ start: 51, end: 100 });
  });

  test('returns the full filtered agent total and a bounded second page instead of a 1,000-row client cap', () => {
    const params = parseAgentBrowseParams(new URLSearchParams('page=2&limit=50&letter=A-F&sort=asc'));
    const query = applyAgentBrowseFilters(new InMemoryBrowseQuery(agents), params);

    expect(query.count()).toBe(1200);
    expect(query.range((params.page - 1) * params.limit, params.page * params.limit - 1)).toHaveLength(50);
    expect(getShowingRange({ total: 4449, page: 2, limit: 50, received: 50 })).toEqual({ start: 51, end: 100 });
  });
});
