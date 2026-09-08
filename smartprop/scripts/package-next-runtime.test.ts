import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import AdmZip from 'adm-zip';

const scriptPath = join(import.meta.dir, 'package-next-runtime.ts');
const temporaryDirectories: string[] = [];
const requiredEntries = {
  '.next/BUILD_ID': 'next-runtime-fixture\n',
  '.next/build-manifest.json': '{}',
  '.next/prerender-manifest.json': '{}',
  '.next/routes-manifest.json': '{}',
  '.next/required-server-files.json': JSON.stringify({ files: [] }),
  '.next/server/app-paths-manifest.json': '{}',
  '.next/server/pages-manifest.json': '{}',
  '.next/server/app/page.js': 'exports.routeModule = {};\n',
  '.next/static/chunks/app.js': 'self.__next_f.push([]);\n',
};

function makeCompletedBuild(overrides: Record<string, string> = {}): { directory: string; nextDirectory: string } {
  const directory = mkdtempSync(join(tmpdir(), 'smartprop-next-runtime-build-'));
  temporaryDirectories.push(directory);
  const entries = { ...requiredEntries, ...overrides };
  for (const [entry, content] of Object.entries(entries)) {
    const path = join(directory, entry);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return { directory, nextDirectory: join(directory, '.next') };
}

function invoke(buildDirectory: string, artifact: string) {
  return Bun.spawnSync({
    cmd: ['bun', scriptPath, '--build-dir', buildDirectory, '--artifact', artifact],
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function directorySnapshot(directory: string): Array<{ path: string; sha256: string }> {
  const snapshot: Array<{ path: string; sha256: string }> = [];
  const visit = (path: string, relativePath: string) => {
    for (const name of readdirSync(path).sort((left, right) => left.localeCompare(right))) {
      const childPath = join(path, name);
      const childRelativePath = relativePath ? `${relativePath}/${name}` : name;
      if (lstatSync(childPath).isDirectory()) {
        visit(childPath, childRelativePath);
      } else {
        snapshot.push({
          path: childRelativePath,
          sha256: createHash('sha256').update(readFileSync(childPath)).digest('hex'),
        });
      }
    }
  };
  visit(directory, '');
  return snapshot;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('package-next-runtime CLI', () => {
  test('packages a completed minimal .next tree and reports its validated identity', () => {
    const { directory, nextDirectory } = makeCompletedBuild();
    const artifact = join(directory, 'next-runtime.zip');

    const result = invoke(nextDirectory, artifact);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      artifact,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      buildId: 'next-runtime-fixture',
      fileCount: Object.keys(requiredEntries).length,
    });
    expect(new AdmZip(artifact).getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName).sort())
      .toEqual(Object.keys(requiredEntries).sort());
    expect(lstatSync(artifact).mode & 0o777).toBe(0o600);
  });

  test('rejects an incomplete .next build before publishing an artifact', () => {
    const { directory, nextDirectory } = makeCompletedBuild();
    const artifact = join(directory, 'next-runtime.zip');
    unlinkSync(join(nextDirectory, 'BUILD_ID'));

    const result = invoke(nextDirectory, artifact);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('missing required Next runtime payload entry: .next/BUILD_ID');
    expect(existsSync(artifact)).toBeFalse();
  });

  test('rejects symlinked build input before publishing an artifact', () => {
    const { directory, nextDirectory } = makeCompletedBuild();
    const artifact = join(directory, 'next-runtime.zip');
    symlinkSync('app/page.js', join(nextDirectory, 'server', 'linked.js'));

    const result = invoke(nextDirectory, artifact);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('must not contain symbolic links');
    expect(existsSync(artifact)).toBeFalse();
  });

  test('omits normal build-only state without changing the completed .next input', () => {
    const { directory, nextDirectory } = makeCompletedBuild({
      '.next/cache/webpack/state.pack': 'cache state\n',
      '.next/diagnostics/build.json': '{}',
      '.next/types/app/page.ts': 'type BuildOnly = true;\n',
      '.next/trace': 'trace state\n',
    });
    const artifact = join(directory, 'next-runtime.zip');
    const before = directorySnapshot(nextDirectory);

    const result = invoke(nextDirectory, artifact);

    expect(result.exitCode).toBe(0);
    expect(directorySnapshot(nextDirectory)).toEqual(before);
    expect(new AdmZip(artifact).getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName).sort())
      .toEqual(Object.keys(requiredEntries).sort());
  });

  test('rejects unsupported runtime content instead of publishing it', () => {
    const { directory, nextDirectory } = makeCompletedBuild({ '.next/unrecognized-runtime.js': 'unsupported\n' });
    const artifact = join(directory, 'next-runtime.zip');

    const result = invoke(nextDirectory, artifact);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('unsupported .next content');
    expect(existsSync(artifact)).toBeFalse();
  });

  test('never overwrites a runtime artifact destination', () => {
    const { directory, nextDirectory } = makeCompletedBuild();
    const artifact = join(directory, 'next-runtime.zip');
    const original = 'existing runtime artifact\n';
    writeFileSync(artifact, original);

    const result = invoke(nextDirectory, artifact);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('--artifact must not already exist');
    expect(readFileSync(artifact, 'utf8')).toBe(original);
  });
});
