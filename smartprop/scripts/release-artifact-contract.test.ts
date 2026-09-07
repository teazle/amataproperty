import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AdmZip from 'adm-zip';

import {
  SMARTPROP_RELEASE_TARGET,
  createReleaseArtifactManifest,
  validateReleaseArtifactManifest,
  type ReleaseArtifactManifest,
  type SmartPropReleaseTarget,
} from '../deploy/manifest';

const sourceCommit = '1'.repeat(40);
const rollbackIdentity = '2'.repeat(64);
const temporaryDirectories: string[] = [];
const requiredFixtureInputs = [
  'bun.lock',
  'ecosystem.config.js',
  'next.config.ts',
  'package-lock.json',
  'package.json',
  'src/instrumentation-node.ts',
  'src/instrumentation.ts',
  'src/lib/queue/scraper-worker.ts',
  'tsconfig.json',
] as const;
const observedTarget = {
  ...SMARTPROP_RELEASE_TARGET,
  host: {
    ssh_alias: 'smartprop-vps',
    hostname: 'vmi3201429',
    machine_id: 'bfb5b1b8859546f9aac39a4c5bafa616',
    ipv4: '109.123.239.107',
  },
} as unknown as SmartPropReleaseTarget;

function makeArchive(entries: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'smartprop-release-contract-'));
  temporaryDirectories.push(directory);
  const archivePath = join(directory, 'smartprop.zip');
  const archive = new AdmZip();

  for (const [index, [path, content]] of Object.entries(entries).entries()) {
    const stagedPath = path.includes('..') ? `unsafe-entry-${index}` : path;
    archive.addFile(stagedPath, Buffer.from(content));
    if (stagedPath !== path) {
      archive.getEntry(stagedPath)!.entryName = path;
    }
  }
  archive.writeZip(archivePath);
  return archivePath;
}

function validEntries(): Record<string, string> {
  return Object.fromEntries(
    requiredFixtureInputs.map((path) => [path, `fixture:${path}\n`]),
  );
}

function makeBuildArtifact(overrides: Record<string, string> = {}): string {
  const directory = mkdtempSync(join(tmpdir(), 'smartprop-build-contract-'));
  temporaryDirectories.push(directory);
  const buildArtifactPath = join(directory, 'next-runtime.zip');
  const archive = new AdmZip();
  for (const [path, content] of Object.entries({
    '.next/BUILD_ID': 'next-build-contract\n',
    '.next/build-manifest.json': '{}',
    '.next/prerender-manifest.json': '{}',
    '.next/routes-manifest.json': '{}',
    '.next/required-server-files.json': '{}',
    '.next/server/app-paths-manifest.json': '{}',
    '.next/server/pages-manifest.json': '{}',
    '.next/server/app/page.js': 'exports.routeModule = {};\n',
    '.next/static/chunks/app.js': 'self.__next_f.push([]);\n',
    ...overrides,
  })) {
    archive.addFile(path, Buffer.from(content));
  }
  archive.writeZip(buildArtifactPath);
  return buildArtifactPath;
}

function validManifest(
  archivePath: string,
  buildArtifactPath = makeBuildArtifact(),
): ReleaseArtifactManifest {
  return createReleaseArtifactManifest({
    archivePath,
    buildArtifactPath,
    sourceCommit,
    rollbackIdentity,
    target: SMARTPROP_RELEASE_TARGET,
  });
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('SmartProp release artifact contract', () => {
  test('binds required app inputs and the archive to exact content hashes', () => {
    const archivePath = makeArchive({
      ...validEntries(),
      'public/release-marker.txt': 'candidate-1\n',
    });
    const buildArtifactPath = makeBuildArtifact();
    const manifest = validManifest(archivePath, buildArtifactPath);

    expect(manifest.source_identity).toEqual({ kind: 'git', value: sourceCommit });
    expect(manifest.target_identity).toEqual(SMARTPROP_RELEASE_TARGET);
    expect(manifest.build_identity).toEqual({
      kind: 'sha256',
      value: manifest.build_artifact.sha256,
    });
    expect(manifest.artifact.entries.map((entry) => entry.path)).toEqual([
      ...requiredFixtureInputs,
      'public/release-marker.txt',
    ].sort());
    expect(() => validateReleaseArtifactManifest(manifest, {
      archivePath,
      buildArtifactPath,
      expectedSourceCommit: sourceCommit,
      expectedTarget: SMARTPROP_RELEASE_TARGET,
    })).not.toThrow();
  });

  test('rejects an archive whose bytes no longer match its manifest', () => {
    const archivePath = makeArchive(validEntries());
    const buildArtifactPath = makeBuildArtifact();
    const manifest = validManifest(archivePath, buildArtifactPath);
    const changedArchivePath = makeArchive({
      ...validEntries(),
      'public/unmanifested.txt': 'changed bytes\n',
    });

    expect(() => validateReleaseArtifactManifest(manifest, {
      archivePath: changedArchivePath,
      buildArtifactPath,
      expectedSourceCommit: sourceCommit,
      expectedTarget: SMARTPROP_RELEASE_TARGET,
    })).toThrow('artifact SHA-256');
  });

  test('rejects an archive that omits bun.lock dependency resolution', () => {
    const missingBunLock = validEntries();
    delete missingBunLock['bun.lock'];

    expect(() => validManifest(makeArchive(missingBunLock))).toThrow(
      'missing required app input: bun.lock',
    );
  });

  test('binds the source archive to a separate validated runtime payload hash', () => {
    const archivePath = makeArchive(validEntries());
    const buildArtifactPath = makeBuildArtifact({ '.next/server/app/page.js': 'compiled Next build v2\n' });
    const manifest = validManifest(archivePath, buildArtifactPath);

    expect(manifest.build_artifact.name).toBe('smartprop-next-runtime-payload');
    expect(manifest.build_artifact.build_id).toBe('next-build-contract');
    expect(manifest.build_identity).toEqual({ kind: 'sha256', value: manifest.build_artifact.sha256 });
    expect(manifest.build_identity.value).not.toBe(manifest.artifact.sha256);
    const tamperedBuildArtifactPath = makeBuildArtifact({ '.next/server/app/page.js': 'tampered compiled build\n' });
    expect(() => validateReleaseArtifactManifest(manifest, {
      archivePath,
      buildArtifactPath: tamperedBuildArtifactPath,
      expectedSourceCommit: sourceCommit,
      expectedTarget: SMARTPROP_RELEASE_TARGET,
    })).toThrow('build artifact SHA-256');
  });

  test('rejects using the source archive itself as the build artifact', () => {
    const archivePath = makeArchive(validEntries());

    expect(() => createReleaseArtifactManifest({
      archivePath,
      buildArtifactPath: archivePath,
      sourceCommit,
      rollbackIdentity,
      target: SMARTPROP_RELEASE_TARGET,
    })).toThrow('separate file');
  });

  test('rejects live browser state', () => {
    expect(() => validManifest(makeArchive({
      ...validEntries(),
      'storage/ep.state.json': '{"cookies":[{"value":"fixture"}]}',
    }))).toThrow('environment or authentication artifact');
  });

  test('rejects a runtime payload without a usable build ID', () => {
    expect(() => validManifest(makeArchive(validEntries()), makeBuildArtifact({ '.next/BUILD_ID': '' })))
      .toThrow('BUILD_ID must not be empty');
  });

  test('binds and revalidates the observed host identity', () => {
    const archivePath = makeArchive(validEntries());
    const buildArtifactPath = makeBuildArtifact();
    const manifest = createReleaseArtifactManifest({
      archivePath,
      buildArtifactPath,
      sourceCommit,
      rollbackIdentity,
      target: observedTarget,
    });

    expect(() => validateReleaseArtifactManifest(manifest, {
      archivePath,
      buildArtifactPath,
      expectedSourceCommit: sourceCommit,
      expectedTarget: observedTarget,
    })).not.toThrow();
    expect(() => validateReleaseArtifactManifest({
      ...manifest,
      target_identity: {
        ...manifest.target_identity,
        host: { ...manifest.target_identity.host, hostname: 'other-host' },
      },
    }, {
      archivePath,
      buildArtifactPath,
      expectedSourceCommit: sourceCommit,
      expectedTarget: observedTarget,
    })).toThrow('target identity');
  });

  test('rejects missing required app inputs and unsafe or auth-bearing paths', () => {
    const missingWorker = validEntries();
    delete missingWorker['src/lib/queue/scraper-worker.ts'];

    expect(() => validManifest(makeArchive(missingWorker))).toThrow(
      'missing required app input: src/lib/queue/scraper-worker.ts',
    );
    expect(() => validManifest(makeArchive({
      ...validEntries(),
      '../outside.txt': 'escape\n',
    }))).toThrow('unsafe archive path');
    expect(() => validManifest(makeArchive({
      ...validEntries(),
      '.env.production': 'SECRET=fixture\n',
    }))).toThrow('environment or authentication artifact');
    expect(() => validManifest(makeArchive({
      ...validEntries(),
      '.auth/session.json': '{}\n',
    }))).toThrow('environment or authentication artifact');
  });

  test('rejects a different target and absent or mutable build and rollback identities', () => {
    const archivePath = makeArchive(validEntries());
    const buildArtifactPath = makeBuildArtifact();
    const manifest = validManifest(archivePath, buildArtifactPath);
    const validate = (candidate: ReleaseArtifactManifest) => validateReleaseArtifactManifest(candidate, {
      archivePath,
      buildArtifactPath,
      expectedSourceCommit: sourceCommit,
      expectedTarget: SMARTPROP_RELEASE_TARGET,
    });

    expect(() => validate({
      ...manifest,
      target_identity: { ...manifest.target_identity, root: '/opt/other' },
    })).toThrow('target identity');
    expect(() => validate({ ...manifest, build_identity: undefined } as unknown as ReleaseArtifactManifest))
      .toThrow('build identity');
    expect(() => validate({
      ...manifest,
      build_identity: { kind: 'sha256', value: 'latest' },
    })).toThrow('build identity');
    expect(() => validate({ ...manifest, rollback_identity: undefined } as unknown as ReleaseArtifactManifest))
      .toThrow('rollback identity');
    expect(() => validate({
      ...manifest,
      rollback_identity: { kind: 'sha256', value: 'previous' },
    })).toThrow('rollback identity');
  });
});
