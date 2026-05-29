/**
 * Browser Process Cleanup Utility
 * 
 * This module provides utilities to clean up orphaned Chromium/Chrome processes
 * that may be left behind when scrapers crash or are killed (e.g., OOM kills).
 */

import { exec,execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Kill all Chromium/Chrome processes that are not associated with active scraper processes
 * This is a safety mechanism to prevent memory leaks from orphaned browser processes
 */
export async function cleanupOrphanedBrowsers(): Promise<{
  killed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let killed = 0;

  try {
    // Get all Chromium/Chrome processes
    const { stdout: chromiumProcs } = await execAsync(
      "ps aux | grep -E 'chromium|chrome|playwright' | grep -v grep | awk '{print $2}' || true"
    );

    const pids = chromiumProcs
      .trim()
      .split('\n')
      .filter((pid) => pid && pid.match(/^\d+$/))
      .map((pid) => parseInt(pid, 10));

    if (pids.length === 0) {
      return { killed: 0, errors: [] };
    }

    console.log(`[BrowserCleanup] Found ${pids.length} Chromium/Chrome processes to check`);

    // Get all active scraper processes (bun processes running scraper scripts)
    const { stdout: scraperProcs } = await execAsync(
      "ps aux | grep -E 'pg\\.districts|ep\\.live|scraper-worker' | grep -v grep | awk '{print $2}' || true"
    );

    const scraperPids = scraperProcs
      .trim()
      .split('\n')
      .filter((pid) => pid && pid.match(/^\d+$/))
      .map((pid) => parseInt(pid, 10));

    console.log(`[BrowserCleanup] Found ${scraperPids.length} active scraper processes`);

    // For each Chromium process, check if it's a child of an active scraper
    for (const pid of pids) {
      try {
        // Get parent process ID
        const { stdout: ppidStr } = await execAsync(`ps -o ppid= -p ${pid} 2>/dev/null || echo ""`);
        const ppid = parseInt(ppidStr.trim(), 10);

        // Check if parent is a scraper process or if parent is dead
        const isOrphaned = !scraperPids.includes(ppid) && ppid > 1;

        if (isOrphaned) {
          // Check if parent process still exists
          try {
            execSync(`ps -p ${ppid} > /dev/null 2>&1`);
            // Parent exists but is not a scraper - might be legitimate, skip
            continue;
          } catch {
            // Parent doesn't exist - this is an orphaned process
            console.log(`[BrowserCleanup] Killing orphaned Chromium process ${pid} (parent ${ppid} is dead)`);
            try {
              execSync(`kill -9 ${pid} 2>/dev/null || true`);
              killed++;
            } catch (killError) {
              errors.push(`Failed to kill PID ${pid}: ${killError}`);
            }
          }
        }
      } catch (error) {
        // Process might have already exited, skip
        continue;
      }
    }

    // Also kill any Chromium processes that are consuming too much memory (>2GB)
    // This is a safety measure for runaway processes
    try {
      const { stdout: highMemProcs } = await execAsync(
        "ps aux | grep -E 'chromium|chrome' | grep -v grep | awk '$6 > 2000000 {print $2}' || true"
      );

      const highMemPids = highMemProcs
        .trim()
        .split('\n')
        .filter((pid) => pid && pid.match(/^\d+$/))
        .map((pid) => parseInt(pid, 10));

      for (const pid of highMemPids) {
        // Check if it's already in our killed list
        if (!pids.includes(pid)) {
          console.log(`[BrowserCleanup] Killing high-memory Chromium process ${pid} (>2GB)`);
          try {
            execSync(`kill -9 ${pid} 2>/dev/null || true`);
            killed++;
          } catch (killError) {
            errors.push(`Failed to kill high-memory PID ${pid}: ${killError}`);
          }
        }
      }
    } catch (error) {
      // Ignore errors in high-memory check
    }

    if (killed > 0) {
      console.log(`[BrowserCleanup] Cleaned up ${killed} orphaned browser process(es)`);
    }

    return { killed, errors };
  } catch (error) {
    errors.push(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    return { killed, errors };
  }
}

/**
 * Force kill all Chromium/Chrome processes (use with caution)
 * This should only be used as a last resort when the system is out of memory
 */
export async function forceKillAllBrowsers(): Promise<number> {
  try {
    const { stdout: _stdout } = await execAsync(
      "pkill -9 -f 'chromium|chrome|playwright' 2>/dev/null || true"
    );
    
    // Count how many were killed
    const { stdout: count } = await execAsync(
      "ps aux | grep -E 'chromium|chrome|playwright' | grep -v grep | wc -l || echo 0"
    );
    
    const beforeCount = parseInt(count.trim(), 10);
    
    // Wait a moment
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    const { stdout: afterCount } = await execAsync(
      "ps aux | grep -E 'chromium|chrome|playwright' | grep -v grep | wc -l || echo 0"
    );
    
    const after = parseInt(afterCount.trim(), 10);
    const killed = Math.max(0, beforeCount - after);
    
    console.log(`[BrowserCleanup] Force killed ${killed} browser process(es)`);
    return killed;
  } catch (error) {
    console.error(`[BrowserCleanup] Force kill failed:`, error);
    return 0;
  }
}

/**
 * Get count of active Chromium/Chrome processes
 */
export async function getBrowserProcessCount(): Promise<number> {
  try {
    const { stdout } = await execAsync(
      "ps aux | grep -E 'chromium|chrome|playwright' | grep -v grep | wc -l || echo 0"
    );
    return parseInt(stdout.trim(), 10);
  } catch {
    return 0;
  }
}

/**
 * Start periodic cleanup of orphaned browsers
 * Runs every 5 minutes
 */
export function startPeriodicCleanup(intervalMs: number = 5 * 60 * 1000): NodeJS.Timeout {
  console.log(`[BrowserCleanup] Starting periodic cleanup (every ${intervalMs / 1000}s)`);
  
  const interval = setInterval(async () => {
    try {
      const result = await cleanupOrphanedBrowsers();
      if (result.killed > 0) {
        console.log(`[BrowserCleanup] Periodic cleanup: killed ${result.killed} orphaned process(es)`);
      }
    } catch (error) {
      console.error(`[BrowserCleanup] Periodic cleanup error:`, error);
    }
  }, intervalMs);

  return interval;
}

