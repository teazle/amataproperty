import { execSync } from 'child_process';
import { NextRequest,NextResponse } from 'next/server';
import { getMessagingProviderHealth, type MessagingProviderHealth } from '@/lib/wa/provider-health';

export interface ServiceStatus {
  flaresolverr: {
    online: boolean;
    ready: boolean;
    error?: string;
  };
  messaging: MessagingProviderHealth;
  waha?: MessagingProviderHealth;
  worker: {
    up: boolean;
    processCount?: number;
    error?: string;
  };
  chromium: {
    processCount: number;
    error?: string;
  };
}

/**
 * Check FlareSolverr status
 */
async function checkFlareSolverr(): Promise<ServiceStatus['flaresolverr']> {
  const flaresolverrUrl = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    // Try to list sessions as a health check
    const response = await fetch(flaresolverrUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cmd: 'sessions.list',
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      try {
        const _data = await response.json();
        // If we get a valid response (even if empty), FlareSolverr is online and ready
        return {
          online: true,
          ready: true,
        };
      } catch (parseError) {
        // Response is OK but not JSON - still consider it online
        return {
          online: true,
          ready: true,
        };
      }
    } else {
      return {
        online: true,
        ready: false,
        error: `HTTP ${response.status}`,
      };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        online: false,
        ready: false,
        error: 'Connection timeout',
      };
    }
    // Check for connection errors
    if (error instanceof Error && (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed'))) {
      return {
        online: false,
        ready: false,
        error: 'Service not reachable',
      };
    }
    return {
      online: false,
      ready: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check worker status (scraper worker process)
 */
function checkWorker(): ServiceStatus['worker'] {
  try {
    // Check for scraper worker process
    // Look for processes running scraper-worker.ts specifically (not just any worker.ts)
    const workerProcesses = execSync(
      "ps aux | grep -E '(scraper-worker\.ts|scraper-worker|src/lib/queue/scraper-worker)' | grep -v grep || true",
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    ).trim();
    
    // Also check for pg-boss worker processes
    const pgBossProcesses = execSync(
      "ps aux | grep -E 'pg-boss|pgboss' | grep -v grep || true",
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    ).trim();
    
    const workerCount = workerProcesses ? workerProcesses.split('\n').filter(line => line.trim()).length : 0;
    const pgBossCount = pgBossProcesses ? pgBossProcesses.split('\n').filter(line => line.trim()).length : 0;
    const totalCount = workerCount + pgBossCount;
    
    return {
      up: totalCount > 0,
      processCount: totalCount,
    };
  } catch (error) {
    return {
      up: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Count Chromium processes (only actual browser instances, not MCP servers or IDE processes)
 */
function countChromiumProcesses(): ServiceStatus['chromium'] {
  try {
    // Count only actual Playwright-launched Chromium browser instances
    // Exclude: MCP servers, Cursor IDE processes, crashpad handlers, and other false positives
    const chromiumProcesses = execSync(
      "ps aux | grep -E '(chromium|chrome|playwright)' | grep -v grep | grep -v 'mcp-server' | grep -v 'chrome-devtools-mcp' | grep -v 'chrome_crashpad_handler' | grep -v 'Electron Framework' | grep -v 'Cursor.app' | grep -E '(--remote-debugging|\.cache/ms-playwright|/chromium|playwright.*chromium)' || true",
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    ).trim();
    
    // If the filtered grep returns nothing, try a more specific check for actual browser processes
    let processCount = 0;
    if (chromiumProcesses) {
      const lines = chromiumProcesses.split('\n').filter(line => {
        const trimmed = line.trim();
        // Only count processes that look like actual browser instances
        return trimmed && (
          trimmed.includes('--remote-debugging') ||
          trimmed.includes('.cache/ms-playwright') ||
          trimmed.includes('/chromium') ||
          (trimmed.includes('playwright') && trimmed.includes('chromium'))
        );
      });
      processCount = lines.length;
    }
    
    return {
      processCount,
    };
  } catch (error) {
    return {
      processCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /api/services/status
 * Returns status of all important services
 */
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

export async function GET(_request: NextRequest) {
  try {
    return NextResponse.json(await getServiceStatus(), { status: 200 });
  } catch (error) {
    console.error('Error checking service status:', error);
    return NextResponse.json(
      {
        error: 'Failed to check service status',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
