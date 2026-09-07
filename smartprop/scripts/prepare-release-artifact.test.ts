import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AdmZip from 'adm-zip';

const scriptPath = join(import.meta.dir, 'prepare-release-artifact.ts');
const temporaryDirectories: string[] = [];
const rollbackSha256 = '2'.repeat(64);
const requiredInputs = [
  'bun.lock',
  'ecosystem.config.js',
  'next.config.ts',
  'package-lock.json',
  'package.json',
  'src/instrumentation-node.ts',
  'src/instrumentation.ts',
  'src/lib/queue/scraper-worker.ts',
  'tsconfig.json',
];

function writeRuntimePayload(path: string): void {
  const archive = new AdmZip();
  for (const [entryPath, content] of Object.entries({
    '.next/BUILD_ID': 'next-build-package\n',
    '.next/build-manifest.json': '{}',
    '.next/prerender-manifest.json': '{}',
    '.next/routes-manifest.json': '{}',
    '.next/required-server-files.json': '{}',
    '.next/server/app-paths-manifest.json': '{}',
    '.next/server/pages-manifest.json': '{}',
    '.next/server/app/page.js': 'exports.routeModule = {};\n',
    '.next/static/chunks/app.js': 'self.__next_f.push([]);\n',
  })) {
    archive.addFile(entryPath, Buffer.from(content));
  }
  archive.writeZip(path);
}

function run(command: string[], cwd: string): void {
  const result = Bun.spawnSync({ cmd: command, cwd, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`command failed: ${command.join(' ')}\n${result.stderr.toString()}`);
  }
}

function makeRepository(extraFiles: Record<string, string> = {}): { root: string; commit: string } {
  const root = mkdtempSync(join(tmpdir(), 'smartprop-release-packager-'));
  temporaryDirectories.push(root);
  for (const file of requiredInputs) {
    const path = join(root, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `committed:${file}\n`);
  }
  for (const [file, content] of Object.entries(extraFiles)) {
    const path = join(root, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  run(['git', 'init', '--quiet'], root);
  run(['git', 'config', 'user.email', 'release-test@example.invalid'], root);
  run(['git', 'config', 'user.name', 'Release Test'], root);
  run(['git', 'add', '.'], root);
  run(['git', 'commit', '--quiet', '-m', 'release fixture'], root);
  const commit = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'], cwd: root, stdout: 'pipe' })
    .stdout.toString().trim();
  return { root, commit };
}

function invoke(options: {
  repository: string;
  sourceCommit: string;
  sourceArchive: string;
  manifest: string;
  buildArtifact: string;
  rollback?: string;
}) {
  return Bun.spawnSync({
    cmd: packagingCommand(options),
    cwd: options.repository,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function packagingCommand(options: {
  repository: string;
  sourceCommit: string;
  sourceArchive: string;
  manifest: string;
  buildArtifact: string;
  rollback?: string;
}): string[] {
  return [
    'bun', scriptPath,
    '--repo', options.repository,
    '--source-dir', '.',
    '--source-commit', options.sourceCommit,
    '--source-archive', options.sourceArchive,
    '--manifest', options.manifest,
    '--build-artifact', options.buildArtifact,
    ...(options.rollback ? ['--rollback-sha256', options.rollback] : []),
  ];
}

async function waitFor(condition: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await Bun.sleep(1);
  }
}

function invokeAsync(options: {
  repository: string;
  sourceCommit: string;
  sourceArchive: string;
  manifest: string;
  buildArtifact: string;
  rollback?: string;
}) {
  return Bun.spawn({
    cmd: packagingCommand(options),
    cwd: options.repository,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function hasSourceStagingDirectory(output: string): boolean {
  return readdirSync(output).some((entry) => entry.startsWith('.release-source-'));
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('prepare-release-artifact CLI', () => {
  test('packages committed source only and writes a private revalidated manifest', () => {
    const { root, commit } = makeRepository({ 'committed-marker.txt': 'from commit\n' });
    writeFileSync(join(root, 'dirty-local.txt'), 'must not be archived\n');
    const output = mkdtempSync(join(tmpdir(), 'smartprop-release-output-'));
    temporaryDirectories.push(output);
    const buildArtifact = join(output, 'next-build.tar');
    const sourceArchive = join(output, 'smartprop-source.zip');
    const manifest = join(output, 'release-manifest.json');
    writeRuntimePayload(buildArtifact);

    const result = invoke({
      repository: root,
      sourceCommit: commit,
      sourceArchive,
      manifest,
      buildArtifact,
      rollback: rollbackSha256,
    });

    expect(result.exitCode).toBe(0);
    expect(new AdmZip(sourceArchive).getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName).sort())
      .toEqual([...requiredInputs, 'committed-marker.txt'].sort());
    expect(JSON.parse(readFileSync(manifest, 'utf8'))).toMatchObject({
      source_identity: { kind: 'git', value: commit },
      rollback_identity: { kind: 'sha256', value: rollbackSha256 },
    });
    expect(lstatSync(manifest).mode & 0o777).toBe(0o600);
  });

  test('refuses ambiguous identities and any output overwrite', () => {
    const { root, commit } = makeRepository();
    const output = mkdtempSync(join(tmpdir(), 'smartprop-release-output-'));
    temporaryDirectories.push(output);
    const buildArtifact = join(output, 'next-build.tar');
    const sourceArchive = join(output, 'smartprop-source.zip');
    const manifest = join(output, 'release-manifest.json');
    writeRuntimePayload(buildArtifact);

    const missingRollback = invoke({ repository: root, sourceCommit: commit, sourceArchive, manifest, buildArtifact });
    expect(missingRollback.exitCode).not.toBe(0);
    expect(missingRollback.stderr.toString()).toContain('--rollback-sha256 is required');

    const symbolicRef = invoke({ repository: root, sourceCommit: 'HEAD', sourceArchive, manifest, buildArtifact, rollback: rollbackSha256 });
    expect(symbolicRef.exitCode).not.toBe(0);
    expect(symbolicRef.stderr.toString()).toContain('exact lowercase 40-hex');

    writeFileSync(sourceArchive, 'existing candidate must not be overwritten\n');
    const existingOutput = invoke({ repository: root, sourceCommit: commit, sourceArchive, manifest, buildArtifact, rollback: rollbackSha256 });
    expect(existingOutput.exitCode).not.toBe(0);
    expect(existingOutput.stderr.toString()).toContain('must not already exist');
  });

  test('never clobbers a source archive destination created after preflight', async () => {
    const { root, commit } = makeRepository({ 'large-committed-input.txt': 'x'.repeat(8_000_000) });
    const output = mkdtempSync(join(tmpdir(), 'smartprop-release-output-'));
    temporaryDirectories.push(output);
    const buildArtifact = join(output, 'next-build.tar');
    const sourceArchive = join(output, 'smartprop-source.zip');
    const manifest = join(output, 'release-manifest.json');
    const racedContent = 'raced output must survive\n';
    writeRuntimePayload(buildArtifact);

    const child = invokeAsync({
      repository: root,
      sourceCommit: commit,
      sourceArchive,
      manifest,
      buildArtifact,
      rollback: rollbackSha256,
    });
    await waitFor(() => hasSourceStagingDirectory(output), 'source archive staging');
    writeFileSync(sourceArchive, racedContent);
    const exitCode = await child.exited;
    const stderr = await new Response(child.stderr).text();

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('--source-archive must not already exist');
    expect(readFileSync(sourceArchive, 'utf8')).toBe(racedContent);
    expect(existsSync(manifest)).toBeFalse();
  });

  test('rejects committed secret and symlink entries before publishing either output', () => {
    const secretRepository = makeRepository({ '.env.production': 'SECRET=fixture\n' });
    const output = mkdtempSync(join(tmpdir(), 'smartprop-release-output-'));
    temporaryDirectories.push(output);
    const buildArtifact = join(output, 'next-build.tar');
    const sourceArchive = join(output, 'smartprop-source.zip');
    const manifest = join(output, 'release-manifest.json');
    writeRuntimePayload(buildArtifact);

    const secretResult = invoke({
      repository: secretRepository.root,
      sourceCommit: secretRepository.commit,
      sourceArchive,
      manifest,
      buildArtifact,
      rollback: rollbackSha256,
    });
    expect(secretResult.exitCode).not.toBe(0);
    expect(secretResult.stderr.toString()).toContain('environment or authentication artifact');
    expect(() => lstatSync(sourceArchive)).toThrow();
    expect(() => lstatSync(manifest)).toThrow();

    const symlinkRepository = makeRepository();
    symlinkSync('package.json', join(symlinkRepository.root, 'linked-package.json'));
    run(['git', 'add', 'linked-package.json'], symlinkRepository.root);
    run(['git', 'commit', '--quiet', '-m', 'symlink fixture'], symlinkRepository.root);
    const symlinkCommit = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'], cwd: symlinkRepository.root, stdout: 'pipe' })
      .stdout.toString().trim();
    const symlinkArchive = join(output, 'symlink-source.zip');
    const symlinkManifest = join(output, 'symlink-manifest.json');
    const symlinkResult = invoke({
      repository: symlinkRepository.root,
      sourceCommit: symlinkCommit,
      sourceArchive: symlinkArchive,
      manifest: symlinkManifest,
      buildArtifact,
      rollback: rollbackSha256,
    });
    expect(symlinkResult.exitCode).not.toBe(0);
    expect(symlinkResult.stderr.toString()).toContain('symbolic link');
    expect(() => lstatSync(symlinkArchive)).toThrow();
    expect(() => lstatSync(symlinkManifest)).toThrow();
  });
});
