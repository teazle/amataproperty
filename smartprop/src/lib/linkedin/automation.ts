import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  getLockFilePath,
  readLockFile,
  isProcessRunning
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
  if (lockData?.status === 'running' && lockData.pid) {
    const running = await isProcessRunning(lockData.pid);
    if (running) {
      throw new Error('LinkedIn automation is already running');
    }
  }

  const scriptPath = path.join(process.cwd(), 'src', 'workers', 'linkedin.ts');
  const args = options.dryRun ? ['--dry-run'] : [];

  const logStream = fs.openSync(LOG_FILE_PATH, 'a');
  const env = {
    ...process.env,
    ...(options.headed
      ? {
          HEADLESS: '0',
          DISPLAY: process.env.LINKEDIN_DISPLAY || ':99'
        }
      : {})
  };

  const child = spawn('bun', [scriptPath, ...args], {
    detached: true,
    stdio: ['ignore', logStream, logStream],
    env,
    cwd: process.cwd()
  });

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

