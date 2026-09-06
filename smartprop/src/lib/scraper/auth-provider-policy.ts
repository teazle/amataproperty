import fs from 'node:fs';
import path from 'node:path';

export const AUTH_OPERATOR_ACTION_EXIT_CODE = 78;

export type PGAuthProvider = 'local' | 'browser-use-cloud';

export type AuthProviderResolution = {
  provider: PGAuthProvider;
  operatorAction: boolean;
};

export type AuthFailureClassification = {
  operatorAction: boolean;
  exitCode: number;
};

export class AuthProviderConfigurationError extends Error {
  readonly exitCode = AUTH_OPERATOR_ACTION_EXIT_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'AuthProviderConfigurationError';
  }
}

export function resolvePGAuthProvider(
  env: { PG_AUTH_PROVIDER?: string; BROWSER_USE_API_KEY?: string },
  browserUseAuthScriptPath: string
): AuthProviderResolution {
  const configuredProvider = env.PG_AUTH_PROVIDER ?? 'local';
  if (configuredProvider === 'local') {
    return { provider: 'local', operatorAction: false };
  }

  if (configuredProvider !== 'browser-use-cloud') {
    throw new AuthProviderConfigurationError('PG_AUTH_PROVIDER must be local or browser-use-cloud');
  }

  if (!env.BROWSER_USE_API_KEY) {
    throw new AuthProviderConfigurationError('BROWSER_USE_API_KEY is required when PG_AUTH_PROVIDER=browser-use-cloud');
  }

  if (!fs.existsSync(browserUseAuthScriptPath)) {
    throw new AuthProviderConfigurationError(`Browser Use auth script is unavailable: ${browserUseAuthScriptPath}`);
  }

  return { provider: 'browser-use-cloud', operatorAction: false };
}

export function classifyBrowserUseFailure(status: number | undefined): AuthFailureClassification {
  if (status === 401 || status === 402 || status === 403) {
    return { operatorAction: true, exitCode: AUTH_OPERATOR_ACTION_EXIT_CODE };
  }

  return { operatorAction: false, exitCode: 1 };
}

type AuthChildProcess = {
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill?(signal: NodeJS.Signals): unknown;
};

type AuthSpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: 'inherit';
};

export type AuthProcessSpawn = (
  command: string,
  args: string[],
  options: AuthSpawnOptions
) => AuthChildProcess;

export type PGAuthRunResult = {
  ok: boolean;
  exitCode: number;
  provider: PGAuthProvider | null;
};

function createCandidateStatePath(cwd: string): string {
  const storageDir = path.join(cwd, 'storage');
  fs.mkdirSync(storageDir, { recursive: true });
  return path.join(storageDir, `.pg.state.auth-candidate-${process.pid}-${Date.now()}.json`);
}

function replaceWithValidatedCandidate(candidatePath: string, statePath: string): void {
  const content = fs.readFileSync(candidatePath, 'utf8');
  const parsed = JSON.parse(content) as { cookies?: unknown };
  if (!Array.isArray(parsed.cookies) || parsed.cookies.length === 0) {
    throw new Error('Authentication candidate state has no cookies');
  }

  fs.renameSync(candidatePath, statePath);
}

function waitForAuthProcess(child: AuthChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exitCode: number) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(exitCode);
      }
    };

    const timeout = setTimeout(() => {
      child.kill?.('SIGKILL');
      finish(1);
    }, timeoutMs);
    child.once('error', () => finish(1));
    child.once('exit', (code) => finish(code ?? 1));
  });
}

export async function runPGAuthProvider(options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  spawn: AuthProcessSpawn;
  bunPath?: string;
  isLinux?: boolean;
  timeoutMs?: number;
}): Promise<PGAuthRunResult> {
  const browserUseAuthScriptPath = path.join(options.cwd, 'scripts', 'auth-pg-browser-use-cloud.ts');
  let resolution: AuthProviderResolution;
  try {
    resolution = resolvePGAuthProvider({
      PG_AUTH_PROVIDER: options.env.PG_AUTH_PROVIDER,
      BROWSER_USE_API_KEY: options.env.BROWSER_USE_API_KEY,
    }, browserUseAuthScriptPath);
  } catch (error) {
    if (error instanceof AuthProviderConfigurationError) {
      return { ok: false, exitCode: error.exitCode, provider: null };
    }
    throw error;
  }

  const candidatePath = createCandidateStatePath(options.cwd);
  const statePath = path.join(options.cwd, 'storage', 'pg.state.json');
  const authScriptPath = resolution.provider === 'browser-use-cloud'
    ? browserUseAuthScriptPath
    : path.join(options.cwd, 'src', 'workers', 'auth.pg.ts');
  const bunPath = options.bunPath ?? 'bun';
  const isLinux = options.isLinux ?? process.platform === 'linux';
  const command = isLinux ? 'xvfb-run' : bunPath;
  const args = isLinux ? ['-a', bunPath, authScriptPath] : [authScriptPath];

  try {
    const exitCode = await waitForAuthProcess(options.spawn(command, args, {
      cwd: options.cwd,
      stdio: 'inherit',
      env: {
        ...options.env,
        PG_AUTH_STATE_OUTPUT: candidatePath,
      },
    }), options.timeoutMs ?? 900_000);
    if (exitCode !== 0) {
      return { ok: false, exitCode, provider: resolution.provider };
    }

    replaceWithValidatedCandidate(candidatePath, statePath);
    return { ok: true, exitCode: 0, provider: resolution.provider };
  } catch {
    return { ok: false, exitCode: 1, provider: resolution.provider };
  } finally {
    fs.rmSync(candidatePath, { force: true });
  }
}
