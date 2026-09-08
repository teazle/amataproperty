import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
process.env.SUPABASE_SERVICE_ROLE = 'test-service-role';

const { POST } = await import('../src/app/api/public/leads/route');
const { createPublicLeadPostHandler, PublicLeadRateLimiter } = await import('../src/lib/crm/public-lead-handler');

const validLead = {
  projectSlug: 'luxe-residences',
  propertyTitle: 'Luxe Residences',
  sourcePath: '/luxe-residences',
  name: 'Ada Example',
  phone: '+65 9123 4567',
  email: 'ada@example.test',
  message: 'Please contact me about a viewing.',
};

function leadRequest(payload: Record<string, unknown> = validLead, clientIp = '203.0.113.10') {
  return new NextRequest('http://localhost/api/public/leads', {
    method: 'POST',
    headers: { 'x-real-ip': clientIp },
    body: JSON.stringify(payload),
  });
}

function leadDatabase() {
  const writes: Array<{ table: string; values: Record<string, unknown> }> = [];
  const database = {
    from(table: string) {
      if (table === 'crm_projects') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'project-1', title: 'Luxe Residences' }, error: null }),
              }),
            }),
          }),
        };
      }

      if (table === 'crm_leads') {
        return {
          insert(values: Record<string, unknown>) {
            writes.push({ table, values });
            return {
              select: () => ({
                single: async () => ({ data: { id: 'lead-1' }, error: null }),
              }),
            };
          },
        };
      }

      if (table === 'crm_lead_activities') {
        return {
          async insert(values: Record<string, unknown>) {
            writes.push({ table, values });
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { database, writes };
}

function handlerWithDatabase() {
  const fixture = leadDatabase();
  return {
    ...fixture,
    POST: createPublicLeadPostHandler({
      getSupabaseClient: () => fixture.database as never,
      limiter: new PublicLeadRateLimiter(),
    }),
  };
}

describe('public lead anti-abuse boundary', () => {
  test('silently accepts a filled honeypot before any database work', async () => {
    const response = await POST(new NextRequest('http://localhost/api/public/leads', {
      method: 'POST',
      body: JSON.stringify({ ...validLead, website: 'https://bot.example' }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  test('keeps a valid same-origin-style server request working', async () => {
    const { POST: handler, writes } = handlerWithDatabase();

    const response = await handler(leadRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, leadId: 'lead-1' });
    expect(writes.map((write) => write.table)).toEqual(['crm_leads', 'crm_lead_activities']);
  });

  test('rejects invalid submissions without database writes', async () => {
    const { POST: handler, writes } = handlerWithDatabase();

    const response = await handler(leadRequest({ ...validLead, phone: 'not-a-phone-number' }));

    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  test('returns retry-after and does not write the sixth rapid request from one client', async () => {
    const { POST: handler, writes } = handlerWithDatabase();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await handler(leadRequest())).status).toBe(200);
    }
    const blocked = await handler(leadRequest());

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('600');
    expect(writes.filter((write) => write.table === 'crm_leads')).toHaveLength(5);
  });

  test('limits a project even when automated requests vary their client address', async () => {
    const { POST: handler, writes } = handlerWithDatabase();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await handler(leadRequest(validLead, `203.0.113.${attempt}`))).status).toBe(200);
    }
    const blocked = await handler(leadRequest(validLead, '203.0.113.31'));

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(writes.filter((write) => write.table === 'crm_leads')).toHaveLength(30);
  });
});
