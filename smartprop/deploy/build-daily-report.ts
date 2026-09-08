import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, parse, relative, resolve } from 'node:path';

type BunBuildResult = {
  success: boolean;
  logs: Array<{ message: string }>;
  outputs: Array<{ path: string }>;
};

declare const Bun: {
  build(options: { entrypoints: string[]; outdir: string; naming: string; target: 'bun'; sourcemap: 'none' }): Promise<BunBuildResult>;
};

declare global {
  interface ImportMeta {
    main?: boolean;
  }
}

const ENTRY_PATH = 'scripts/smartprop-daily-report.ts';
const LOCK_PATH = 'bun.lock';
const BUNDLE_NAME = 'report.js';
const MANIFEST_NAME = 'manifest.json';
const NODE_BUILTINS = new Set(builtinModules.map((specifier) => specifier.replace(/^node:/, '')));

export type DailyReportBundleManifest = {
  schema_version: 1;
  source: { path: typeof ENTRY_PATH; sha256: string };
  lock: { path: typeof LOCK_PATH; sha256: string };
  outputs: Array<{ path: string; sha256: string }>;
  externals: string[];
};

export type DailyReportBundleResult = {
  bundlePath: string;
  manifestPath: string;
  manifest: DailyReportBundleManifest;
};

function fail(message: string): never {
  throw new Error(`daily report bundle: ${message}`);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function prepareOutputDirectory(path: string): string {
  const outputDirectory = resolve(path);
  if (outputDirectory === parse(outputDirectory).root) fail('unsafe output directory');
  if (existsSync(outputDirectory)) {
    const stat = lstatSync(outputDirectory);
    if (stat.isSymbolicLink()) fail('output directory must not be a symlink');
    if (!stat.isDirectory()) fail('output directory must be a directory');
    if (readdirSync(outputDirectory).length > 0) fail('output directory must be empty');
    return outputDirectory;
  }

  const parent = dirname(outputDirectory);
  const parentStat = lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) fail('output directory parent must be a directory');
  mkdirSync(outputDirectory);
  return outputDirectory;
}

function inspectExternals(bundlePath: string): string[] {
  const bundle = readFileSync(bundlePath, 'utf8');
  const specifiers = new Set<string>();
  for (const match of bundle.matchAll(/^import\s+.+?\s+from\s+["']([^"']+)["'];?$/gm)) {
    specifiers.add(match[1]);
  }
  for (const match of bundle.matchAll(/__require\(["']([^"']+)["']\)/g)) {
    specifiers.add(match[1]);
  }

  return [...specifiers].map((specifier) => {
    if (specifier === 'bun') return specifier;
    const nodeSpecifier = specifier.replace(/^node:/, '');
    if (NODE_BUILTINS.has(nodeSpecifier)) return `node:${nodeSpecifier}`;
    fail(`unexpected external dependency: ${specifier}`);
  }).sort();
}

export async function buildDailyReportBundle(options: {
  outputDirectory: string;
  projectRoot?: string;
}): Promise<DailyReportBundleResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const entryPath = joinProjectPath(projectRoot, ENTRY_PATH);
  const lockPath = joinProjectPath(projectRoot, LOCK_PATH);
  const outputDirectory = prepareOutputDirectory(options.outputDirectory);
  const build = await Bun.build({
    entrypoints: [entryPath],
    outdir: outputDirectory,
    naming: BUNDLE_NAME,
    target: 'bun',
    sourcemap: 'none',
  });
  if (!build.success || build.outputs.length !== 1) {
    fail(`Bun build failed: ${build.logs.map((log) => log.message).join('; ') || 'unexpected output count'}`);
  }

  const bundlePath = resolve(build.outputs[0].path);
  if (dirname(bundlePath) !== outputDirectory || relative(outputDirectory, bundlePath) !== BUNDLE_NAME) {
    fail('Bun build produced an unexpected output path');
  }
  if (!lstatSync(bundlePath).isFile()) fail('Bun build did not produce a regular bundle file');

  const manifest: DailyReportBundleManifest = {
    schema_version: 1,
    source: { path: ENTRY_PATH, sha256: sha256(entryPath) },
    lock: { path: LOCK_PATH, sha256: sha256(lockPath) },
    outputs: [{ path: BUNDLE_NAME, sha256: sha256(bundlePath) }],
    externals: inspectExternals(bundlePath),
  };
  const manifestPath = joinProjectPath(outputDirectory, MANIFEST_NAME);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { bundlePath, manifestPath, manifest };
}

function joinProjectPath(root: string, path: string): string {
  return resolve(root, path);
}

if (import.meta.main) {
  const [flag, outputDirectory] = process.argv.slice(2);
  if (flag !== '--output' || !outputDirectory || process.argv.length !== 4) {
    fail('usage: bun deploy/build-daily-report.ts --output <empty-directory>');
  }
  buildDailyReportBundle({ outputDirectory }).then(({ manifestPath }) => {
    console.log(manifestPath);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
