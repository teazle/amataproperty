import { execSync } from 'node:child_process';

import { getMessagingProviderHealth, type MessagingProviderHealth } from '@/lib/wa/provider-health';

export interface ServiceStatus {
  flaresolverr: { online: boolean; ready: boolean; error?: string };
  messaging: MessagingProviderHealth;
  waha?: MessagingProviderHealth;
  worker: { up: boolean; processCount?: number; error?: string };
  chromium: { processCount: number; error?: string };
}

async function checkFlareSolverr(): Promise<ServiceStatus['flaresolverr']> {
  const url = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'sessions.list' }),
        signal: controller.signal,
      });
      if (response.ok) return { online: true, ready: true };
      return { online: true, ready: false, error: `HTTP ${response.status}` };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { online: false, ready: false, error: 'Connection timeout' };
    }
    if (error instanceof Error && (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed'))) {
      return { online: false, ready: false, error: 'Service not reachable' };
    }
    return { online: false, ready: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function checkWorker(): ServiceStatus['worker'] {
  try {
    const workers = execSync(
      "ps aux | grep -E '(scraper-worker\\.ts|scraper-worker|src/lib/queue/scraper-worker)' | grep -v grep || true",
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 },
    ).trim();
    const pgBoss = execSync(
      "ps aux | grep -E 'pg-boss|pgboss' | grep -v grep || true",
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 },
    ).trim();
    const count = (workers ? workers.split('\n').filter(Boolean).length : 0) +
      (pgBoss ? pgBoss.split('\n').filter(Boolean).length : 0);
    return { up: count > 0, processCount: count };
  } catch (error) {
    return { up: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function countChromiumProcesses(): ServiceStatus['chromium'] {
  try {
    const processes = execSync(
      "ps aux | grep -E '(chromium|chrome|playwright)' | grep -v grep | grep -v 'mcp-server' | grep -v 'chrome-devtools-mcp' | grep -v 'chrome_crashpad_handler' | grep -v 'Electron Framework' | grep -v 'Cursor.app' | grep -E '(--remote-debugging|\\.cache/ms-playwright|/chromium|playwright.*chromium)' || true",
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 },
    ).trim();
    return { processCount: processes ? processes.split('\n').filter(Boolean).length : 0 };
  } catch (error) {
    return { processCount: 0, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export interface ServiceStatusDependencies {
  checkFlareSolverr?: () => Promise<ServiceStatus['flaresolverr']>;
  checkMessaging?: () => Promise<MessagingProviderHealth>;
  checkWorker?: () => ServiceStatus['worker'];
  checkChromium?: () => ServiceStatus['chromium'];
}

export async function getServiceStatus(dependencies: ServiceStatusDependencies = {}): Promise<ServiceStatus> {
  const [flaresolverr, messaging, worker, chromium] = await Promise.all([
    (dependencies.checkFlareSolverr || checkFlareSolverr)(),
    (dependencies.checkMessaging || getMessagingProviderHealth)(),
    Promise.resolve((dependencies.checkWorker || checkWorker)()),
    Promise.resolve((dependencies.checkChromium || countChromiumProcesses)()),
  ]);
  return {
    flaresolverr,
    messaging,
    ...(messaging.provider === 'waha' ? { waha: messaging } : {}),
    worker,
    chromium,
  };
}
