/**
 * LinkedIn session storage utilities
 * Handles saving and loading LinkedIn authentication state
 */

import fs from 'fs';
import path from 'path';

const STORAGE_DIR = path.join(process.cwd(), 'storage');
const STORAGE_FILE = path.join(STORAGE_DIR, 'linkedin.state.json');
const SESSION_STORAGE_FILE = path.join(STORAGE_DIR, 'linkedin.sessionStorage.json');
const LOCK_FILE = path.join(STORAGE_DIR, 'linkedin.lock.json');

export interface LinkedInLockData {
  pid: number;
  status: 'running' | 'stopping' | 'stopped' | 'reauth_required';
  startedAt: string;
  lastHeartbeatAt?: string;
  stoppedAt?: string;
  contactsProcessed: number;
  messagesSent: number;
  messagesFailed: number;
  currentContactIndex: number;
  lastContactName?: string;
  error?: string;
  reauthLiveUrl?: string | null;
  reauthBrowserId?: string | null;
  reauthStartedAt?: string;
  reauthDeadlineAt?: string;
  authVerifiedAt?: string;
  authCheck?: {
    feed: boolean;
    catchUp: boolean;
    currentUrl?: string;
    reason?: string;
  };
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

function archiveOrDeleteFile(filePath: string, label: string, force: boolean, reason: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  if (force) {
    fs.unlinkSync(filePath);
    console.log(`🗑️  Deleted ${label}`);
    return;
  }

  const safeReason = reason.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'invalid';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivedPath = `${filePath}.${safeReason}-${timestamp}`;
  fs.renameSync(filePath, archivedPath);
  console.log(`📦 Archived ${label}: ${archivedPath}`);
}

/**
 * Remove storage state. By default this archives files so a false-negative
 * session check cannot destroy the last usable LinkedIn cookies.
 */
export function deleteStorageState(options: { force?: boolean; reason?: string } = {}): void {
  const force = options.force === true;
  const reason = options.reason || 'invalid';

  if (fs.existsSync(STORAGE_FILE)) {
    archiveOrDeleteFile(STORAGE_FILE, 'LinkedIn session file', force, reason);
  }
  if (fs.existsSync(SESSION_STORAGE_FILE)) {
    archiveOrDeleteFile(SESSION_STORAGE_FILE, 'LinkedIn sessionStorage file', force, reason);
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

export function getLockAgeMs(lockData: LinkedInLockData, now = Date.now()): number {
  const startedAt = Date.parse(lockData.startedAt);
  return Number.isFinite(startedAt) ? now - startedAt : 0;
}

export function getLinkedInMaxRunMs(): number {
  const minutes = process.env.LINKEDIN_MAX_RUN_MINUTES
    ? Number.parseInt(process.env.LINKEDIN_MAX_RUN_MINUTES, 10)
    : 120;
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 120;
  return safeMinutes * 60 * 1000;
}

export function isLinkedInLockExpired(lockData: LinkedInLockData, now = Date.now()): boolean {
  return lockData.status === 'running' && getLockAgeMs(lockData, now) > getLinkedInMaxRunMs();
}
