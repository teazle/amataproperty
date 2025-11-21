import { NextResponse } from 'next/server';
import { readLockFile, writeLockFile } from '@/lib/linkedin/storage';

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
  console.log('⏹️ Stop signal requested via API');

  return NextResponse.json({
    success: true,
    message: 'Stop signal sent'
  });
}

