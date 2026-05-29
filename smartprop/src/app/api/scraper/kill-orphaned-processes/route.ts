/**
 * API endpoint to list and kill orphaned Chromium processes
 *
 * This endpoint identifies Chromium processes that are not part of active scraping jobs
 * and allows killing them from the frontend.
 */

import { createClient } from '@supabase/supabase-js';
import { exec,execSync } from 'child_process';
import fs from 'fs';
import { NextRequest,NextResponse } from 'next/server';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface ProcessInfo {
  pid: number;
  ppid: number;
  cmd: string;
  memory?: string;
  cpu?: string;
  isActive: boolean;
  jobId?: string;
  platform?: string;
}

/**
 * Get PIDs from active job lock files
 */
async function getActiveJobPids(): Promise<Set<number>> {
  const activePids = new Set<number>();

  try {
    // Check for active jobs in database
    const { data: activeJobs } = await supabase
      .from('scraper_jobs')
      .select('id, platform')
      .in('status', ['queued', 'running'])
      .limit(10);

    if (activeJobs) {
      for (const job of activeJobs) {
        // Check lock file for PID
        const lockFile = path.join(
          process.cwd(),
          'storage',
          job.platform === 'propertyguru' ? 'pg-scraper.lock' : 'ep-scraper.lock'
        );

        if (fs.existsSync(lockFile)) {
          try {
            const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
            if (lockData.pid && typeof lockData.pid === 'number') {
              activePids.add(lockData.pid);

              // Also check for child processes
              try {
                const { stdout } = await execAsync(`pgrep -P ${lockData.pid}`);
                stdout.trim().split('\n').forEach((childPid) => {
                  const pid = parseInt(childPid.trim());
                  if (!isNaN(pid)) activePids.add(pid);
                });
              } catch {
                // No child processes or error checking
              }
            }
          } catch (error) {
            console.error(`Error reading lock file ${lockFile}:`, error);
          }
        }
      }
    }

    // Also check for processes by pattern (in case lock files are missing)
    // Only check for our scraper scripts - these are the only ones we care about
    try {
      const { stdout: pgProcesses } = await execAsync('pgrep -f "pg.districts.ts" || true');
      const { stdout: epProcesses } = await execAsync('pgrep -f "ep.live.ts" || true');
      const { stdout: articleProcesses } = await execAsync('pgrep -f "edgeprop.*scraper" || true');

      [...pgProcesses.trim().split('\n'),
       ...epProcesses.trim().split('\n'),
       ...articleProcesses.trim().split('\n')].forEach((pidStr) => {
        const pid = parseInt(pidStr.trim());
        if (!isNaN(pid)) activePids.add(pid);
      });
    } catch {
      // Error getting process PIDs
    }

  } catch (error) {
    console.error('Error getting active job PIDs:', error);
  }

  return activePids;
}

/**
 * Get all Chromium processes
 */
async function getAllChromiumProcesses(): Promise<ProcessInfo[]> {
  try {
    // Get all chromium/chrome processes with their details
    // Use ps command with custom format for better parsing
    const { stdout } = await execAsync(
      `ps -eo pid,ppid,pcpu,rss,comm,args | grep -E "(chromium|chrome|playwright)" | grep -v grep || true`
    );

    const processes: ProcessInfo[] = [];
    const lines = stdout.trim().split('\n').filter(line => line.trim());

    // First, get all parent PIDs that are our scraper scripts (for faster lookup)
    const scraperParentPids = new Set<number>();
    try {
      const { stdout: pgProcesses } = await execAsync('pgrep -f "pg.districts.ts" || true');
      const { stdout: epProcesses } = await execAsync('pgrep -f "ep.live.ts" || true');
      const { stdout: articleProcesses } = await execAsync('pgrep -f "edgeprop.*scraper" || true');

      [...pgProcesses.trim().split('\n'),
       ...epProcesses.trim().split('\n'),
       ...articleProcesses.trim().split('\n')].forEach((pidStr) => {
        const pid = parseInt(pidStr.trim());
        if (!isNaN(pid)) scraperParentPids.add(pid);
      });
    } catch {
      // Error getting scraper PIDs
    }

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const pid = parseInt(parts[0]);
        const ppid = parseInt(parts[1]);
        const cpu = parts[2];
        const rss = parts[3]; // Memory in KB
        // Command starts from column 5 onwards
        const cmd = parts.slice(4).join(' ');

        // CRITICAL: Only target Chromium processes from Playwright/scrapers, NOT system Chrome
        // Filter criteria - process must be:
        // 1. From Playwright cache (.cache/ms-playwright) - this is where Playwright installs Chromium
        // 2. OR parent process is one of our scraper scripts
        // EXCLUDE: System Chrome, Flaresolverr (runs in Docker), or other system processes

        const isPlaywrightChromium = cmd.includes('/.cache/ms-playwright') &&
                                      (cmd.includes('chromium') || cmd.includes('chrome'));

        // Check if parent is a scraper script (fast lookup)
        const isScraperChild = scraperParentPids.has(ppid);

        // Exclude system Chrome and Flaresolverr
        const isSystemChrome = (cmd.includes('chromium') || cmd.includes('chrome')) &&
                               !cmd.includes('/.cache/ms-playwright') &&
                               !cmd.includes('playwright') &&
                               !isScraperChild;

        const isFlaresolverr = cmd.includes('flaresolverr') || cmd.includes('8191');

        // Only include Playwright Chromium processes that are from scrapers
        // This ensures we ONLY target scraper-related processes, not system Chrome
        if (!isNaN(pid) && !isNaN(ppid) &&
            (isPlaywrightChromium || isScraperChild) &&
            !isSystemChrome &&
            !isFlaresolverr) {
          const memoryMB = rss ? Math.round(parseInt(rss) / 1024) : 0;
          processes.push({
            pid,
            ppid,
            cmd,
            memory: memoryMB > 0 ? `${memoryMB}MB` : undefined,
            cpu: cpu ? `${parseFloat(cpu).toFixed(1)}%` : undefined,
            isActive: false, // Will be set below
          });
        }
      }
    }

    // Get active job PIDs and mark processes as active
    const activePids = await getActiveJobPids();

    // Also check parent processes recursively
    const allActivePids = new Set(activePids);
    for (const pid of activePids) {
      // Get all descendant processes
      try {
        const { stdout: children } = await execAsync(`pstree -p ${pid} 2>/dev/null | grep -oP '\\d+' || true`);
        children.trim().split('\n').forEach((childPid) => {
          const pidNum = parseInt(childPid.trim());
          if (!isNaN(pidNum)) allActivePids.add(pidNum);
        });
      } catch {
        // Error getting children
      }
    }

    // Mark processes as active if they're in the active set or are children of active processes
    processes.forEach((proc) => {
      if (allActivePids.has(proc.pid) || allActivePids.has(proc.ppid)) {
        proc.isActive = true;
      }
    });

    return processes;

  } catch (error) {
    console.error('Error getting Chromium processes:', error);
    return [];
  }
}

/**
 * Kill orphaned Chromium processes
 */
async function killOrphanedProcesses(pidList?: number[]): Promise<{ killed: number; errors: string[] }> {
  const errors: string[] = [];
  let killed = 0;

  // Security: Validate all PIDs are valid integers to prevent command injection
  const validatePid = (pid: unknown): number | null => {
    if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && pid < 2147483647) {
      return pid;
    }
    if (typeof pid === 'string') {
      const parsed = parseInt(pid, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed < 2147483647) {
        return parsed;
      }
    }
    return null;
  };

  try {
    if (pidList && pidList.length > 0) {
      // Kill specific PIDs
      for (const pidInput of pidList) {
        const pid = validatePid(pidInput);
        if (!pid) {
          errors.push(`Invalid PID: ${pidInput}`);
          continue;
        }

        try {
          // Use execSync with validated PID (already validated above)
          // Since PID is validated as integer, it's safe to use in template string
          // But we'll use it as a number to ensure no string injection
          execSync(`kill -TERM ${pid} 2>/dev/null || true`);
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Check if still running and force kill
          try {
            execSync(`ps -p ${pid} > /dev/null 2>&1`);
            execSync(`kill -KILL ${pid} 2>/dev/null || true`);
            killed++;
          } catch {
            // Process already dead
            killed++;
          }
        } catch (error) {
          errors.push(`Failed to kill PID ${pid}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else {
      // Kill all orphaned processes
      const processes = await getAllChromiumProcesses();
      const orphaned = processes.filter(p => !p.isActive);

      for (const proc of orphaned) {
        // Validate PID from process list (should already be safe, but double-check)
        const pid = validatePid(proc.pid);
        if (!pid) {
          errors.push(`Invalid PID in process list: ${proc.pid}`);
          continue;
        }

        try {
          // Use execSync with validated PID (already validated above)
          // Since PID is validated as integer, it's safe to use in template string
          execSync(`pkill -TERM -P ${pid} 2>/dev/null || true`);
          execSync(`kill -TERM ${pid} 2>/dev/null || true`);
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Force kill if still running
          try {
            execSync(`ps -p ${pid} > /dev/null 2>&1`);
            execSync(`pkill -KILL -P ${pid} 2>/dev/null || true`);
            execSync(`kill -KILL ${pid} 2>/dev/null || true`);
            killed++;
          } catch {
            // Process already dead
            killed++;
          }
        } catch (error) {
          errors.push(`Failed to kill PID ${pid}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  } catch (error) {
    errors.push(`Error killing processes: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { killed, errors };
}

export async function GET(_request: NextRequest) {
  try {
    const processes = await getAllChromiumProcesses();
    const orphaned = processes.filter(p => !p.isActive);
    const active = processes.filter(p => p.isActive);

    return NextResponse.json({
      success: true,
      processes: {
        all: processes,
        active: active,
        orphaned: orphaned,
        counts: {
          total: processes.length,
          active: active.length,
          orphaned: orphaned.length,
        }
      }
    });
  } catch (error) {
    console.error('Error listing Chromium processes:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // TODO: Add authentication/authorization here
    // This endpoint allows killing processes and should be protected

    const body = await request.json();
    const { pids, killAll } = body;

    if (killAll) {
      // Kill all orphaned processes
      const result = await killOrphanedProcesses();
      return NextResponse.json({
        success: result.errors.length === 0,
        killed: result.killed,
        errors: result.errors
      });
    } else if (pids && Array.isArray(pids) && pids.length > 0) {
      // Validate PIDs before processing
      // Security: Ensure all PIDs are valid numbers to prevent command injection
      const validPids = pids.filter((pid: unknown) => {
        if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) return true;
        if (typeof pid === 'string') {
          const parsed = parseInt(pid, 10);
          return !isNaN(parsed) && parsed > 0;
        }
        return false;
      });

      if (validPids.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No valid PIDs provided' },
          { status: 400 }
        );
      }

      // Kill specific PIDs
      const result = await killOrphanedProcesses(validPids);
      return NextResponse.json({
        success: result.errors.length === 0,
        killed: result.killed,
        errors: result.errors
      });
    } else {
      return NextResponse.json(
        { success: false, error: 'No PIDs provided' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Error killing Chromium processes:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
