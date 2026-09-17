import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporaryDirectories: string[] = [];
const projectRoot = resolve(import.meta.dir, '..');

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'smartprop-health-liveness-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writeExecutable(path: string, contents: string) {
  writeFileSync(path, contents, { mode: 0o755 });
}

function healthcheckFixture(directory: string): string {
  const source = readFileSync(join(projectRoot, 'scripts/smartprop-healthcheck.sh'), 'utf8')
    .replace('APP_DIR="/opt/smartprop/app/smartprop"', 'APP_DIR="${APP_DIR:?}"')
    .replace('LOG_DIR="/opt/smartprop/logs"', 'LOG_DIR="${LOG_DIR:?}"')
    .replace('LOG_FILE="$LOG_DIR/smartprop-healthcheck.log"', 'LOG_FILE="${LOG_FILE:?}"')
    .replace(/export PATH=.*\n/, 'export PATH="${PATH:?}"\n')
    .replace(/\nmain "\$@"\s*$/, '\n');
  const path = join(directory, 'smartprop-healthcheck-fixture.sh');
  writeExecutable(path, source);
  return path;
}

function runHttpCheck(livenessCode: '200' | '000', readinessCode: '200' | '503' | '000') {
  const directory = temporaryDirectory();
  const bin = join(directory, 'bin');
  const logDirectory = join(directory, 'logs');
  const pm2Calls = join(directory, 'pm2-calls');
  const fixture = healthcheckFixture(directory);
  Bun.spawnSync(['mkdir', '-p', bin, logDirectory]);
  writeFileSync(pm2Calls, '');
  writeExecutable(join(bin, 'curl'), `#!/usr/bin/env bash
for argument in "$@"; do
  case "$argument" in
    */api/health/live) printf '%s' "\${LIVENESS_CODE}"; exit 0 ;;
    */api/health) printf '%s' "\${READINESS_CODE}"; exit 0 ;;
    *:8191/v1) printf '200'; exit 0 ;;
  esac
done
exit 2
`);
  writeExecutable(join(bin, 'pm2'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$PM2_CALLS"
`);

  return Bun.spawnSync({
    cmd: ['bash', '-c', 'source "$1"; check_http', 'bash', fixture],
    cwd: directory,
    env: {
      ...process.env,
      APP_DIR: directory,
      LOG_DIR: logDirectory,
      LOG_FILE: join(logDirectory, 'healthcheck.log'),
      APP_BASE_URL: 'http://app.test',
      PM2_CALLS: pm2Calls,
      LIVENESS_CODE: livenessCode,
      READINESS_CODE: readinessCode,
      PATH: `${bin}:${process.env.PATH}`,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('health liveness', () => {
  test('answers without dependencies and disables caching', async () => {
    const { GET } = await import('../src/app/api/health/live/route');
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ status: 'live' });
  });

  for (const readinessCode of ['503', '000'] as const) {
    test(`does not restart a live app when detailed readiness is ${readinessCode}`, () => {
      const result = runHttpCheck('200', readinessCode);

      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toContain(`app readiness returned HTTP ${readinessCode}`);
      expect(result.stdout.toString()).toContain('liveness HTTP 200; not restarting smartprop');
      expect(readFileSync(join(temporaryDirectories.at(-1)!, 'pm2-calls'), 'utf8')).toBe('');
    });
  }

  test('restarts a nonresponsive app liveness route', () => {
    const result = runHttpCheck('000', '200');

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain('app liveness returned HTTP 000; restarting smartprop');
    expect(readFileSync(join(temporaryDirectories.at(-1)!, 'pm2-calls'), 'utf8')).toBe('restart smartprop --update-env\n');
  });
});
