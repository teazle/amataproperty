import { describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

mock.module('@/jobs/match', () => ({
  processOutreachMessages: async () => { throw new Error('process must not run'); },
}));
mock.module('@/workers/supa', () => ({
  getSupabaseClient: () => { throw new Error('database must not be reached'); },
}));

const { POST: processOutreach } = await import('../src/app/api/outreach/process/route');
const { POST: sendManualMessage } = await import('../src/app/api/outreach/send-message/route');
const { POST: resetOutreach } = await import('../src/app/api/outreach/reset/route');

describe('launch outreach guard', () => {
  test('does not process queued outreach without selected confirmed rows', async () => {
    const response = await processOutreach(new NextRequest('http://localhost/api/outreach/process', {
      method: 'POST', body: '{}',
    }));

    expect(response.status).toBe(400);
  });

  test('does not allow a manual send bypass at launch', async () => {
    const response = await sendManualMessage(new NextRequest('http://localhost/api/outreach/send-message', {
      method: 'POST', body: JSON.stringify({ outreachId: 'outreach-1', message: 'hello' }),
    }));

    expect(response.status).toBe(409);
  });

  test('does not delete outreach rows through the old reset control', async () => {
    const response = await resetOutreach(new NextRequest('http://localhost/api/outreach/reset', {
      method: 'POST', body: JSON.stringify({ outreachIds: ['outreach-1'] }),
    }));

    expect(response.status).toBe(409);
  });
});
