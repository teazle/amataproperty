'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { AlertCircle, RefreshCw, Trash2, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

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

interface ProcessData {
  all: ProcessInfo[];
  active: ProcessInfo[];
  orphaned: ProcessInfo[];
  counts: {
    total: number;
    active: number;
    orphaned: number;
  };
}

export function ChromiumProcessManager() {
  const [processes, setProcesses] = useState<ProcessData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isKilling, setIsKilling] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchProcesses = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/scraper/kill-orphaned-processes');
      const data = await response.json();
      
      if (data.success) {
        setProcesses(data.processes);
      } else {
        toast.error('Failed to fetch processes', {
          description: data.error
        });
      }
    } catch (error) {
      toast.error('Error fetching processes', {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProcesses();
    
    if (autoRefresh) {
      const interval = setInterval(fetchProcesses, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const killOrphaned = async () => {
    if (!processes || processes.counts.orphaned === 0) {
      toast.info('No orphaned processes to kill');
      return;
    }

    setIsKilling(true);
    try {
      const response = await fetch('/api/scraper/kill-orphaned-processes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ killAll: true }),
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success(`Killed ${data.killed} orphaned Chromium process(es)`);
        // Refresh processes after a delay
        setTimeout(fetchProcesses, 1000);
      } else {
        toast.error('Failed to kill processes', {
          description: data.errors?.join(', ') || data.error
        });
      }
    } catch (error) {
      toast.error('Error killing processes', {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setIsKilling(false);
    }
  };

  const killSpecific = async (pid: number) => {
    setIsKilling(true);
    try {
      const response = await fetch('/api/scraper/kill-orphaned-processes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pids: [pid] }),
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success(`Killed process ${pid}`);
        setTimeout(fetchProcesses, 1000);
      } else {
        toast.error(`Failed to kill process ${pid}`, {
          description: data.errors?.join(', ') || data.error
        });
      }
    } catch (error) {
      toast.error('Error killing process', {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setIsKilling(false);
    }
  };

  if (!processes) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Chromium Process Manager</CardTitle>
          <CardDescription>Loading process information...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Scraper Chromium Process Manager
            </CardTitle>
            <CardDescription>
              Monitor and kill orphaned Chromium processes from scrapers only (Playwright/Playwright-Ghost processes)
              <br />
              <span className="text-xs text-amber-600">⚠️ Only targets scraper-related processes, not system Chrome or other services</span>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? 'Auto-refresh: ON' : 'Auto-refresh: OFF'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchProcesses}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-600">Total Processes</div>
              <div className="text-2xl font-bold">{processes.counts.total}</div>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <div className="text-sm text-green-600">Active (Protected)</div>
              <div className="text-2xl font-bold text-green-700">{processes.counts.active}</div>
            </div>
            <div className="bg-red-50 rounded-lg p-4">
              <div className="text-sm text-red-600">Orphaned</div>
              <div className="text-2xl font-bold text-red-700">{processes.counts.orphaned}</div>
            </div>
          </div>

          {/* Warning if many processes */}
          {processes.counts.total > 20 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-amber-800">
                  High number of Chromium processes detected ({processes.counts.total})
                </div>
                <div className="text-sm text-amber-700 mt-1">
                  {processes.counts.orphaned > 0 
                    ? `You have ${processes.counts.orphaned} orphaned processes that can be safely killed.`
                    : 'All processes appear to be part of active jobs. Wait for jobs to complete or check for stuck jobs.'}
                </div>
              </div>
            </div>
          )}

          {/* Kill All Orphaned Button */}
          {processes.counts.orphaned > 0 && (
            <div className="flex justify-end">
              <Button
                variant="destructive"
                onClick={killOrphaned}
                disabled={isKilling}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {isKilling 
                  ? `Killing ${processes.counts.orphaned} process(es)...` 
                  : `Kill All Orphaned (${processes.counts.orphaned})`}
              </Button>
            </div>
          )}

          {/* Active Processes */}
          {processes.counts.active > 0 && (
            <div>
              <h3 className="font-semibold text-sm text-gray-700 mb-2 flex items-center gap-2">
                <Badge variant="default" className="bg-green-500">Active</Badge>
                Protected Processes (part of active scraping jobs)
              </h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {processes.active.map((proc) => (
                  <div
                    key={proc.pid}
                    className="bg-green-50 border border-green-200 rounded p-3 text-sm font-mono"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">PID: {proc.pid}</span>
                          {proc.memory && <span className="text-gray-600">({proc.memory})</span>}
                        </div>
                        <div className="text-xs text-gray-600 mt-1 truncate" title={proc.cmd}>
                          {proc.cmd.substring(0, 100)}...
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Orphaned Processes */}
          {processes.counts.orphaned > 0 && (
            <div>
              <h3 className="font-semibold text-sm text-gray-700 mb-2 flex items-center gap-2">
                <Badge variant="destructive">Orphaned</Badge>
                Safe to Kill ({processes.counts.orphaned})
              </h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {processes.orphaned.map((proc) => (
                  <div
                    key={proc.pid}
                    className="bg-red-50 border border-red-200 rounded p-3 text-sm font-mono"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">PID: {proc.pid}</span>
                          {proc.memory && <span className="text-gray-600">({proc.memory})</span>}
                          {proc.cpu && <span className="text-gray-600">CPU: {proc.cpu}</span>}
                        </div>
                        <div className="text-xs text-gray-600 mt-1 truncate" title={proc.cmd}>
                          {proc.cmd.substring(0, 100)}...
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => killSpecific(proc.pid)}
                        disabled={isKilling}
                        className="ml-2 text-red-600 hover:text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No orphaned processes message */}
          {processes.counts.orphaned === 0 && processes.counts.total > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center text-sm text-green-700">
              ✅ No orphaned scraper processes found. All Playwright Chromium processes are part of active scraping jobs.
            </div>
          )}

          {/* No processes at all */}
          {processes.counts.total === 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-sm text-gray-600">
              No scraper-related Chromium processes found. All processes have been cleaned up.
              <br />
              <span className="text-xs text-gray-500 mt-1 block">
                Note: System Chrome/Chromium and other services are not monitored here.
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
