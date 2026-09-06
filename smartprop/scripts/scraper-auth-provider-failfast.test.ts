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
import { inspectAuthState } from '../src/lib/scraper/runtime-health.ts';

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

function validPropertyGuruState(cookieValue = 'fresh') {
  return JSON.stringify({
    cookies: [{
      name: 'PG_U',
      value: cookieValue,
      domain: '.propertyguru.com.sg',
      expires: Math.floor(Date.now() / 1000) + 3600,
    }],
  }) + '\n';
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

  test('selects explicit cloud only when its key and script are both available', () => {
    const cwd = makeWorkspace();
    const cloudScript = path.join(cwd, 'auth-pg-browser-use-cloud.ts');
    fs.writeFileSync(cloudScript, '// present');

    expect(resolvePGAuthProvider({
      PG_AUTH_PROVIDER: 'browser-use-cloud',
      BROWSER_USE_API_KEY: 'present',
    }, cloudScript)).toEqual({ provider: 'browser-use-cloud', operatorAction: false });
    expect(() => resolvePGAuthProvider({
      PG_AUTH_PROVIDER: 'browser-use-cloud',
      BROWSER_USE_API_KEY: 'present',
    }, path.join(cwd, 'missing.ts'))).toThrow('unavailable');
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
    let stagedMode = 0;
    const result = await runPGAuthProvider({
      cwd,
      env: { PG_AUTH_PROVIDER: 'local' },
      spawn: (_command, _args, options) => {
        candidatePath = String(options.env.PG_AUTH_STATE_OUTPUT);
        const child = new EventEmitter();
        queueMicrotask(() => {
          fs.writeFileSync(candidatePath, validPropertyGuruState());
          stagedMode = fs.statSync(candidatePath).mode & 0o777;
          child.emit('exit', 0, null);
        });
        return child;
      },
    });

    expect(result).toMatchObject({ ok: true, exitCode: 0, provider: 'local', diagnostic: null });
    expect(fs.readFileSync(originalState, 'utf8')).toBe(validPropertyGuruState());
    expect(stagedMode).toBe(0o600);
    expect(fs.statSync(originalState).mode & 0o777).toBe(0o600);
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

    expect(result).toMatchObject({ ok: false, exitCode: AUTH_OPERATOR_ACTION_EXIT_CODE, provider: 'local', diagnostic: null });
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

    expect(result).toMatchObject({ ok: false, exitCode: 1, provider: 'local', diagnostic: null });
    expect(killed).toBe(true);
    expect(fs.readFileSync(originalState)).toEqual(originalBytes);
  });

  test('rejects saved PropertyGuru state with anti-bot-only cookies', () => {
    const cwd = makeWorkspace();
    fs.writeFileSync(path.join(cwd, 'storage', 'pg.state.json'), JSON.stringify({
      cookies: [{
        name: '__cf_bm',
        value: 'challenge',
        domain: '.propertyguru.com.sg',
        expires: Math.floor(Date.now() / 1000) + 3600,
      }],
    }));

    const state = inspectAuthState('propertyguru', { cwd });
    expect(state.isAuthenticated).toBe(false);
    expect(state.failureReason).toContain('PG_U');
  });

  test.each([
    ['invalid JSON', '{not json'],
    ['empty cookies', '{"cookies":[]}'],
    ['lookalike domain', JSON.stringify({ cookies: [{ name: 'PG_U', value: 'x', domain: 'notpropertyguru.com.sg', expires: -1 }] })],
    ['expired session cookie', JSON.stringify({ cookies: [{ name: 'PG_U', value: 'x', domain: '.propertyguru.com.sg', expires: 1 }] })],
  ])('preserves original state when a successful process writes %s', async (_name, candidateState) => {
    const cwd = makeWorkspace();
    const originalState = path.join(cwd, 'storage', 'pg.state.json');
    const originalBytes = fs.readFileSync(originalState);
    const result = await runPGAuthProvider({
      cwd,
      env: { PG_AUTH_PROVIDER: 'local' },
      spawn: (_command, _args, options) => {
        const child = new EventEmitter();
        queueMicrotask(() => {
          fs.writeFileSync(String(options.env.PG_AUTH_STATE_OUTPUT), candidateState);
          child.emit('exit', 0, null);
        });
        return child;
      },
    });

    expect(result.ok).toBe(false);
    expect(fs.readFileSync(originalState)).toEqual(originalBytes);
  });

  test('preserves original state when a failed process writes a valid candidate', async () => {
    const cwd = makeWorkspace();
    const originalState = path.join(cwd, 'storage', 'pg.state.json');
    const originalBytes = fs.readFileSync(originalState);
    const result = await runPGAuthProvider({
      cwd,
      env: { PG_AUTH_PROVIDER: 'local' },
      spawn: (_command, _args, options) => {
        const child = new EventEmitter();
        queueMicrotask(() => {
          fs.writeFileSync(String(options.env.PG_AUTH_STATE_OUTPUT), validPropertyGuruState());
          child.emit('exit', 1, null);
        });
        return child;
      },
    });

    expect(result).toMatchObject({ ok: false, exitCode: 1, provider: 'local', diagnostic: null });
    expect(fs.readFileSync(originalState)).toEqual(originalBytes);
  });

  test('returns an actionable configuration diagnostic without spawning', async () => {
    const result = await runPGAuthProvider({
      cwd: makeWorkspace(),
      env: { PG_AUTH_PROVIDER: 'not-a-provider' },
      spawn: () => {
        throw new Error('must not spawn');
      },
    });

    expect(result).toMatchObject({
      ok: false,
      exitCode: AUTH_OPERATOR_ACTION_EXIT_CODE,
      provider: null,
      diagnostic: 'PG_AUTH_PROVIDER must be local or browser-use-cloud',
    });
  });
});
