import { describe, expect, test } from 'bun:test';
import { reconciliationNotice } from '../src/lib/matcher/outreach-result';

describe('outreach reconciliation result', () => {
  test('keeps accepted-send persistence failures visible with their outreach ids', () => {
    expect(reconciliationNotice({
      reconciliationRequired: 1,
      reconciliationOutreachIds: ['outreach-1'],
      reconciliationErrors: ['Accepted outreach outreach-1 requires reconciliation: match domain write failed'],
    })).toEqual({
      count: 1,
      outreachIds: ['outreach-1'],
      errors: ['Accepted outreach outreach-1 requires reconciliation: match domain write failed'],
    });
  });

  test('does not create a warning for a normal successful result', () => {
    expect(reconciliationNotice({ processed: 1, sent: 1, failed: 0 })).toBeNull();
  });
});
