import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * POST /api/linkedin/scan
 * Trigger LinkedIn automation scan
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dryRun } = body;

    // Check if already running
    const lockFile = path.join(process.cwd(), 'storage', 'linkedin.lock.json');
    if (fs.existsSync(lockFile)) {
      try {
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
        if (lockData.status === 'running') {
          // Check if process is actually running
          try {
            process.kill(lockData.pid, 0); // Signal 0 checks if process exists
            return NextResponse.json(
              { error: 'LinkedIn automation is already running' },
              { status: 409 }
            );
          } catch (e) {
            // Process doesn't exist, clean up stale lock
            fs.unlinkSync(lockFile);
          }
        }
      } catch (e) {
        // Invalid lock file, clean it up
        fs.unlinkSync(lockFile);
      }
    }

    // Start LinkedIn automation in background
    const scriptPath = path.join(process.cwd(), 'src', 'workers', 'linkedin.ts');
    const args = dryRun ? ['--dry-run'] : [];
    const logFile = '/tmp/linkedin-automation.log';
    
    // Open log file for writing (append mode)
    const logStream = fs.openSync(logFile, 'a');
    
    const child = spawn('bun', [scriptPath, ...args], {
      detached: true,
      stdio: ['ignore', logStream, logStream], // Redirect stdout and stderr to log file
      cwd: process.cwd()
    });

    // Close log file descriptor after a short delay to allow process to start
    setTimeout(() => {
      try {
        fs.closeSync(logStream);
      } catch (e) {
        // Ignore errors if already closed
      }
    }, 1000);

    child.unref(); // Allow parent to exit

    return NextResponse.json({
      success: true,
      message: 'LinkedIn automation started',
      pid: child.pid,
      dryRun
    });
  } catch (error: any) {
    console.error('Error starting LinkedIn automation:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to start LinkedIn automation' },
      { status: 500 }
    );
  }
}

