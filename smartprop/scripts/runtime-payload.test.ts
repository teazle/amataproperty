import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import AdmZip from 'adm-zip';

import { inspectRuntimePayload } from '../deploy/runtime-payload';

const temporaryDirectories: string[] = [];
const requiredServerFiles = [
  '.next/routes-manifest.json',
  '.next/server/pages-manifest.json',
  '.next/build-manifest.json',
  '.next/prerender-manifest.json',
  '.next/server/functions-config-manifest.json',
  '.next/server/middleware-manifest.json',
  '.next/server/middleware-build-manifest.js',
  '.next/server/middleware-react-loadable-manifest.js',
  '.next/react-loadable-manifest.json',
  '.next/server/app-paths-manifest.json',
  '.next/app-path-routes-manifest.json',
  '.next/app-build-manifest.json',
  '.next/server/server-reference-manifest.js',
  '.next/server/server-reference-manifest.json',
  '.next/BUILD_ID',
  '.next/server/next-font-manifest.js',
  '.next/server/next-font-manifest.json',
  '.next/required-server-files.json',
  '.next/server/instrumentation.js',
] as const;

function validPayloadEntries(): Record<string, string> {
  const entries: Record<string, string> = {
    '.next/BUILD_ID': 'next-build-123\n',
    '.next/build-manifest.json': '{}',
    '.next/prerender-manifest.json': '{}',
    '.next/routes-manifest.json': '{}',
    '.next/server/app-paths-manifest.json': '{}',
    '.next/server/pages-manifest.json': '{}',
    '.next/server/app/page.js': 'exports.routeModule = {};\n',
    '.next/static/chunks/app.js': 'self.__next_f.push([]);\n',
  };
  for (const path of requiredServerFiles) {
    entries[path] ??= path.endsWith('.json') ? '{}' : 'runtime metadata\n';
  }
  entries['.next/required-server-files.json'] = JSON.stringify({ files: requiredServerFiles });
  return entries;
}

function makePayload(entries: Record<string, string>): string {
  return makePayloadEntries(Object.entries(entries));
}

function makePayloadEntries(entries: Array<[string, string]>, directories: string[] = [], directoriesLast = false): string {
  const directory = mkdtempSync(join(tmpdir(), 'smartprop-runtime-payload-'));
  temporaryDirectories.push(directory);
  const archivePath = join(directory, 'runtime.zip');
  const archive = new AdmZip({ noSort: true });
  for (const path of directoriesLast ? [] : directories) {
    archive.addFile(`${path}/`, Buffer.alloc(0));
  }
  for (const [index, [path, content]] of entries.entries()) {
    const stagedPath = path.includes('..') ? `staged-${index}` : path;
    archive.addFile(stagedPath, Buffer.from(content));
    if (stagedPath !== path) archive.getEntry(stagedPath)!.entryName = path;
  }
  for (const path of directoriesLast ? directories : []) {
    archive.addFile(`${path}/`, Buffer.alloc(0));
  }
  archive.writeZip(archivePath);
  return archivePath;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('runtime payload inspection', () => {
  test('inspects a practical Next 15 server/static ZIP with a nonempty build identity', () => {
    const inspection = inspectRuntimePayload(makePayload(validPayloadEntries()));

    expect(inspection.buildId).toBe('next-build-123');
    expect(inspection.entries.map((entry) => entry.path)).toEqual(
      Object.keys(validPayloadEntries()).sort((left, right) => left.localeCompare(right)),
    );
    expect(inspection.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(inspection.size).toBeGreaterThan(0);
  });

  test('rejects opaque or structurally incomplete build inputs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'smartprop-runtime-opaque-'));
    temporaryDirectories.push(directory);
    const opaque = join(directory, 'opaque.tar');
    writeFileSync(opaque, 'opaque compiled build bytes\n');

    expect(() => inspectRuntimePayload(opaque)).toThrow('not a readable ZIP');
    const incomplete = validPayloadEntries();
    delete incomplete['.next/BUILD_ID'];
    expect(() => inspectRuntimePayload(makePayload(incomplete))).toThrow('missing required Next runtime payload entry: .next/BUILD_ID');
  });

  test('rejects empty build IDs and unsafe payload paths', () => {
    expect(() => inspectRuntimePayload(makePayload({
      ...validPayloadEntries(),
      '.next/BUILD_ID': ' \n',
    }))).toThrow('BUILD_ID must not be empty');
    expect(() => inspectRuntimePayload(makePayload({
      ...validPayloadEntries(),
      '.next/cache/webpack/client-production.pack': 'cache',
    }))).toThrow('excluded build-state content');
    expect(() => inspectRuntimePayload(makePayload({
      ...validPayloadEntries(),
      '.next/types/app/page.ts': 'type BuildOnly = true;',
    }))).toThrow('excluded build-state content');
    expect(() => inspectRuntimePayload(makePayload({
      ...validPayloadEntries(),
      '.next/trace': 'trace data',
    }))).toThrow('excluded build-state content');
    expect(() => inspectRuntimePayload(makePayload({
      ...validPayloadEntries(),
      '.next/diagnostics/build.json': '{}',
    }))).toThrow('excluded build-state content');
    expect(() => inspectRuntimePayload(makePayload({
      ...validPayloadEntries(),
      '.next/.env.production': 'SECRET=fixture',
    }))).toThrow('environment or authentication artifact');
    expect(() => inspectRuntimePayload(makePayload({
      ...validPayloadEntries(),
      '../outside.js': 'escape',
    }))).toThrow('unsafe runtime payload path');
  });

  test('rejects files at reserved directory paths and file ancestor conflicts in either ZIP order', () => {
    for (const reservedDirectory of ['.next', '.next/server', '.next/static']) {
      expect(() => inspectRuntimePayload(makePayload({
        ...validPayloadEntries(),
        [reservedDirectory]: 'regular file',
      }))).toThrow(`reserved runtime directory must be an explicit directory: ${reservedDirectory}`);
    }

    const base = validPayloadEntries();
    delete base['.next/server/app/page.js'];
    const descendant = ['.next/server/app/page.js', 'compiled route'] as [string, string];
    const ancestor = ['.next/server/app', 'regular file'] as [string, string];
    expect(() => inspectRuntimePayload(makePayloadEntries([
      ...Object.entries(base),
      ancestor,
      descendant,
    ]))).toThrow('runtime payload file conflicts with ancestor or descendant: .next/server/app');
    expect(() => inspectRuntimePayload(makePayloadEntries([
      ...Object.entries(base),
      descendant,
      ancestor,
    ]))).toThrow('runtime payload file conflicts with ancestor or descendant: .next/server/app');

    expect(() => inspectRuntimePayload(makePayloadEntries(
      Object.entries(validPayloadEntries()),
      ['.next', '.next/server', '.next/static'],
    ))).not.toThrow();
    expect(() => inspectRuntimePayload(makePayloadEntries(
      Object.entries(validPayloadEntries()),
      ['.next', '.next/server', '.next/static', '.next/server/app'],
      true,
    ))).not.toThrow();
  });

  test('requires every safe declared Next runtime file while accepting actual root metadata', () => {
    const missingDeclared = validPayloadEntries();
    missingDeclared['.next/required-server-files.json'] = JSON.stringify({
      files: [...requiredServerFiles, '.next/server/missing-runtime.js'],
    });
    expect(() => inspectRuntimePayload(makePayload(missingDeclared)))
      .toThrow('declared Next runtime file is missing: .next/server/missing-runtime.js');

    const malformedManifest = validPayloadEntries();
    malformedManifest['.next/required-server-files.json'] = JSON.stringify({ files: [42] });
    expect(() => inspectRuntimePayload(makePayload(malformedManifest)))
      .toThrow('required-server-files.json must contain a non-null object with a string files array');

    const nullManifest = validPayloadEntries();
    nullManifest['.next/required-server-files.json'] = 'null';
    expect(() => inspectRuntimePayload(makePayload(nullManifest)))
      .toThrow('required-server-files.json must contain a non-null object with a string files array');

    const unsafeDeclaration = validPayloadEntries();
    unsafeDeclaration['.next/required-server-files.json'] = JSON.stringify({ files: ['../outside.js'] });
    expect(() => inspectRuntimePayload(makePayload(unsafeDeclaration)))
      .toThrow('unsafe runtime payload path: ../outside.js');

    expect(() => inspectRuntimePayload(makePayload({
      ...validPayloadEntries(),
      '.next/package.json': '{}',
      '.next/images-manifest.json': '{}',
      '.next/export-marker.json': '{}',
      '.next/next-minimal-server.js.nft.json': '{}',
      '.next/next-server.js.nft.json': '{}',
    }))).not.toThrow();
  });

  test('binds the inspection signature to exact ZIP bytes and rejects duplicate entries', () => {
    const first = inspectRuntimePayload(makePayload(validPayloadEntries()));
    const second = inspectRuntimePayload(makePayload({
      ...validPayloadEntries(),
      '.next/static/chunks/app.js': 'changed payload bytes\n',
    }));
    expect(second.sha256).not.toBe(first.sha256);

    const duplicate = makePayload(validPayloadEntries());
    const archive = new AdmZip(duplicate);
    archive.addFile('.next/duplicate-build-id', Buffer.from('duplicate\n'));
    archive.getEntry('.next/duplicate-build-id')!.entryName = '.next/BUILD_ID';
    archive.writeZip(duplicate);
    expect(() => inspectRuntimePayload(duplicate)).toThrow('duplicate runtime payload path');

    const symbolicLinkDirectory = mkdtempSync(join(tmpdir(), 'smartprop-runtime-symlink-'));
    temporaryDirectories.push(symbolicLinkDirectory);
    const payloadDirectory = join(symbolicLinkDirectory, 'payload');
    for (const [path, content] of Object.entries(validPayloadEntries())) {
      const sourcePath = join(payloadDirectory, path);
      mkdirSync(dirname(sourcePath), { recursive: true });
      writeFileSync(sourcePath, content);
    }
    symlinkSync('app/page.js', join(payloadDirectory, '.next/server/link.js'));
    const symbolicLink = join(symbolicLinkDirectory, 'runtime.zip');
    const zipResult = Bun.spawnSync(['zip', '-q', '-y', '-r', symbolicLink, '.next'], {
      cwd: payloadDirectory,
    });
    expect(zipResult.exitCode).toBe(0);
    expect(() => inspectRuntimePayload(symbolicLink)).toThrow('runtime payload contains a symbolic link');
  });
});
