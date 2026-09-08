import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildDailyReportBundle } from '../deploy/build-daily-report';

const temporaryDirectories: string[] = [];
const projectRoot = resolve(import.meta.dir, '..');

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'smartprop-daily-report-bundle-'));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('daily report bundle builder', () => {
  test('builds a Bun bundle with a source, lock, and output hash manifest', async () => {
    const outputDirectory = join(temporaryDirectory(), 'bundle');
    const result = await buildDailyReportBundle({ outputDirectory, projectRoot });

    expect(existsSync(result.bundlePath)).toBeTrue();
    expect(lstatSync(result.bundlePath).isFile()).toBeTrue();
    expect(result.manifest.source).toEqual({
      path: 'scripts/smartprop-daily-report.ts',
      sha256: sha256(join(projectRoot, 'scripts/smartprop-daily-report.ts')),
    });
    expect(result.manifest.lock).toEqual({
      path: 'bun.lock',
      sha256: sha256(join(projectRoot, 'bun.lock')),
    });
    expect(result.manifest.outputs).toEqual([{ path: 'report.js', sha256: sha256(result.bundlePath) }]);
    expect(result.manifest.externals.every((specifier) => specifier === 'bun' || specifier.startsWith('node:'))).toBeTrue();
    expect(JSON.parse(readFileSync(result.manifestPath, 'utf8'))).toEqual(result.manifest);
  });

  test('retains the entrypoint main boundary while imports do not run it', async () => {
    const result = await buildDailyReportBundle({ outputDirectory: join(temporaryDirectory(), 'bundle'), projectRoot });

    const unknownFlag = Bun.spawnSync(['bun', result.bundlePath, '--unknown-flag'], { stdout: 'pipe', stderr: 'pipe' });
    expect(unknownFlag.exitCode).toBe(1);
    expect(unknownFlag.stderr.toString()).toContain('Unknown argument: --unknown-flag');

    const imported = Bun.spawnSync(['bun', '-e', 'await import(process.argv[1]); console.log("import-complete")', result.bundlePath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(imported.exitCode).toBe(0);
    expect(imported.stdout.toString().trim()).toBe('import-complete');
  });

  test('rejects regular, symlinked, or nonempty output destinations without overwriting them', async () => {
    const temporary = temporaryDirectory();
    const regularFile = join(temporary, 'regular-file');
    writeFileSync(regularFile, 'keep');
    await expect(buildDailyReportBundle({ outputDirectory: regularFile, projectRoot }))
      .rejects.toThrow('output directory must be a directory');

    const nonemptyDirectory = join(temporary, 'nonempty');
    mkdirSync(nonemptyDirectory);
    const sentinel = join(nonemptyDirectory, 'sentinel');
    writeFileSync(sentinel, 'do not overwrite');
    await expect(buildDailyReportBundle({ outputDirectory: nonemptyDirectory, projectRoot }))
      .rejects.toThrow('output directory must be empty');
    expect(readFileSync(sentinel, 'utf8')).toBe('do not overwrite');

    const symlink = join(temporary, 'symlink');
    symlinkSync(nonemptyDirectory, symlink);
    await expect(buildDailyReportBundle({ outputDirectory: symlink, projectRoot }))
      .rejects.toThrow('output directory must not be a symlink');
  });
});
