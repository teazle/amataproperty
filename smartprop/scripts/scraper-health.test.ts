import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectories: string[] = [];
const scriptsDirectory = import.meta.dir;

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'smartprop-scraper-health-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function runHealthCheck(mode: 'failing' | 'healthy') {
  const directory = temporaryDirectory();
  const source = readFileSync(join(scriptsDirectory, 'scraper-health.ts'), 'utf8')
    .replace("import { chromium } from 'playwright';", "import { chromium } from './playwright-fixture';")
    .replace("} from '../src/lib/scraper/runtime-health';", "} from './runtime-health-fixture';");

  writeFileSync(join(directory, 'scraper-health.ts'), source);
  writeFileSync(join(directory, 'playwright-fixture.ts'), "export const chromium = { executablePath: () => '/missing/chromium' };\n");
  writeFileSync(join(directory, 'runtime-health-fixture.ts'), `
const failing = process.env.SCRAPER_HEALTH_FIXTURE_MODE === 'failing';
export const getRequiredScraperEnv = () => failing
  ? ({ missing: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE'], present: [] })
  : ({ missing: [], present: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE'] });
export const getBrowserRuntimeStatus = () => failing
  ? ({ ok: false, executablePath: null, error: 'Browser executable path is unavailable' })
  : ({ ok: true, executablePath: '/fixture/chromium', error: null });
export const checkFlaresolverr = async () => failing
  ? ({ reachable: false, url: 'http://flaresolverr.test/v1', status: null, error: 'connect ECONNREFUSED' })
  : ({ reachable: true, url: 'http://flaresolverr.test/v1', status: 200, error: null });
export const inspectAuthState = (platform: 'propertyguru' | 'edgeprop') => ({
  platform,
  path: '/fixture/' + platform + '.state.json',
  exists: !failing || platform === 'propertyguru',
  cookieCount: !failing || platform === 'propertyguru' ? 1 : 0,
  originCount: 0,
  lastModified: null,
  stateAgeHours: failing && platform === 'propertyguru' ? 48 : 0,
  isFresh: !failing,
  isAuthenticated: !failing,
  failureReason: failing ? (platform === 'propertyguru' ? 'State file is stale (48.0h old)' : 'State file not found') : null,
});
`);

  const child = Bun.spawn({
    cmd: ['bun', join(directory, 'scraper-health.ts')],
    cwd: directory,
    env: { ...process.env, SCRAPER_HEALTH_FIXTURE_MODE: mode },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await child.exited;

  return {
    exitCode,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('scraper health CLI', () => {
  test('writes one JSON report and concise diagnostics for every failing runtime check', async () => {
    const result = await runHealthCheck('failing');

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      env: { missing: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE'] },
      browser: { ok: false },
      flaresolverr: { reachable: false },
      auth: {
        propertyguru: { isAuthenticated: false },
        edgeprop: { isAuthenticated: false },
      },
    });
    expect(result.stderr).toContain('missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE');
    expect(result.stderr).toContain('browser: Browser executable path is unavailable');
    expect(result.stderr).toContain('FlareSolverr: connect ECONNREFUSED');
    expect(result.stderr).toContain('propertyguru auth state: State file is stale (48.0h old)');
    expect(result.stderr).toContain('edgeprop auth state: State file not found');
    expect(result.stderr).not.toContain('injected env');
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
  });

  test('keeps a healthy runtime successful without failure diagnostics', async () => {
    const result = await runHealthCheck('healthy');

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      env: { missing: [] },
      browser: { ok: true },
      flaresolverr: { reachable: true },
      auth: {
        propertyguru: { isAuthenticated: true },
        edgeprop: { isAuthenticated: true },
      },
    });
    expect(result.stderr).toBe('');
  });
});
