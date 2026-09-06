import { afterEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AUTH_OPERATOR_ACTION_EXIT_CODE,
  classifyBrowserUseFailure,
  resolvePGAuthProvider,
  runPGAuthProvider,
} from '../src/lib/scraper/auth-provider-policy.ts';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeWorkspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-auth-provider-'));
  temporaryDirectories.push(directory);
  fs.mkdirSync(path.join(directory, 'storage'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'storage', 'pg.state.json'), '{"cookies":[{"name":"old"}]}\n');
  return directory;
}

describe('PropertyGuru auth provider policy', () => {
  test('defaults to local even when a Browser Use key is present', () => {
    expect(resolvePGAuthProvider({ BROWSER_USE_API_KEY: 'present' }, '/tmp/auth-pg-browser-use-cloud.ts')).toEqual({
      provider: 'local',
      operatorAction: false,
    });
  });

  test('rejects invalid or incomplete explicit cloud configuration as operator action', () => {
    expect(() => resolvePGAuthProvider({ PG_AUTH_PROVIDER: 'unknown' }, '/tmp/auth-pg-browser-use-cloud.ts')).toThrow('PG_AUTH_PROVIDER');
    expect(() => resolvePGAuthProvider({ PG_AUTH_PROVIDER: 'browser-use-cloud' }, '/tmp/missing.ts')).toThrow('BROWSER_USE_API_KEY');
  });

  test('classifies Browser Use authorization and balance failures as operator action', () => {
    expect(classifyBrowserUseFailure(402).exitCode).toBe(AUTH_OPERATOR_ACTION_EXIT_CODE);
    expect(classifyBrowserUseFailure(401).operatorAction).toBe(true);
    expect(classifyBrowserUseFailure(403).operatorAction).toBe(true);
  });

  test('leaves Browser Use rate and service failures transient', () => {
    expect(classifyBrowserUseFailure(429)).toEqual({ operatorAction: false, exitCode: 1 });
    expect(classifyBrowserUseFailure(503)).toEqual({ operatorAction: false, exitCode: 1 });
  });

  test('writes candidate state then atomically replaces only after a successful auth process', async () => {
    const cwd = makeWorkspace();
    const originalState = path.join(cwd, 'storage', 'pg.state.json');
    let candidatePath = '';
    const result = await runPGAuthProvider({
      cwd,
      env: { PG_AUTH_PROVIDER: 'local' },
      spawn: (_command, _args, options) => {
        candidatePath = String(options.env.PG_AUTH_STATE_OUTPUT);
        const child = new EventEmitter();
        queueMicrotask(() => {
          fs.writeFileSync(candidatePath, '{"cookies":[{"name":"fresh"}]}\n');
          child.emit('exit', 0, null);
        });
        return child;
      },
    });

    expect(result).toEqual({ ok: true, exitCode: 0, provider: 'local' });
    expect(fs.readFileSync(originalState, 'utf8')).toBe('{"cookies":[{"name":"fresh"}]}\n');
    expect(fs.existsSync(candidatePath)).toBe(false);
  });

  test('propagates exit 78 and preserves the original state byte-for-byte', async () => {
    const cwd = makeWorkspace();
    const originalState = path.join(cwd, 'storage', 'pg.state.json');
    const originalBytes = fs.readFileSync(originalState);
    const result = await runPGAuthProvider({
      cwd,
      env: { PG_AUTH_PROVIDER: 'local' },
      spawn: () => {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('exit', AUTH_OPERATOR_ACTION_EXIT_CODE, null));
        return child;
      },
    });

    expect(result).toEqual({ ok: false, exitCode: AUTH_OPERATOR_ACTION_EXIT_CODE, provider: 'local' });
    expect(fs.readFileSync(originalState)).toEqual(originalBytes);
  });

  test('fails a stalled auth process without replacing the original state', async () => {
    const cwd = makeWorkspace();
    const originalState = path.join(cwd, 'storage', 'pg.state.json');
    const originalBytes = fs.readFileSync(originalState);
    let killed = false;
    const result = await Promise.race([
      runPGAuthProvider({
        cwd,
        env: { PG_AUTH_PROVIDER: 'local' },
        timeoutMs: 1,
        spawn: () => {
          const child = new EventEmitter();
          Object.assign(child, { kill: () => { killed = true; } });
          return child;
        },
      }),
      Bun.sleep(100).then(() => ({ ok: false, exitCode: 99, provider: null })),
    ]);

    expect(result).toEqual({ ok: false, exitCode: 1, provider: 'local' });
    expect(killed).toBe(true);
    expect(fs.readFileSync(originalState)).toEqual(originalBytes);
  });
});
