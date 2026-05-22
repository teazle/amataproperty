import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { readLockFile } from '@/lib/linkedin/storage';

const LOG_FILE_PATH = '/tmp/linkedin-reauth.log';

export async function POST() {
  try {
    const current = readLockFile();
    if (current?.status === 'reauth_required' && current.pid) {
      try {
        process.kill(current.pid, 0);
        return NextResponse.json({
          success: true,
          message: 'LinkedIn reauth is already running or waiting',
          pid: current.pid,
          reauth: current,
        });
      } catch {
        // stale reauth lock is overwritten by the new process
      }
    }

    fs.writeFileSync(LOG_FILE_PATH, '');
    const logStream = fs.openSync(LOG_FILE_PATH, 'a');
    const scriptPath = path.join(process.cwd(), 'scripts', 'linkedin-reauth.ts');

    const child = spawn('npx', ['--yes', 'tsx', scriptPath], {
      detached: true,
      stdio: ['ignore', logStream, logStream],
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      },
    });

    if (!child.pid) {
      throw new Error('Failed to start LinkedIn reauth process');
    }

    child.unref();
    setTimeout(() => {
      try {
        fs.closeSync(logStream);
      } catch {
        // ignore close errors
      }
    }, 1000);

    return NextResponse.json({
      success: true,
      message: 'LinkedIn reauth started',
      pid: child.pid,
      logFile: LOG_FILE_PATH,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start LinkedIn reauth' },
      { status: 500 }
    );
  }
}
