import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AdmZip from 'adm-zip';

import {
  SMARTPROP_RELEASE_TARGET,
  SMARTPROP_REQUIRED_APP_INPUTS,
  createReleaseArtifactManifest,
  validateReleaseArtifactManifest,
  type ReleaseArtifactManifest,
} from '../deploy/manifest';

const sourceCommit = '1'.repeat(40);
const rollbackIdentity = '2'.repeat(64);
const temporaryDirectories: string[] = [];

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
    SMARTPROP_REQUIRED_APP_INPUTS.map((path) => [path, `fixture:${path}\n`]),
  );
}

function validManifest(archivePath: string): ReleaseArtifactManifest {
  return createReleaseArtifactManifest({
    archivePath,
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
    const manifest = validManifest(archivePath);

    expect(manifest.source_identity).toEqual({ kind: 'git', value: sourceCommit });
    expect(manifest.target_identity).toEqual(SMARTPROP_RELEASE_TARGET);
    expect(manifest.build_identity).toEqual({
      kind: 'sha256',
      value: manifest.artifact.sha256,
    });
    expect(manifest.artifact.entries.map((entry) => entry.path)).toEqual([
      ...SMARTPROP_REQUIRED_APP_INPUTS,
      'public/release-marker.txt',
    ].sort());
    expect(() => validateReleaseArtifactManifest(manifest, {
      archivePath,
      expectedSourceCommit: sourceCommit,
      expectedTarget: SMARTPROP_RELEASE_TARGET,
    })).not.toThrow();
  });

  test('rejects an archive whose bytes no longer match its manifest', () => {
    const archivePath = makeArchive(validEntries());
    const manifest = validManifest(archivePath);
    const changedArchivePath = makeArchive({
      ...validEntries(),
      'public/unmanifested.txt': 'changed bytes\n',
    });

    expect(() => validateReleaseArtifactManifest(manifest, {
      archivePath: changedArchivePath,
      expectedSourceCommit: sourceCommit,
      expectedTarget: SMARTPROP_RELEASE_TARGET,
    })).toThrow('artifact SHA-256');
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
    const manifest = validManifest(archivePath);
    const validate = (candidate: ReleaseArtifactManifest) => validateReleaseArtifactManifest(candidate, {
      archivePath,
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
