import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';

import AdmZip from 'adm-zip';

import { inspectRuntimePayload, type RuntimePayloadInspection } from './runtime-payload';

export const SMARTPROP_RELEASE_TARGET = {
  id: 'smartprop-existing-host',
  host: {
    ssh_alias: 'smartprop-vps',
    hostname: 'vmi3201429',
    machine_id: 'bfb5b1b8859546f9aac39a4c5bafa616',
    ipv4: '109.123.239.107',
  },
  root: '/opt/smartprop/app/smartprop',
  app: {
    manager: 'pm2',
    name: 'smartprop',
    runtime: 'next-bun',
  },
  worker: {
    manager: 'pm2',
    name: 'scraper-worker',
    runtime: 'pg-boss',
    entrypoint: 'src/lib/queue/scraper-worker.ts',
  },
} as const;

export const SMARTPROP_REQUIRED_APP_INPUTS = [
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

export type SmartPropReleaseTarget = typeof SMARTPROP_RELEASE_TARGET;

export class ReleaseArtifactContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseArtifactContractError';
  }
}

export interface ReleaseArtifactManifest {
  schema_version: 1;
  project_id: 'smartprop';
  source_identity: { kind: 'git'; value: string };
  artifact: {
    name: 'smartprop-source-archive';
    sha256: string;
    size: number;
    entries: Array<{ path: string; sha256: string; size: number }>;
  };
  build_artifact: {
    name: 'smartprop-next-runtime-payload';
    sha256: string;
    size: number;
    build_id: string;
    entries: Array<{ path: string; sha256: string; size: number }>;
  };
  target_identity: SmartPropReleaseTarget;
  build_identity: { kind: 'sha256'; value: string };
  rollback_identity: { kind: 'sha256'; value: string };
}

type ArchiveEntry = ReleaseArtifactManifest['artifact']['entries'][number];

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const FORBIDDEN_FILE_NAMES = new Set([
  'auth.json',
  'cookies.json',
  'credentials.json',
  'session.json',
  'storage-state.json',
]);
const FORBIDDEN_DIRECTORIES = new Set([
  '.auth',
  '.aws',
  '.openclaw',
  '.ssh',
  'auth-state',
  'credentials',
  'secrets',
  'sessions',
  'storage',
]);

function fail(message: string): never {
  throw new ReleaseArtifactContractError(message);
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertExactTarget(actual: unknown, expected: SmartPropReleaseTarget): void {
  if (
    canonicalJson(expected) !== canonicalJson(SMARTPROP_RELEASE_TARGET)
    || canonicalJson(actual) !== canonicalJson(expected)
  ) {
    fail('release manifest target identity does not match the exact SmartProp serving topology');
  }
}

function assertGitCommit(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !GIT_COMMIT.test(value)) {
    fail(`${label} must be an exact lowercase 40-hex Git commit`);
  }
}

function assertSha256Identity(
  value: unknown,
  label: 'build identity' | 'rollback identity',
): asserts value is { kind: 'sha256'; value: string } {
  const identity = value as { kind?: unknown; value?: unknown } | null | undefined;
  if (identity?.kind !== 'sha256' || typeof identity.value !== 'string' || !SHA256.test(identity.value)) {
    fail(`${label} must be an immutable lowercase SHA-256 identity`);
  }
}

function assertSafeArchivePath(path: string): void {
  const parts = path.split('/');
  if (
    path.length === 0
    || path.includes('\\')
    || path.includes('\0')
    || path.startsWith('/')
    || parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    fail(`unsafe archive path: ${path}`);
  }

  const lowerParts = parts.map((part) => part.toLowerCase());
  const fileName = lowerParts.at(-1)!;
  if (
    fileName === '.env'
    || fileName.startsWith('.env.')
    || /\.(?:key|p12|pem|pfx)$/.test(fileName)
    || FORBIDDEN_FILE_NAMES.has(fileName)
    || lowerParts.some((part) => FORBIDDEN_DIRECTORIES.has(part))
  ) {
    fail(`archive contains an environment or authentication artifact: ${path}`);
  }
}

function inspectArchive(archivePath: string): {
  sha256: string;
  size: number;
  entries: ArchiveEntry[];
} {
  let stat;
  let archiveBytes: Buffer;
  try {
    stat = lstatSync(archivePath);
    archiveBytes = readFileSync(archivePath);
  } catch (error) {
    fail(`cannot read release artifact archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail('release artifact archive must be a regular file, not a symlink');
  }

  let zipEntries;
  try {
    zipEntries = new AdmZip(archiveBytes).getEntries();
  } catch (error) {
    fail(`release artifact archive is not a readable ZIP: ${error instanceof Error ? error.message : String(error)}`);
  }

  const seen = new Set<string>();
  const entries: ArchiveEntry[] = [];
  for (const entry of zipEntries) {
    const path = entry.entryName;
    assertSafeArchivePath(path.endsWith('/') ? path.slice(0, -1) : path);
    if (entry.isDirectory) continue;
    if (seen.has(path)) fail(`archive contains duplicate path: ${path}`);
    seen.add(path);

    const unixMode = (entry.attr >>> 16) & 0xf000;
    if (unixMode === 0xa000) {
      fail(`archive contains a symbolic link: ${path}`);
    }
    const content = entry.getData();
    entries.push({ path, sha256: sha256(content), size: content.byteLength });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));

  for (const required of SMARTPROP_REQUIRED_APP_INPUTS) {
    if (!seen.has(required)) fail(`missing required app input: ${required}`);
  }

  return {
    sha256: sha256(archiveBytes),
    size: archiveBytes.byteLength,
    entries,
  };
}

function inspectBuildArtifact(buildArtifactPath: string): RuntimePayloadInspection {
  try {
    return inspectRuntimePayload(buildArtifactPath);
  } catch (error) {
    fail(`invalid Next runtime build artifact: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertSeparateArtifactFiles(archivePath: string, buildArtifactPath: string): void {
  let archiveStat;
  let buildStat;
  try {
    archiveStat = lstatSync(archivePath);
    buildStat = lstatSync(buildArtifactPath);
  } catch (error) {
    fail(`cannot compare source and build artifacts: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (archiveStat.dev === buildStat.dev && archiveStat.ino === buildStat.ino) {
    fail('build artifact must be a separate file from the source archive');
  }
}

export function createReleaseArtifactManifest(options: {
  archivePath: string;
  buildArtifactPath: string;
  sourceCommit: string;
  rollbackIdentity: string;
  target: SmartPropReleaseTarget;
}): ReleaseArtifactManifest {
  assertGitCommit(options.sourceCommit, 'source identity');
  assertSha256Identity({ kind: 'sha256', value: options.rollbackIdentity }, 'rollback identity');
  assertExactTarget(options.target, SMARTPROP_RELEASE_TARGET);
  const artifact = inspectArchive(options.archivePath);
  assertSeparateArtifactFiles(options.archivePath, options.buildArtifactPath);
  const buildArtifact = inspectBuildArtifact(options.buildArtifactPath);

  return {
    schema_version: 1,
    project_id: 'smartprop',
    source_identity: { kind: 'git', value: options.sourceCommit },
    artifact: {
      name: 'smartprop-source-archive',
      ...artifact,
    },
    build_artifact: {
      name: 'smartprop-next-runtime-payload',
      sha256: buildArtifact.sha256,
      size: buildArtifact.size,
      build_id: buildArtifact.buildId,
      entries: buildArtifact.entries,
    },
    target_identity: SMARTPROP_RELEASE_TARGET,
    build_identity: { kind: 'sha256', value: buildArtifact.sha256 },
    rollback_identity: { kind: 'sha256', value: options.rollbackIdentity },
  };
}

export function validateReleaseArtifactManifest(
  manifest: ReleaseArtifactManifest,
  options: {
    archivePath: string;
    buildArtifactPath: string;
    expectedSourceCommit: string;
    expectedTarget: SmartPropReleaseTarget;
  },
): void {
  if (manifest?.schema_version !== 1 || manifest.project_id !== 'smartprop') {
    fail('release artifact manifest schema or project identity is invalid');
  }
  assertGitCommit(options.expectedSourceCommit, 'expected source identity');
  if (
    manifest.source_identity?.kind !== 'git'
    || manifest.source_identity.value !== options.expectedSourceCommit
  ) {
    fail('release artifact source identity does not match the expected Git commit');
  }
  assertExactTarget(manifest.target_identity, options.expectedTarget);
  assertSha256Identity(manifest.build_identity, 'build identity');
  assertSha256Identity(manifest.rollback_identity, 'rollback identity');

  const inspected = inspectArchive(options.archivePath);
  if (manifest.artifact?.name !== 'smartprop-source-archive') {
    fail('release artifact name is invalid');
  }
  if (manifest.artifact.sha256 !== inspected.sha256) {
    fail('release artifact SHA-256 does not match the archive bytes');
  }
  if (manifest.artifact.size !== inspected.size) {
    fail('release artifact size does not match the archive bytes');
  }
  if (canonicalJson(manifest.artifact.entries) !== canonicalJson(inspected.entries)) {
    fail('release artifact entry hashes do not match the archive contents');
  }

  const inspectedBuild = inspectBuildArtifact(options.buildArtifactPath);
  assertSeparateArtifactFiles(options.archivePath, options.buildArtifactPath);
  if (manifest.build_artifact?.name !== 'smartprop-next-runtime-payload') {
    fail('build artifact name is invalid');
  }
  if (manifest.build_artifact.sha256 !== inspectedBuild.sha256) {
    fail('build artifact SHA-256 does not match the build bytes');
  }
  if (manifest.build_artifact.size !== inspectedBuild.size) {
    fail('build artifact size does not match the build bytes');
  }
  if (manifest.build_artifact.build_id !== inspectedBuild.buildId) {
    fail('build artifact BUILD_ID does not match the runtime payload');
  }
  if (canonicalJson(manifest.build_artifact.entries) !== canonicalJson(inspectedBuild.entries)) {
    fail('build artifact entry hashes do not match the runtime payload');
  }
  if (manifest.build_identity.value !== manifest.build_artifact.sha256) {
    fail('build identity does not match the immutable build artifact SHA-256');
  }
}
