import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  parseArticleContentBackfillLimit,
  selectArticlesMissingContent,
} from '../src/lib/scraper/article-content-backfill';

const smartpropRoot = resolve(import.meta.dir, '..');
const cliScript = join(smartpropRoot, 'scripts', 'run-article-scrape.ts');
const cliPreload = join(smartpropRoot, 'scripts', 'fixtures', 'run-article-scrape-preload.ts');

async function runArticleCliFixture(mode: 'success' | 'error') {
  const cwd = mkdtempSync(join(import.meta.dir, '.article-cli-'));
  const fixtureScript = join(cwd, 'run-article-scrape.ts');
  const fixtureModuleUrl = new URL(`file://${cliPreload}`).href;
  const source = readFileSync(cliScript, 'utf8')
    .replaceAll("import('../src/lib/db/articles')", `import(${JSON.stringify(fixtureModuleUrl)})`)
    .replaceAll("import('../src/lib/scraper/article-content-backfill')", `import(${JSON.stringify(fixtureModuleUrl)})`)
    .replaceAll("import('../src/lib/scraper/edgeprop-scraper')", `import(${JSON.stringify(fixtureModuleUrl)})`);
  writeFileSync(fixtureScript, source);
  const child = Bun.spawn({
    cmd: ['bun', '--preload', cliPreload, fixtureScript],
    cwd,
    env: {
      ...process.env,
      ARTICLE_CLI_FIXTURE_MODE: mode,
      ARTICLE_SCRAPE_METHOD: 'metadata',
      ARTICLE_SCRAPE_PAGES: '1',
      ARTICLE_SCRAPE_MAX_ARTICLES: '5',
      ARTICLE_CONTENT_BACKFILL_LIMIT: '4',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:59998',
      SUPABASE_SERVICE_ROLE: 'local-fixture-service-role',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timeout = Symbol('timeout');
  const result = await Promise.race([
    child.exited,
    Bun.sleep(2_000).then(() => timeout),
  ]);

  if (result === timeout) child.kill('SIGKILL');
  await child.exited.catch(() => undefined);

  return {
    cwd,
    exitCode: result,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
}

describe('article content backfill helpers', () => {
  test('selects only scraped articles without content up to the limit', () => {
    const missing = selectArticlesMissingContent(
      [
        { id: 'article-1', nid: '1', title: 'One', path: '/one' },
        { id: 'article-2', nid: '2', title: 'Two', path: '/two' },
        { id: 'article-3', nid: '3', title: 'Three', path: '/three' },
      ],
      new Set(['article-2']),
      1,
    );

    expect(missing).toEqual([
      { id: 'article-1', nid: '1', title: 'One', path: '/one' },
    ]);
  });

  test('parses all and zero backfill limits', () => {
    expect(parseArticleContentBackfillLimit('all')).toBeUndefined();
    expect(parseArticleContentBackfillLimit('0')).toBe(0);
  });

  test('defaults to four articles while retaining an explicit limit', () => {
    expect(parseArticleContentBackfillLimit(undefined)).toBe(4);
    expect(parseArticleContentBackfillLimit('9')).toBe(9);
  });

  test('leaves the entrypoint backfill limit unset so the bounded parser default applies', () => {
    const fixtureDirectory = mkdtempSync(join(import.meta.dir, '.entrypoint-config-'));
    const fixturePath = join(fixtureDirectory, 'run-article-scrape.ts');
    const source = readFileSync(join(import.meta.dir, 'run-article-scrape.ts'), 'utf8')
      .replace(/\nmain\(\)\s*\.(?:then|catch)\([\s\S]*$/, '\nconsole.log(contentBackfillLimitArg ?? "unset");\n');
    writeFileSync(fixturePath, source);

    try {
      const result = Bun.spawnSync({
        cmd: ['bun', fixturePath],
        cwd: fixtureDirectory,
        env: { ...process.env, ARTICLE_CONTENT_BACKFILL_LIMIT: '' },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim().split('\n').at(-1)).toBe('unset');
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  test('article CLI exits after saving a completed session and releasing its lock despite a retained runtime handle', async () => {
    const result = await runArticleCliFixture('success');
    try {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[articles] completed session fixture-session');
      expect(readFileSync(join(result.cwd, 'fixture-scraper.json'), 'utf8')).toBe('completed');
      expect(JSON.parse(readFileSync(join(result.cwd, 'fixture-session.json'), 'utf8')).status).toBe('error');
      expect(existsSync(join(result.cwd, 'storage', 'article-scraper.lock'))).toBe(false);
    } finally {
      rmSync(result.cwd, { recursive: true, force: true });
    }
  });

  test('article CLI exits one and releases its lock when the bounded batch fails', async () => {
    const result = await runArticleCliFixture('error');
    try {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('fixture backfill failure');
      expect(JSON.parse(readFileSync(join(result.cwd, 'fixture-session.json'), 'utf8')).status).toBe('error');
      expect(existsSync(join(result.cwd, 'storage', 'article-scraper.lock'))).toBe(false);
    } finally {
      rmSync(result.cwd, { recursive: true, force: true });
    }
  });
});
