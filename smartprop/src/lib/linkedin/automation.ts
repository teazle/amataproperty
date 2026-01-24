import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  getLockFilePath,
  readLockFile,
  isProcessRunning,
  deleteLockFile
} from '@/lib/linkedin/storage';

export interface AutomationOptions {
  dryRun?: boolean;
  headed?: boolean;
  reason?: string;
}

const LOG_FILE_PATH = '/tmp/linkedin-automation.log';

export async function startLinkedInAutomation(options: AutomationOptions = {}): Promise<number> {
  const lockFile = getLockFilePath();
  const lockData = readLockFile();
  
  // Clean up stale lock files
  if (lockData) {
    if (lockData.status === 'stopped') {
      console.log('🧹 Cleaning up stale lock file (status: stopped)');
      deleteLockFile();
    } else if (lockData.status === 'running' && lockData.pid) {
      const running = await isProcessRunning(lockData.pid);
      if (!running) {
        console.log(`🧹 Cleaning up stale lock file (process ${lockData.pid} not running)`);
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
  for (const path of possibleBunPaths) {
    if (fs.existsSync(path)) {
      bunPath = path;
      console.log(`✅ Found bun at: ${bunPath}`);
      break;
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

  console.log(`🚀 Spawning LinkedIn automation with: ${bunPath} ${scriptPath} ${args.join(' ')}`);
  
  // Add error handler to catch spawn errors
  const child = spawn(bunPath, [scriptPath, ...args], {
    detached: true,
    stdio: ['ignore', logStream, logStream],
    env,
    cwd: process.cwd()
  });
  
  // Handle spawn errors
  child.on('error', (error) => {
    console.error(`❌ Failed to spawn LinkedIn automation: ${error.message}`);
    console.error(`   Bun path: ${bunPath}`);
    console.error(`   Script path: ${scriptPath}`);
    console.error(`   Error: ${error}`);
    try {
      fs.closeSync(logStream);
    } catch (e) {
      // Ignore close errors
    }
  });
  
  // Check if spawn failed immediately
  if (!child.pid) {
    throw new Error(`Failed to spawn LinkedIn automation process. Bun path: ${bunPath}, Script: ${scriptPath}`);
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

