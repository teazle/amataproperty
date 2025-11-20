/**
 * LinkedIn session storage utilities
 * Handles saving and loading LinkedIn authentication state
 */

import fs from 'fs';
import path from 'path';

const STORAGE_DIR = path.join(process.cwd(), 'storage');
const STORAGE_FILE = path.join(STORAGE_DIR, 'linkedin.state.json');
const LOCK_FILE = path.join(STORAGE_DIR, 'linkedin.lock.json');

export interface LinkedInLockData {
  pid: number;
  status: 'running' | 'stopping' | 'stopped';
  startedAt: string;
  contactsProcessed: number;
  messagesSent: number;
  messagesFailed: number;
  currentContactIndex: number;
  lastContactName?: string;
  error?: string;
}

/**
 * Ensure storage directory exists
 */
export function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/**
 * Get storage state file path
 */
export function getStorageStatePath(): string {
  ensureStorageDir();
  return STORAGE_FILE;
}

/**
 * Check if storage state file exists
 */
export function hasStorageState(): boolean {
  return fs.existsSync(STORAGE_FILE);
}

/**
 * Delete storage state file
 */
export function deleteStorageState(): void {
  if (fs.existsSync(STORAGE_FILE)) {
    fs.unlinkSync(STORAGE_FILE);
    console.log('🗑️  Deleted invalid session file');
  }
}

/**
 * Get lock file path
 */
export function getLockFilePath(): string {
  ensureStorageDir();
  return LOCK_FILE;
}

/**
 * Create or update lock file
 */
export function writeLockFile(data: LinkedInLockData): void {
  ensureStorageDir();
  fs.writeFileSync(LOCK_FILE, JSON.stringify(data, null, 2));
}

/**
 * Read lock file
 */
export function readLockFile(): LinkedInLockData | null {
  if (!fs.existsSync(LOCK_FILE)) {
    return null;
  }
  try {
    const content = fs.readFileSync(LOCK_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to read lock file:', error);
    return null;
  }
}

/**
 * Delete lock file
 */
export function deleteLockFile(): void {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }
}

/**
 * Check if process with given PID is running
 */
export async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    // Send signal 0 to check if process exists (doesn't actually kill it)
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    // If error code is ESRCH, process doesn't exist
    if (error.code === 'ESRCH') {
      return false;
    }
    // Other errors might mean we don't have permission, assume running
    return true;
  }
}

