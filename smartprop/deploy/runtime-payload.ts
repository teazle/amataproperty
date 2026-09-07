import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';

import AdmZip from 'adm-zip';

export class RuntimePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimePayloadError';
  }
}

export interface RuntimePayloadEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface RuntimePayloadInspection {
  sha256: string;
  size: number;
  buildId: string;
  entries: RuntimePayloadEntry[];
}

const REQUIRED_ENTRIES = [
  '.next/BUILD_ID',
  '.next/build-manifest.json',
  '.next/prerender-manifest.json',
  '.next/routes-manifest.json',
  '.next/required-server-files.json',
  '.next/server/app-paths-manifest.json',
  '.next/server/pages-manifest.json',
] as const;
const REQUIRED_JSON_ENTRIES = REQUIRED_ENTRIES.filter((path) => path.endsWith('.json'));
const ALLOWED_ROOT_RUNTIME_METADATA = new Set([
  '.next/app-build-manifest.json',
  '.next/app-path-routes-manifest.json',
  '.next/export-marker.json',
  '.next/images-manifest.json',
  '.next/next-minimal-server.js.nft.json',
  '.next/next-server.js.nft.json',
  '.next/package.json',
  '.next/react-loadable-manifest.json',
]);
const RESERVED_DIRECTORY_PATHS = new Set(['.next', '.next/server', '.next/static']);
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
  throw new RuntimePayloadError(message);
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function assertSafePath(path: string): void {
  const parts = path.split('/');
  if (
    path.length === 0
    || path.includes('\\')
    || path.includes('\0')
    || path.startsWith('/')
    || parts.some((part) => part === '' || part === '.' || part === '..')
  ) fail(`unsafe runtime payload path: ${path}`);

  const lowerParts = parts.map((part) => part.toLowerCase());
  const fileName = lowerParts.at(-1)!;
  if (
    fileName === '.env'
    || fileName.startsWith('.env.')
    || /\.(?:key|p12|pem|pfx)$/.test(fileName)
    || FORBIDDEN_FILE_NAMES.has(fileName)
    || lowerParts.some((part) => FORBIDDEN_DIRECTORIES.has(part))
  ) fail(`runtime payload contains an environment or authentication artifact: ${path}`);
}

function assertAllowedPayloadPath(path: string): void {
  if (path === '.next' || path === '.next/server' || path === '.next/static') return;
  if (!path.startsWith('.next/')) fail(`runtime payload contains a non-.next path: ${path}`);
  if (
    path === '.next/cache' || path.startsWith('.next/cache/')
    || path === '.next/diagnostics' || path.startsWith('.next/diagnostics/')
    || path === '.next/trace' || path.startsWith('.next/trace/')
    || path === '.next/types' || path.startsWith('.next/types/')
  ) {
    fail(`runtime payload contains excluded build-state content: ${path}`);
  }
  if (REQUIRED_ENTRIES.includes(path as typeof REQUIRED_ENTRIES[number])) return;
  if (ALLOWED_ROOT_RUNTIME_METADATA.has(path)) return;
  if (path.startsWith('.next/server/') || path.startsWith('.next/static/')) return;
  fail(`runtime payload contains unsupported .next content: ${path}`);
}

function assertJson(content: Buffer, path: string): void {
  try {
    JSON.parse(content.toString('utf8'));
  } catch {
    fail(`required Next runtime manifest is not valid JSON: ${path}`);
  }
}

function requiredRuntimeFiles(content: Buffer): string[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content.toString('utf8'));
  } catch {
    fail('required-server-files.json must contain a non-null object with a string files array');
  }
  if (
    manifest === null
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || !Array.isArray((manifest as { files?: unknown }).files)
    || !(manifest as { files: unknown[] }).files.every((path) => typeof path === 'string')
  ) {
    fail('required-server-files.json must contain a non-null object with a string files array');
  }
  return (manifest as { files: string[] }).files;
}

/**
 * Inspects an immutable ZIP containing only the portable `.next` runtime
 * output. Dependency installation is intentionally outside this payload.
 */
export function inspectRuntimePayload(payloadPath: string): RuntimePayloadInspection {
  let stat;
  let payloadBytes: Buffer;
  try {
    stat = lstatSync(payloadPath);
    payloadBytes = readFileSync(payloadPath);
  } catch (error) {
    fail(`cannot read Next runtime payload: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail('Next runtime payload must be a regular file, not a symlink');
  }

  let zipEntries;
  try {
    zipEntries = new AdmZip(payloadBytes).getEntries();
  } catch (error) {
    fail(`Next runtime payload is not a readable ZIP: ${error instanceof Error ? error.message : String(error)}`);
  }

  const seen = new Set<string>();
  const entryKinds = new Map<string, 'directory' | 'file'>();
  const entries: RuntimePayloadEntry[] = [];
  const contents = new Map<string, Buffer>();
  for (const entry of zipEntries) {
    const path = entry.entryName.endsWith('/') ? entry.entryName.slice(0, -1) : entry.entryName;
    assertSafePath(path);
    assertAllowedPayloadPath(path);
    if (seen.has(path)) fail(`duplicate runtime payload path: ${path}`);
    seen.add(path);

    const unixMode = (entry.attr >>> 16) & 0xf000;
    if (unixMode === 0xa000) fail(`runtime payload contains a symbolic link: ${path}`);
    if (!entry.isDirectory && RESERVED_DIRECTORY_PATHS.has(path)) {
      fail(`reserved runtime directory must be an explicit directory: ${path}`);
    }
    const conflictingFilePath = [...entryKinds].find(([knownPath, kind]) => (
      (kind === 'file' && path.startsWith(`${knownPath}/`))
      || (!entry.isDirectory && knownPath.startsWith(`${path}/`))
    ))?.[0];
    if (conflictingFilePath) {
      fail(`runtime payload file conflicts with ancestor or descendant: ${conflictingFilePath}`);
    }
    entryKinds.set(path, entry.isDirectory ? 'directory' : 'file');
    if (entry.isDirectory) continue;

    const content = entry.getData();
    contents.set(path, content);
    entries.push({ path, sha256: sha256(content), size: content.byteLength });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));

  for (const required of REQUIRED_ENTRIES) {
    if (!contents.has(required)) fail(`missing required Next runtime payload entry: ${required}`);
  }
  for (const manifestPath of REQUIRED_JSON_ENTRIES) {
    assertJson(contents.get(manifestPath)!, manifestPath);
  }
  for (const path of requiredRuntimeFiles(contents.get('.next/required-server-files.json')!)) {
    assertSafePath(path);
    assertAllowedPayloadPath(path);
    if (!contents.has(path)) fail(`declared Next runtime file is missing: ${path}`);
  }
  const buildId = contents.get('.next/BUILD_ID')!.toString('utf8').trim();
  if (!buildId) fail('Next runtime BUILD_ID must not be empty');
  if (!entries.some((entry) => entry.path.startsWith('.next/server/') && !REQUIRED_ENTRIES.includes(entry.path as typeof REQUIRED_ENTRIES[number]))) {
    fail('runtime payload is missing compiled server output');
  }
  if (!entries.some((entry) => entry.path.startsWith('.next/static/'))) {
    fail('runtime payload is missing static output');
  }

  return {
    sha256: sha256(payloadBytes),
    size: payloadBytes.byteLength,
    buildId,
    entries,
  };
}
