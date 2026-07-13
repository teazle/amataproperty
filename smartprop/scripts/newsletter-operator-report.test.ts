import { describe, expect, test } from 'bun:test';

import {
  buildOperatorReportRows,
  maskLeadPhone,
  validateOperatorRecipients,
} from '../src/lib/newsletter/operator-report';

const run = {
  id: 'run-1',
  runDate: '2026-07-13',
  issueId: 'issue-1',
  issueSlug: 'cliften-week-28',
  status: 'running' as const,
  selectedCount: 2,
  attemptedCount: 2,
  sentCount: 1,
  failedCount: 0,
  unknownCount: 1,
  skippedCount: 0,
  blocker: null,
};

const attempts = [
  {
    id: 'send-1',
    runId: 'run-1',
    leadId: 'lead-1',
    slotNo: 1,
    recipientName: 'Mrs Tan',
    recipientKey: '+6591051399',
    renderedBody: 'Hi Mrs Tan,\n\nExact first body.',
    status: 'sent' as const,
    attemptNo: 1,
    retryable: false,
  },
  {
    id: 'send-2',
    runId: 'run-1',
    leadId: 'lead-2',
    slotNo: 2,
    recipientName: 'Mr Lim',
    recipientKey: '+6581234567',
    renderedBody: 'Hi Mr Lim,\n\nExact second body.',
    status: 'unknown' as const,
    attemptNo: 1,
    retryable: false,
  },
];

describe('operator reports', () => {
  test('accepts one or two unique Singapore operator recipients only', () => {
    expect(validateOperatorRecipients(['+65 9105 1399'])).toEqual(['+6591051399']);
    expect(validateOperatorRecipients(['+6591051399', '+6581234567'])).toEqual([
      '+6591051399',
      '+6581234567',
    ]);
    expect(() => validateOperatorRecipients([])).toThrow('one or two');
    expect(() => validateOperatorRecipients(['+6591051399', '+6581234567', '+6599999999']))
      .toThrow('one or two');
    expect(() => validateOperatorRecipients(['+6591051399', '+6591051399']))
      .toThrow('unique');
  });

  test('masks lead phones while preserving only the last four digits', () => {
    expect(maskLeadPhone('+6591051399')).toBe('+65 **** 1399');
  });

  test('builds one summary and one exact-body detail per attempt per operator', () => {
    const rows = buildOperatorReportRows(run, attempts, ['+6591051399', '+6581234567']);

    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row.kind === 'summary')).toHaveLength(2);
    expect(rows.filter((row) => row.kind === 'recipient')).toHaveLength(4);
    expect(rows[0]?.body).toContain('Campaign: cliften-week-28');
    expect(rows[0]?.body).toContain('SGT date: 2026-07-13');
    expect(rows[0]?.body).toContain('Selected: 2');
    expect(rows[0]?.body).toContain('Unknown: 1');
    expect(rows[1]?.body).toContain('+65 **** 1399');
    expect(rows[1]?.body).toContain('Hi Mrs Tan,\n\nExact first body.');
    expect(rows.map((row) => row.body).join('\n')).not.toContain('+6591051399');
  });

  test('uses stable idempotency keys derived from run, operator, kind, and send', () => {
    const first = buildOperatorReportRows(run, attempts, ['+6591051399']);
    const second = buildOperatorReportRows(run, [...attempts].reverse(), ['+6591051399']);

    expect(first.map((row) => row.idempotencyKey)).toEqual([
      'run-1:+6591051399:summary',
      'run-1:+6591051399:recipient:send-1',
      'run-1:+6591051399:recipient:send-2',
    ]);
    expect(second.map((row) => row.idempotencyKey)).toEqual(first.map((row) => row.idempotencyKey));
  });
});
