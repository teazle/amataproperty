import { chmodSync, linkSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import AdmZip from 'adm-zip';

import { inspectRuntimePayload } from '../deploy/runtime-payload';

const NORMAL_BUILD_ONLY_ROOTS = new Set(['cache', 'diagnostics', 'trace', 'types']);

export class PackageNextRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageNextRuntimeError';
  }
}

export interface PackageNextRuntimeOptions {
  buildDirectory: string;
  artifact: string;
}

export interface PackagedNextRuntime {
  artifact: string;
  sha256: string;
  buildId: string;
  fileCount: number;
}

function fail(message: string): never {
  throw new PackageNextRuntimeError(message);
}

function resolveExistingBuildDirectory(value: string): string {
  const path = resolve(value);
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail('--build-dir must be a real .next directory, not a symlink');
    }
  } catch (error) {
    if (error instanceof PackageNextRuntimeError) throw error;
    fail(`--build-dir cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return path;
}

function resolveNewArtifact(value: string): string {
  const path = resolve(value);
  const parent = dirname(path);
  try {
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('--artifact parent must be a real directory');
  } catch (error) {
    if (error instanceof PackageNextRuntimeError) throw error;
    fail(`--artifact parent cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    lstatSync(path);
    fail('--artifact must not already exist');
  } catch (error) {
    if (error instanceof PackageNextRuntimeError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      fail(`--artifact cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return path;
}

function isNormalBuildOnlyPath(relativePath: string): boolean {
  return NORMAL_BUILD_ONLY_ROOTS.has(relativePath.split('/')[0]!);
}

function addDirectory(archive: AdmZip, root: string, directory: string): void {
  const directoryStat = lstatSync(directory);
  const directoryPath = relative(root, directory);
  if (directoryStat.isSymbolicLink()) fail(`--build-dir must not contain symbolic links: ${directoryPath || '.'}`);
  if (!directoryStat.isDirectory()) fail(`--build-dir contains a non-directory path: ${directoryPath || '.'}`);

  const archiveDirectory = directoryPath === '' ? '.next' : `.next/${directoryPath}`;
  archive.addFile(`${archiveDirectory}/`, Buffer.alloc(0));
  for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
    const path = join(directory, name);
    const relativePath = relative(root, path);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail(`--build-dir must not contain symbolic links: ${relativePath}`);
    if (stat.isDirectory()) {
      if (isNormalBuildOnlyPath(relativePath)) continue;
      addDirectory(archive, root, path);
      continue;
    }
    if (!stat.isFile()) fail(`--build-dir contains a non-regular file: ${relativePath}`);
    if (isNormalBuildOnlyPath(relativePath)) continue;
    archive.addFile(`.next/${relativePath}`, readFileSync(path));
  }
}

function publishNoClobber(stagedPath: string, artifact: string): void {
  try {
    linkSync(stagedPath, artifact);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('--artifact must not already exist');
    fail(`--artifact cannot be published: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    unlinkSync(stagedPath);
  } catch (error) {
    fail(`--artifact was published but staging cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Packages an already-completed `.next` tree; it never invokes a build. */
export function packageNextRuntime(options: PackageNextRuntimeOptions): PackagedNextRuntime {
  const buildDirectory = resolveExistingBuildDirectory(options.buildDirectory);
  const artifact = resolveNewArtifact(options.artifact);
  const staging = mkdtempSync(join(dirname(artifact), '.next-runtime-'));
  const stagedArtifact = join(staging, 'runtime.zip');
  try {
    const archive = new AdmZip();
    addDirectory(archive, buildDirectory, buildDirectory);
    archive.writeZip(stagedArtifact);
    chmodSync(stagedArtifact, 0o600);
    inspectRuntimePayload(stagedArtifact);
    publishNoClobber(stagedArtifact, artifact);
    const inspection = inspectRuntimePayload(artifact);
    return {
      artifact,
      sha256: inspection.sha256,
      buildId: inspection.buildId,
      fileCount: inspection.entries.length,
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function parseArguments(argumentsList: string[]): PackageNextRuntimeOptions {
  const values = new Map<string, string>();
  const known = new Set(['--build-dir', '--artifact']);
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!known.has(flag) || value === undefined || value.startsWith('--') || values.has(flag)) {
      fail('expected each runtime packaging option exactly once');
    }
    values.set(flag, value);
  }
  const required = (flag: string) => {
    const value = values.get(flag);
    if (!value) fail(`${flag} is required`);
    return value;
  };
  return { buildDirectory: required('--build-dir'), artifact: required('--artifact') };
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(packageNextRuntime(parseArguments(Bun.argv.slice(2)))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
