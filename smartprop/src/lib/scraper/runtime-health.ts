import fs from 'fs';
import path from 'path';

export type ScraperPlatform = 'propertyguru' | 'edgeprop';

export interface AuthStateStatus {
  platform: ScraperPlatform;
  path: string;
  exists: boolean;
  cookieCount: number;
  originCount: number;
  lastModified: string | null;
  stateAgeHours: number | null;
  isFresh: boolean;
  isAuthenticated: boolean;
  failureReason: string | null;
}

export interface BrowserRuntimeStatus {
  ok: boolean;
  executablePath: string | null;
  error: string | null;
}

export interface FlaresolverrStatus {
  reachable: boolean;
  url: string;
  status: number | null;
  error: string | null;
}

export interface RuntimeHealthReport {
  generatedAt: string;
  cwd: string;
  env: {
    missing: string[];
    present: string[];
  };
  browser: BrowserRuntimeStatus;
  flaresolverr: FlaresolverrStatus;
  auth: Record<ScraperPlatform, AuthStateStatus>;
}

const DEFAULT_AUTH_MAX_AGE_HOURS = 24;

export function getAuthStatePath(platform: ScraperPlatform, cwd: string = process.cwd()): string {
  return path.join(cwd, 'storage', platform === 'propertyguru' ? 'pg.state.json' : 'ep.state.json');
}

export function inspectAuthState(
  platform: ScraperPlatform,
  options?: {
    cwd?: string;
    maxAgeHours?: number;
  }
): AuthStateStatus {
  const cwd = options?.cwd ?? process.cwd();
  const maxAgeHours = options?.maxAgeHours ?? DEFAULT_AUTH_MAX_AGE_HOURS;
  const filePath = getAuthStatePath(platform, cwd);

  if (!fs.existsSync(filePath)) {
    return {
      platform,
      path: filePath,
      exists: false,
      cookieCount: 0,
      originCount: 0,
      lastModified: null,
      stateAgeHours: null,
      isFresh: false,
      isAuthenticated: false,
      failureReason: 'State file not found',
    };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      cookies?: Array<{ name?: string }>;
      origins?: unknown[];
    };
    const stats = fs.statSync(filePath);
    const cookieCount = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
    const originCount = Array.isArray(parsed.origins) ? parsed.origins.length : 0;
    const stateAgeHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    const isFresh = stateAgeHours <= maxAgeHours;

    let failureReason: string | null = null;
    if (cookieCount === 0) {
      failureReason = 'State file has no cookies';
    } else if (!isFresh) {
      failureReason = `State file is stale (${stateAgeHours.toFixed(1)}h old)`;
    }

    return {
      platform,
      path: filePath,
      exists: true,
      cookieCount,
      originCount,
      lastModified: new Date(stats.mtimeMs).toISOString(),
      stateAgeHours,
      isFresh,
      isAuthenticated: cookieCount > 0 && isFresh,
      failureReason,
    };
  } catch (error) {
    return {
      platform,
      path: filePath,
      exists: true,
      cookieCount: 0,
      originCount: 0,
      lastModified: null,
      stateAgeHours: null,
      isFresh: false,
      isAuthenticated: false,
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function normalizeCompletionStatus(status: string | undefined, fallback: 'completed' | 'failed'): 'completed' | 'failed' {
  if (status === 'completed' || status === 'failed') {
    return status;
  }

  return fallback;
}

export function getRequiredScraperEnv(requiredNames: string[] = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE']): {
  missing: string[];
  present: string[];
} {
  const missing: string[] = [];
  const present: string[] = [];

  for (const name of requiredNames) {
    if (process.env[name]) {
      present.push(name);
    } else {
      missing.push(name);
    }
  }

  return { missing, present };
}

export function getBrowserRuntimeStatus(executablePath: string | undefined): BrowserRuntimeStatus {
  const resolvedPath = resolveChromiumExecutablePath(executablePath);

  if (!resolvedPath) {
    return {
      ok: false,
      executablePath: null,
      error: 'Browser executable path is unavailable',
    };
  }

  if (!fs.existsSync(resolvedPath)) {
    return {
      ok: false,
      executablePath: resolvedPath,
      error: `Browser executable not found at ${resolvedPath}`,
    };
  }

  return {
    ok: true,
    executablePath: resolvedPath,
    error: null,
  };
}

export function resolveChromiumExecutablePath(executablePath: string | undefined): string | null {
  const candidates = new Set<string>();

  if (executablePath) {
    candidates.add(executablePath);
  }

  const homeDir = process.env.HOME;
  if (homeDir) {
    const cacheDir = path.join(homeDir, 'Library', 'Caches', 'ms-playwright');
    if (fs.existsSync(cacheDir)) {
      const revisions = fs
        .readdirSync(cacheDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
        .map((entry) => entry.name)
        .sort((a, b) => {
          const aRev = Number.parseInt(a.split('-')[1] || '0', 10);
          const bRev = Number.parseInt(b.split('-')[1] || '0', 10);
          return bRev - aRev;
        });

      for (const revision of revisions) {
        candidates.add(path.join(cacheDir, revision, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
        candidates.add(path.join(cacheDir, revision, 'chrome-linux', 'chrome'));
        candidates.add(path.join(cacheDir, revision, 'chrome-win', 'chrome.exe'));
      }
    }
  }

  candidates.add('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  candidates.add('/Applications/Chromium.app/Contents/MacOS/Chromium');
  candidates.add('/usr/bin/google-chrome');
  candidates.add('/usr/bin/google-chrome-stable');
  candidates.add('/usr/bin/chromium-browser');
  candidates.add('/usr/bin/chromium');

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return executablePath || null;
}

export async function checkFlaresolverr(
  url: string = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1'
): Promise<FlaresolverrStatus> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'sessions.list' }),
      signal: AbortSignal.timeout(5000),
    });

    return {
      reachable: response.ok,
      url,
      status: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      reachable: false,
      url,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
