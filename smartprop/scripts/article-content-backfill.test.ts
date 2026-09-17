import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseArticleContentBackfillLimit,
  selectArticlesMissingContent,
} from '../src/lib/scraper/article-content-backfill';

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
      .replace(/main\(\)\.catch\([\s\S]*$/, 'console.log(contentBackfillLimitArg ?? "unset");\n');
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
});
