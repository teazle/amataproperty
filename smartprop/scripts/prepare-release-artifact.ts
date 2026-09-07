import { chmodSync, linkSync, lstatSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  SMARTPROP_RELEASE_TARGET,
  createReleaseArtifactManifest,
  validateReleaseArtifactManifest,
} from '../deploy/manifest';

const GIT_COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class PrepareReleaseArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrepareReleaseArtifactError';
  }
}

export interface PrepareReleaseArtifactOptions {
  repository: string;
  sourceDirectory: string;
  sourceCommit: string;
  sourceArchive: string;
  manifest: string;
  buildArtifact: string;
  rollbackSha256: string;
}

export interface PreparedReleaseArtifact {
  sourceArchive: string;
  manifest: string;
  sourceCommit: string;
}

function fail(message: string): never {
  throw new PrepareReleaseArtifactError(message);
}

function requireExactCommit(value: string): void {
  if (!GIT_COMMIT.test(value)) fail('--source-commit must be an exact lowercase 40-hex Git commit');
}

function requireSha256(value: string): void {
  if (!SHA256.test(value)) fail('--rollback-sha256 must be an immutable lowercase SHA-256');
}

function resolveExistingDirectory(value: string, label: string): string {
  const path = resolve(value);
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real directory, not a symlink`);
  } catch (error) {
    if (error instanceof PrepareReleaseArtifactError) throw error;
    fail(`${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return path;
}

function resolveNewOutput(value: string, label: string): string {
  const path = resolve(value);
  const parent = dirname(path);
  try {
    const parentStat = lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) fail(`${label} parent must be a real directory`);
  } catch (error) {
    if (error instanceof PrepareReleaseArtifactError) throw error;
    fail(`${label} parent cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    lstatSync(path);
    fail(`${label} must not already exist`);
  } catch (error) {
    if (error instanceof PrepareReleaseArtifactError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      fail(`${label} cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return path;
}

function git(repository: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr).trim()
      : String(error);
    fail(`Git source validation failed: ${detail || args.join(' ')}`);
  }
}

function gitRoot(repository: string): string {
  return resolve(git(repository, ['rev-parse', '--show-toplevel']));
}

function sourceTree(repository: string, sourceDirectory: string): string {
  const sourcePath = resolve(repository, sourceDirectory);
  const relativePath = relative(repository, sourcePath);
  if (
    relativePath === '' || relativePath === '.'
  ) return '.';
  if (
    relativePath.startsWith(`..${sep}`)
    || relativePath === '..'
    || relativePath.split(sep).some((part) => part === '' || part === '.' || part === '..')
  ) fail('--source-dir must be a directory inside --repo');
  return relativePath.split(sep).join('/');
}

function assertCommittedTree(repository: string, sourceCommit: string, sourceDirectory: string): string {
  git(repository, ['cat-file', '-e', `${sourceCommit}^{commit}`]);
  const tree = sourceDirectory === '.' ? sourceCommit : `${sourceCommit}:${sourceDirectory}`;
  git(repository, ['cat-file', '-e', `${tree}^{tree}`]);
  return tree;
}

function publishNoClobber(stagedPath: string, destination: string, label: string): void {
  try {
    linkSync(stagedPath, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail(`${label} must not already exist`);
    fail(`${label} cannot be published: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    unlinkSync(stagedPath);
  } catch (error) {
    fail(`${label} was published but staging cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writePrivateManifestAtomically(path: string, content: string): void {
  const staging = mkdtempSync(join(dirname(path), '.release-manifest-'));
  const stagedManifest = join(staging, 'manifest.json');
  try {
    writeFileSync(stagedManifest, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    chmodSync(stagedManifest, 0o600);
    publishNoClobber(stagedManifest, path, '--manifest');
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Creates a source ZIP from one already-committed Git tree and binds it to a
 * separately supplied build artifact and controller-provided rollback digest.
 * It intentionally performs no build, route selection, remote access, or deployment.
 */
export function prepareReleaseArtifact(options: PrepareReleaseArtifactOptions): PreparedReleaseArtifact {
  requireExactCommit(options.sourceCommit);
  requireSha256(options.rollbackSha256);
  const repositoryInput = resolveExistingDirectory(options.repository, '--repo');
  const repository = gitRoot(repositoryInput);
  const sourceDirectory = sourceTree(repository, options.sourceDirectory);
  const sourceArchive = resolveNewOutput(options.sourceArchive, '--source-archive');
  const manifestPath = resolveNewOutput(options.manifest, '--manifest');
  if (sourceArchive === manifestPath) fail('--source-archive and --manifest must be different files');
  if (resolve(options.buildArtifact) === sourceArchive || resolve(options.buildArtifact) === manifestPath) {
    fail('build artifact must be separate from release outputs');
  }

  const tree = assertCommittedTree(repository, options.sourceCommit, sourceDirectory);
  const staging = mkdtempSync(join(dirname(sourceArchive), '.release-source-'));
  const stagedArchive = join(staging, 'source.zip');
  try {
    try {
      execFileSync('git', ['-C', repository, 'archive', '--format=zip', `--output=${stagedArchive}`, tree], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      chmodSync(stagedArchive, 0o600);
    } catch (error) {
      const detail = error instanceof Error && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr).trim()
        : String(error);
      fail(`Git archive creation failed: ${detail || tree}`);
    }

    const releaseManifest = createReleaseArtifactManifest({
      archivePath: stagedArchive,
      buildArtifactPath: options.buildArtifact,
      sourceCommit: options.sourceCommit,
      rollbackIdentity: options.rollbackSha256,
      target: SMARTPROP_RELEASE_TARGET,
    });
    validateReleaseArtifactManifest(releaseManifest, {
      archivePath: stagedArchive,
      buildArtifactPath: options.buildArtifact,
      expectedSourceCommit: options.sourceCommit,
      expectedTarget: SMARTPROP_RELEASE_TARGET,
    });

    publishNoClobber(stagedArchive, sourceArchive, '--source-archive');
    validateReleaseArtifactManifest(releaseManifest, {
      archivePath: sourceArchive,
      buildArtifactPath: options.buildArtifact,
      expectedSourceCommit: options.sourceCommit,
      expectedTarget: SMARTPROP_RELEASE_TARGET,
    });
    writePrivateManifestAtomically(manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  return { sourceArchive, manifest: manifestPath, sourceCommit: options.sourceCommit };
}

function parseArguments(argumentsList: string[]): PrepareReleaseArtifactOptions {
  const values = new Map<string, string>();
  const known = new Set([
    '--repo',
    '--source-dir',
    '--source-commit',
    '--source-archive',
    '--manifest',
    '--build-artifact',
    '--rollback-sha256',
  ]);
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!known.has(flag) || value === undefined || value.startsWith('--') || values.has(flag)) {
      fail('expected each release packaging option exactly once');
    }
    values.set(flag, value);
  }
  const required = (flag: string) => {
    const value = values.get(flag);
    if (!value) fail(`${flag} is required`);
    return value;
  };
  return {
    repository: required('--repo'),
    sourceDirectory: required('--source-dir'),
    sourceCommit: required('--source-commit'),
    sourceArchive: required('--source-archive'),
    manifest: required('--manifest'),
    buildArtifact: required('--build-artifact'),
    rollbackSha256: required('--rollback-sha256'),
  };
}

if (import.meta.main) {
  try {
    const artifact = prepareReleaseArtifact(parseArguments(Bun.argv.slice(2)));
    console.log(JSON.stringify(artifact));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
