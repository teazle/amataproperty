import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ServiceStatus } from '../src/components/ServiceStatus';
import { getServiceStatus } from '../src/lib/services/status';
import type { MessagingProviderHealth } from '../src/lib/wa/provider-health';

async function statusWithMessaging(messaging: MessagingProviderHealth) {
  return getServiceStatus({
    checkFlareSolverr: async () => ({ online: true, ready: true }),
    checkMessaging: async () => messaging,
    checkWorker: () => ({ up: true, processCount: 1 }),
    checkChromium: () => ({ processCount: 0 }),
  });
}

function renderStatus(status: unknown): string {
  return renderToStaticMarkup(createElement(ServiceStatus, { initialStatus: status }));
}

describe('ServiceStatus messaging consumer', () => {
  test('renders a terminal-disconnected OpenClaw account from the real status builder without accessing legacy WAHA fields', async () => {
    const status = await statusWithMessaging({
      provider: 'openclaw',
      online: true,
      ready: false,
      account: 'default',
      error: 'OpenClaw WhatsApp account "default" has a terminal disconnect',
    });

    const markup = renderStatus(status);

    expect(markup).toContain('OpenClaw');
    expect(markup).toContain('Online (Not Ready)');
    expect(markup).toContain('terminal disconnect');
  });

  test('renders a ready OpenClaw account from the real status builder', async () => {
    const status = await statusWithMessaging({
      provider: 'openclaw',
      online: true,
      ready: true,
      account: 'default',
    });

    const markup = renderStatus(status);

    expect(markup).toContain('OpenClaw');
    expect(markup).toContain('Online &amp; Ready');
  });

  test('renders default WAHA readiness with its legacy session detail', async () => {
    const status = await statusWithMessaging({
      provider: 'waha',
      online: true,
      ready: true,
      sessionStatus: 'WORKING',
    });

    const markup = renderStatus(status);

    expect(markup).toContain('WAHA');
    expect(markup).toContain('(WORKING)');
    expect(markup).toContain('Online &amp; Ready');
  });

  test('renders a safe unavailable state and preserves a legacy WAHA fallback', () => {
    const unavailable = renderStatus({
      flaresolverr: { online: true, ready: true },
      worker: { up: true },
      chromium: { processCount: 0 },
    });
    const legacy = renderStatus({
      flaresolverr: { online: true, ready: true },
      waha: { online: true, ready: true, sessionStatus: 'WORKING' },
      worker: { up: true },
      chromium: { processCount: 0 },
    });

    expect(unavailable).toContain('Messaging status unavailable');
    expect(unavailable).toContain('Offline');
    expect(legacy).toContain('WAHA');
    expect(legacy).toContain('(WORKING)');
  });
});
