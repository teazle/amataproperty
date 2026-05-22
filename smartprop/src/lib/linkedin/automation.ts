import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  getLockFilePath,
  readLockFile,
  isProcessRunning,
  deleteLockFile,
  getLockAgeMs,
  getLinkedInMaxRunMs,
  isLinkedInLockExpired
} from '@/lib/linkedin/storage';

export interface AutomationOptions {
  dryRun?: boolean;
  headed?: boolean;
  reason?: string;
}

const LOG_FILE_PATH = '/tmp/linkedin-automation.log';
const STOP_GRACE_MS = 5000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function terminateLinkedInProcess(
  pid: number,
  options: { forceAfterMs?: number } = {}
): Promise<string> {
  const forceAfterMs = options.forceAfterMs ?? STOP_GRACE_MS;
  if (!(await isProcessRunning(pid))) {
    return `process ${pid} already exited`;
  }

  const signals: string[] = [];
  try {
    process.kill(-pid, 'SIGTERM');
    signals.push(`SIGTERM sent to process group ${pid}`);
  } catch (groupError: any) {
    try {
      process.kill(pid, 'SIGTERM');
      signals.push(`SIGTERM sent to PID ${pid}`);
    } catch (pidError: any) {
      return `failed to send SIGTERM to ${pid}: ${pidError.message || groupError.message}`;
    }
  }

  await delay(forceAfterMs);
  if (!(await isProcessRunning(pid))) {
    return signals.join('; ');
  }

  try {
    process.kill(-pid, 'SIGKILL');
    signals.push(`SIGKILL sent to process group ${pid}`);
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
      signals.push(`SIGKILL sent to PID ${pid}`);
    } catch (error: any) {
      signals.push(`failed to force kill ${pid}: ${error.message}`);
    }
  }

  return signals.join('; ');
}

export async function startLinkedInAutomation(options: AutomationOptions = {}): Promise<number> {
  const lockFile = getLockFilePath();
  const lockData = readLockFile();

  // Clean up stale lock files
  if (lockData) {
    if (lockData.status === 'reauth_required') {
      throw new Error(`LinkedIn reauth required before automation can run: ${lockData.error || 'profile is not authenticated'}`);
    }

    if (lockData.status === 'stopped') {
      console.log(`🧹 Cleaning up stale lock file (status: ${lockData.status})`);
      deleteLockFile();
    } else if (lockData.status === 'running' && lockData.pid) {
      const running = await isProcessRunning(lockData.pid);
      if (!running) {
        console.log(`🧹 Cleaning up stale lock file (process ${lockData.pid} not running)`);
        deleteLockFile();
      } else if (isLinkedInLockExpired(lockData)) {
        const ageMinutes = Math.round(getLockAgeMs(lockData) / 60000);
        const maxMinutes = Math.round(getLinkedInMaxRunMs() / 60000);
        console.warn(`🧹 LinkedIn automation exceeded max runtime (${ageMinutes}m > ${maxMinutes}m); stopping stale process ${lockData.pid}`);
        await terminateLinkedInProcess(lockData.pid);
        deleteLockFile();
      } else {
        throw new Error('LinkedIn automation is already running');
      }
    }
  }

  const scriptPath = path.join(process.cwd(), 'src', 'workers', 'linkedin.ts');
  const args = options.dryRun ? ['--dry-run'] : [];

  try {
    fs.writeFileSync(LOG_FILE_PATH, '');
  } catch (error) {
    console.warn('Failed to reset LinkedIn log file:', (error as Error).message);
  }
  const logStream = fs.openSync(LOG_FILE_PATH, 'a');

  // Find bun executable - check common locations
  let bunPath = 'bun';
  const possibleBunPaths = [
    process.env.BUN_PATH,
    '/home/ec2-user/.bun/bin/bun',
    process.env.HOME ? `${process.env.HOME}/.bun/bin/bun` : null,
    '/usr/local/bin/bun',
    '/opt/bun/bin/bun'
  ].filter(Boolean) as string[];

  // Check if bun exists at any of these paths
  for (const testPath of possibleBunPaths) {
    try {
      if (fs.existsSync(testPath)) {
        bunPath = testPath;
        console.log(`✅ Found bun at: ${bunPath}`);
        break;
      }
    } catch (e) {
      // Continue checking other paths
    }
  }

  // If we didn't find bun, try to use which/whereis (but this won't work in spawn, so use absolute path)
  if (bunPath === 'bun') {
    // Default to the most common location on EC2
    const defaultBunPath = '/home/ec2-user/.bun/bin/bun';
    if (fs.existsSync(defaultBunPath)) {
      bunPath = defaultBunPath;
      console.log(`✅ Using default bun path: ${bunPath}`);
    } else {
      console.warn(`⚠️  Bun not found in common locations, will try 'bun' in PATH`);
    }
  }

  const env = {
    ...process.env,
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    ...(options.headed
      ? {
          HEADLESS: '0',
          DISPLAY: process.env.LINKEDIN_DISPLAY || ':99'
        }
      : {})
  };

  // Add bun's directory to PATH if we found it in a specific location
  if (bunPath !== 'bun' && !bunPath.includes('/')) {
    const bunDir = path.dirname(bunPath);
    env.PATH = `${bunDir}:${env.PATH}`;
  }

  const useRemoteBrowser =
    process.env.LINKEDIN_BROWSER_USE_CLOUD === 'true' ||
    Boolean(process.env.LINKEDIN_BROWSER_CDP_URL);
  const command = useRemoteBrowser ? 'npx' : bunPath;
  const commandArgs = useRemoteBrowser
    ? ['--yes', 'tsx', scriptPath, ...args]
    : [scriptPath, ...args];

  console.log(`🚀 Spawning LinkedIn automation with: ${command} ${commandArgs.join(' ')}`);
  console.log(`   Working directory: ${process.cwd()}`);
  console.log(`   Bun exists: ${fs.existsSync(bunPath)}`);
  console.log(`   Script exists: ${fs.existsSync(scriptPath)}`);
  console.log(`   Remote browser mode: ${useRemoteBrowser}`);

  // Add error handler to catch spawn errors
  const child = spawn(command, commandArgs, {
    detached: true,
    stdio: ['ignore', logStream, logStream],
    env,
    cwd: process.cwd()
  });

  // Handle spawn errors
  child.on('error', (error: any) => {
    console.error(`❌ Failed to spawn LinkedIn automation: ${error.message}`);
    console.error(`   Command: ${command}`);
    console.error(`   Args: ${commandArgs.join(' ')}`);
    console.error(`   Bun path: ${bunPath}`);
    console.error(`   Script path: ${scriptPath}`);
    console.error(`   Error code: ${error.code}`);
    console.error(`   Error syscall: ${error.syscall}`);
    try {
      fs.closeSync(logStream);
    } catch (e) {
      // Ignore close errors
    }
    throw error; // Re-throw so the API can catch it
  });

  // Check if spawn failed immediately
  if (!child.pid) {
    const error = new Error(`Failed to spawn LinkedIn automation process. Command: ${command}, Script: ${scriptPath}`);
    console.error(`❌ ${error.message}`);
    try {
      fs.closeSync(logStream);
    } catch (e) {
      // Ignore close errors
    }
    throw error;
  }

  setTimeout(() => {
    try {
      fs.closeSync(logStream);
    } catch (error) {
      console.error('Failed to close log stream:', error);
    }
  }, 1000);

  child.unref();
  console.log(
    `🚀 Started LinkedIn automation (PID: ${child.pid})${options.reason ? ` via ${options.reason}` : ''}`
  );

  return child.pid;
}
