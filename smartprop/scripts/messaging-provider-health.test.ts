import { describe, expect, test } from 'bun:test';

import { GET as applicationHealth } from '../src/app/api/health/route';
import { getServiceStatus } from '../src/app/api/services/status/route';
import {
  getMessagingProviderHealth,
  getOpenClawWhatsAppReadiness,
  type OpenClawRunner,
} from '../src/lib/wa/provider-health';

const runningWhatsApp = JSON.stringify({
  channels: {
    whatsapp: {
      accounts: {
        primary: {
          running: true,
          connected: true,
        },
      },
    },
  },
});

function runnerReturning(stdout: string): OpenClawRunner {
  return async () => ({ stdout, stderr: '' });
}

describe('provider-aware WhatsApp readiness', () => {
  test('does not treat a linked but disconnected OpenClaw account as ready', async () => {
    const readiness = await getOpenClawWhatsAppReadiness({
      account: 'primary',
      run: runnerReturning(JSON.stringify({
        channels: {
          whatsapp: {
            accounts: {
              primary: { running: true, linked: true, connected: false },
            },
          },
        },
      })),
    });

    expect(readiness).toMatchObject({
      provider: 'openclaw',
      online: true,
      ready: false,
      account: 'primary',
    });
    expect(readiness.error).toContain('not running and connected');
  });

  test('reports a selected running and connected OpenClaw account as ready', async () => {
    const readiness = await getOpenClawWhatsAppReadiness({
      account: 'primary',
      command: 'openclaw-test',
      run: runnerReturning(runningWhatsApp),
    });

    expect(readiness).toEqual({
      provider: 'openclaw',
      online: true,
      ready: true,
      account: 'primary',
    });
  });

  test('fails closed when the selected OpenClaw account is missing or ambiguous', async () => {
    const missing = await getOpenClawWhatsAppReadiness({
      account: 'primary',
      run: runnerReturning(JSON.stringify({ channels: { whatsapp: { accounts: {} } } })),
    });
    const ambiguous = await getOpenClawWhatsAppReadiness({
      account: 'primary',
      run: runnerReturning(JSON.stringify({
        channels: [{
          name: 'whatsapp',
          accounts: [
            { running: true, connected: true },
            { running: true, connected: true },
          ],
        }],
      })),
    });

    expect(missing).toMatchObject({ online: true, ready: false, account: 'primary' });
    expect(missing.error).toContain('missing or ambiguous');
    expect(ambiguous).toMatchObject({ online: true, ready: false, account: 'primary' });
    expect(ambiguous.error).toContain('missing or ambiguous');
  });

  test('fails closed for malformed OpenClaw output and a bounded-runner timeout', async () => {
    const malformed = await getOpenClawWhatsAppReadiness({
      account: 'primary',
      run: runnerReturning('{not json'),
    });
    const timeout = await getOpenClawWhatsAppReadiness({
      account: 'primary',
      run: async () => {
        throw new DOMException('timed out', 'AbortError');
      },
    });

    expect(malformed).toMatchObject({ online: true, ready: false });
    expect(malformed.error).toContain('malformed');
    expect(timeout).toMatchObject({ online: false, ready: false });
    expect(timeout.error).toContain('timeout');
  });

  test('uses authenticated WAHA readiness when the provider is omitted', async () => {
    const previousKey = process.env.WAHA_API_KEY;
    const previousUrl = process.env.WAHA_URL;
    const originalFetch = globalThis.fetch;
    const requests: RequestInit[] = [];
    process.env.WAHA_API_KEY = 'waha-test-key';
    process.env.WAHA_URL = 'http://waha.test';
    globalThis.fetch = async (_input, init) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({ status: 'WORKING' }), { status: 200 });
    };

    try {
      const readiness = await getMessagingProviderHealth();
      expect(readiness).toMatchObject({ provider: 'waha', online: true, ready: true });
      expect(new Headers(requests[0]?.headers).get('X-Api-Key')).toBe('waha-test-key');
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.WAHA_API_KEY;
      else process.env.WAHA_API_KEY = previousKey;
      if (previousUrl === undefined) delete process.env.WAHA_URL;
      else process.env.WAHA_URL = previousUrl;
    }
  });

  test('the services-status route carries provider degradation from its controlled messaging dependency', async () => {
    const messaging = {
      provider: 'openclaw' as const,
      online: true,
      ready: false,
      account: 'primary',
      error: 'OpenClaw WhatsApp account "primary" is not running and connected',
    };
    const status = await getServiceStatus({
      checkFlareSolverr: async () => ({ online: true, ready: true }),
      checkMessaging: async () => messaging,
      checkWorker: () => ({ up: true, processCount: 1 }),
      checkChromium: () => ({ processCount: 0 }),
    });

    expect(status.messaging).toEqual(messaging);
    expect(status.waha).toBeUndefined();
  });
});

describe('messaging health consumers', () => {
  test('the application health route reports selected messaging degradation', async () => {
    const previous = {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseRole: process.env.SUPABASE_SERVICE_ROLE,
      groq: process.env.GROQ_API_KEY,
      provider: process.env.SMARTPROP_WHATSAPP_PROVIDER,
      wahaUrl: process.env.WAHA_URL,
    };
    const originalFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.SUPABASE_SERVICE_ROLE = 'test-service-role';
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.SMARTPROP_WHATSAPP_PROVIDER = 'waha';
    process.env.WAHA_URL = 'http://waha.test';
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith('http://waha.test')) {
        return new Response(JSON.stringify({ status: 'STOPPED' }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    try {
      const response = await applicationHealth(undefined as never);
      const body = await response.json() as { status: string; checks: Record<string, unknown> };
      expect(body.status).toBe('degraded');
      expect(body.checks.messaging).toMatchObject({
        status: 'degraded',
        provider: 'waha',
        ready: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        const envKey = key === 'supabaseUrl' ? 'NEXT_PUBLIC_SUPABASE_URL'
          : key === 'supabaseRole' ? 'SUPABASE_SERVICE_ROLE'
          : key === 'groq' ? 'GROQ_API_KEY'
          : key === 'provider' ? 'SMARTPROP_WHATSAPP_PROVIDER'
          : 'WAHA_URL';
        if (value === undefined) delete process.env[envKey];
        else process.env[envKey] = value;
      }
    }
  });

  test('daily reports use application messaging health instead of a separate WAHA probe', async () => {
    const { getDailyMessagingSummary } = await import('../scripts/smartprop-daily-report');

    expect(getDailyMessagingSummary({
      checks: {
        messaging: {
          provider: 'openclaw',
          online: true,
          ready: false,
          account: 'primary',
          error: 'OpenClaw WhatsApp account "primary" is not running and connected',
        },
      },
    })).toEqual({
      provider: 'openclaw',
      ready: false,
      account: 'primary',
      error: 'OpenClaw WhatsApp account "primary" is not running and connected',
    });
  });
});
