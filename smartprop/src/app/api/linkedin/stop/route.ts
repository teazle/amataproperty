import { NextResponse } from 'next/server';
import {
  readLockFile,
  writeLockFile,
  deleteLockFile,
  isProcessRunning
} from '@/lib/linkedin/storage';
import { terminateLinkedInProcess } from '@/lib/linkedin/automation';

export async function POST() {
  const lockData = readLockFile();
  if (!lockData || lockData.status !== 'running') {
    return NextResponse.json(
      { error: 'LinkedIn automation is not running' },
      { status: 400 }
    );
  }

  lockData.status = 'stopping';
  writeLockFile(lockData);
  console.log('⏹️ Stop signal requested via API (status updated)');

  let killResult = 'not attempted';
  if (lockData.pid) {
    try {
      if (await isProcessRunning(lockData.pid)) {
        killResult = await terminateLinkedInProcess(lockData.pid, { forceAfterMs: 3000 });
        console.log(`⏹️ ${killResult}`);
      } else {
        killResult = 'process already exited';
      }
    } catch (error: any) {
      killResult = `error: ${error.message}`;
      console.error(`❌ Error sending SIGTERM to PID ${lockData.pid}:`, error);
    }
  }

  const stillRunning = lockData.pid ? await isProcessRunning(lockData.pid) : false;
  if (!stillRunning) {
    deleteLockFile();
    console.log('🧹 LinkedIn lock file removed after stop');
  }

  return NextResponse.json({
    success: true,
    message: 'Stop signal sent',
    detail: killResult
  });
}
