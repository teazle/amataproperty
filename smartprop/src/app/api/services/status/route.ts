import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';

interface ServiceStatus {
  flaresolverr: {
    online: boolean;
    ready: boolean;
    error?: string;
  };
  waha: {
    online: boolean;
    ready: boolean;
    sessionStatus?: string;
    error?: string;
  };
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
        const data = await response.json();
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
  } catch (error: unknown) {
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
 * Check WAHA status
 */
async function checkWAHA(): Promise<ServiceStatus['waha']> {
  const wahaUrl = process.env.WAHA_URL || 'http://localhost:3030';
  const wahaSession = process.env.WAHA_SESSION || 'default';
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    // Check if WAHA API is accessible
    const sessionsResponse = await fetch(`${wahaUrl}/api/sessions`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!sessionsResponse.ok) {
      return {
        online: false,
        ready: false,
        error: `HTTP ${sessionsResponse.status}`,
      };
    }
    
    // Check specific session status
    const sessionController = new AbortController();
    const sessionTimeoutId = setTimeout(() => sessionController.abort(), 5000);
    
    try {
      const sessionResponse = await fetch(`${wahaUrl}/api/sessions/${wahaSession}`, {
        signal: sessionController.signal,
      });
      
      clearTimeout(sessionTimeoutId);
      
      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        const sessionStatus = sessionData?.status;
        const isConnected = sessionStatus === 'WORKING' ||
          Boolean(sessionData?.me?.id && sessionData?.engine?.state === 'CONNECTED');
        return {
          online: true,
          ready: isConnected,
          sessionStatus: sessionStatus || 'unknown',
          error: !isConnected ? `Session status: ${sessionStatus}` : undefined,
        };
      } else {
        return {
          online: true,
          ready: false,
          error: `Session check failed: HTTP ${sessionResponse.status}`,
        };
      }
    } catch (sessionError: unknown) {
      clearTimeout(sessionTimeoutId);
      if (sessionError instanceof Error && sessionError.name === 'AbortError') {
        return {
          online: true,
          ready: false,
          error: 'Session check timeout',
        };
      }
      return {
        online: true,
        ready: false,
        error: sessionError instanceof Error ? sessionError.message : 'Unknown error',
      };
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        online: false,
        ready: false,
        error: 'Connection timeout',
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
  } catch (error: unknown) {
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
  } catch (error: unknown) {
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
export async function GET(request: NextRequest) {
  try {
    // Check all services in parallel
    const [flaresolverr, waha, worker, chromium] = await Promise.all([
      checkFlareSolverr(),
      checkWAHA(),
      Promise.resolve(checkWorker()),
      Promise.resolve(countChromiumProcesses()),
    ]);
    
    const status: ServiceStatus = {
      flaresolverr,
      waha,
      worker,
      chromium,
    };
    
    return NextResponse.json(status, { status: 200 });
  } catch (error: unknown) {
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
