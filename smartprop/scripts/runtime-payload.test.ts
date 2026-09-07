import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import AdmZip from 'adm-zip';

import { inspectRuntimePayload } from '../deploy/runtime-payload';

const temporaryDirectories: string[] = [];
const requiredPayloadEntries = [
  '.next/BUILD_ID',
  '.next/build-manifest.json',
  '.next/prerender-manifest.json',
  '.next/routes-manifest.json',
  '.next/required-server-files.json',
  '.next/server/app-paths-manifest.json',
  '.next/server/pages-manifest.json',
] as const;

function validPayloadEntries(): Record<string, string> {
  return {
    '.next/BUILD_ID': 'next-build-123\n',
    '.next/build-manifest.json': '{}',
    '.next/prerender-manifest.json': '{}',
    '.next/routes-manifest.json': '{}',
    '.next/required-server-files.json': '{}',
    '.next/server/app-paths-manifest.json': '{}',
    '.next/server/pages-manifest.json': '{}',
    '.next/server/app/page.js': 'exports.routeModule = {};\n',
    '.next/static/chunks/app.js': 'self.__next_f.push([]);\n',
  };
}

function makePayload(entries: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'smartprop-runtime-payload-'));
  temporaryDirectories.push(directory);
  const archivePath = join(directory, 'runtime.zip');
  const archive = new AdmZip();
  for (const [index, [path, content]] of Object.entries(entries).entries()) {
    const stagedPath = path.includes('..') ? `staged-${index}` : path;
    archive.addFile(stagedPath, Buffer.from(content));
    if (stagedPath !== path) archive.getEntry(stagedPath)!.entryName = path;
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
    expect(inspection.entries.map((entry) => entry.path)).toEqual([
      ...requiredPayloadEntries,
      '.next/server/app/page.js',
      '.next/static/chunks/app.js',
    ].sort());
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
    }))).toThrow('cache');
    expect(() => inspectRuntimePayload(makePayload({
      ...validPayloadEntries(),
      '.next/.env.production': 'SECRET=fixture',
    }))).toThrow('environment or authentication artifact');
    expect(() => inspectRuntimePayload(makePayload({
      ...validPayloadEntries(),
      '../outside.js': 'escape',
    }))).toThrow('unsafe runtime payload path');
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
