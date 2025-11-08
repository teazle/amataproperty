'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { stopScraperJob, forceResetStuckJobs } from '../actions';
import { toast } from 'sonner';
import { useState, useEffect, useRef } from 'react';

interface JobProgress {
  platform?: string;
  listingsProcessed?: number;
  totalPages?: number;
  currentPage?: number;
  currentDistrict?: string;
  statusMessage?: string;
  stats?: {
    totalSuccess?: number;
    saved?: number;
    totalSkippedNoPhone?: number;
    skipped?: number;
    totalErrors?: number;
    errors?: number;
  };
}

interface LiveProgressPanelProps {
  job: JobProgress;
  onJobStopped?: () => void;
}

export function LiveProgressPanel({ job, onJobStopped }: LiveProgressPanelProps) {
  const [isStopping, setIsStopping] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const handleStopScraper = async () => {
    setIsStopping(true);
    try {
      const result = await stopScraperJob();
      if (result.success) {
        toast.success(result.message);
        onJobStopped?.();
      } else {
        toast.error(result.error || 'Failed to stop scraper');
      }
    } catch (error) {
      toast.error('Failed to stop scraper');
      console.error('Error stopping scraper:', error);
    } finally {
      setIsStopping(false);
    }
  };

  const handleForceReset = async () => {
    if (!confirm('Are you sure you want to force reset stuck jobs? This will mark all active jobs as failed and clear lock files. Use this if the scraper appears stuck.')) {
      return;
    }
    
    setIsResetting(true);
    try {
      const result = await forceResetStuckJobs();
      if (result.success) {
        toast.success(result.message || `Reset ${result.jobsReset || 0} stuck job(s)`);
        onJobStopped?.();
        // Reload page after a delay to clear stale state
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        toast.error(result.error || 'Failed to reset stuck jobs');
      }
    } catch (error) {
      toast.error('Failed to reset stuck jobs');
      console.error('Error resetting stuck jobs:', error);
    } finally {
      setIsResetting(false);
    }
  };

  const handleViewLogs = async () => {
    if (showLogs) {
      // Hide logs and close stream
      setShowLogs(false);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    setIsLoadingLogs(true);
    setShowLogs(true);
    shouldAutoScrollRef.current = true; // Reset auto-scroll when opening logs
    
    // Load initial logs
    try {
      const platform = job.platform || 'edgeprop';
      const response = await fetch(`/api/scraper/logs?platform=${platform}&lines=200`);
      const data = await response.json();
      
      if (data.success) {
        setLogs(data.lines || []);
      } else {
        toast.error(data.error || 'Failed to load logs');
        setLogs([`Error: ${data.error || 'Failed to load logs'}`]);
      }
    } catch (error) {
      toast.error('Failed to load logs');
      console.error('Error loading logs:', error);
      setLogs([`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  // Set up SSE streaming when logs are shown
  useEffect(() => {
    if (!showLogs) {
      return;
    }

    const platform = job.platform || 'edgeprop';
    const eventSource = new EventSource(`${window.location.origin}/api/scraper/logs/stream?platform=${platform}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('Logs SSE connection opened');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'logs') {
          if (data.reset) {
            // File was reset, replace all logs
            setLogs(data.newLines || []);
            shouldAutoScrollRef.current = true;
          } else {
            // Append new lines
            setLogs(prevLogs => {
              const updated = [...prevLogs, ...(data.newLines || [])];
              // Keep only last 2000 lines to prevent memory issues
              return updated.slice(-2000);
            });
          }
          
          // Auto-scroll to bottom only if user hasn't manually scrolled up
          if (shouldAutoScrollRef.current) {
            setTimeout(() => {
              if (logsContainerRef.current) {
                logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
              }
            }, 50);
          }
        } else if (data.type === 'error') {
          console.error('Logs SSE error:', data.message);
          toast.error(`Logs error: ${data.message}`);
        }
        // Ignore heartbeat messages
      } catch (error) {
        console.error('Error parsing logs SSE message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('Logs SSE connection error:', error);
      // SSE will auto-reconnect, so we don't need to handle it manually
    };

    return () => {
      if (eventSource) {
        eventSource.close();
        eventSourceRef.current = null;
      }
    };
  }, [showLogs, job.platform]);

  // Auto-scroll to bottom when logs change (only if user hasn't scrolled up)
  useEffect(() => {
    if (showLogs && logs.length > 0 && shouldAutoScrollRef.current) {
      setTimeout(() => {
        if (logsContainerRef.current) {
          logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [logs, showLogs]);

  // Track user scroll to disable auto-scroll if they scroll up
  useEffect(() => {
    if (!showLogs || !logsContainerRef.current) return;

    const container = logsContainerRef.current;
    const handleScroll = () => {
      // Check if user is near the bottom (within 100px)
      const isNearBottom = 
        container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      shouldAutoScrollRef.current = isNearBottom;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [showLogs]);
  const progress = job.listingsProcessed && job.totalPages 
    ? Math.round((job.listingsProcessed / (job.totalPages * 20)) * 100)
    : 0;

  // Handle both old and new stats formats
  const stats = job.stats || { totalSuccess: 0, totalSkippedNoPhone: 0, totalErrors: 0 };
  const saved = stats.totalSuccess || stats.saved || 0;
  const skipped = stats.totalSkippedNoPhone || stats.skipped || 0;
  const errors = stats.totalErrors || stats.errors || 0;
  
  const phoneSuccessRate = saved > 0 
    ? Math.round((saved / (saved + skipped)) * 100)
    : 100;

  // Check if re-authenticating
  const isReAuth = job.statusMessage?.includes('Re-authenticating') || job.statusMessage?.includes('Re-authenticated');

  return (
    <Card className={`border-2 ${isReAuth ? 'border-amber-500' : 'border-blue-500'}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span className="animate-pulse">{isReAuth ? '🔄' : '🟢'}</span>
            Live Progress - {job.platform === 'propertyguru' ? 'PropertyGuru' : 'EdgeProp'}
          </CardTitle>
          <div className="flex gap-2">
            <Button
              onClick={handleViewLogs}
              disabled={isLoadingLogs}
              variant="outline"
              size="sm"
            >
              {showLogs ? 'Hide Logs' : 'View Logs'}
            </Button>
          <Button
            onClick={handleStopScraper}
              disabled={isStopping || isResetting}
            variant="destructive"
            size="sm"
          >
            {isStopping ? 'Stopping...' : 'Stop Scraper'}
          </Button>
            <Button
              onClick={handleForceReset}
              disabled={isStopping || isResetting}
              variant="outline"
              size="sm"
              className="border-amber-500 text-amber-700 hover:bg-amber-50"
            >
              {isResetting ? 'Resetting...' : 'Force Reset'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Message Banner */}
        {job.statusMessage && (
          <div className={`p-3 rounded-lg text-sm font-medium ${
            isReAuth 
              ? 'bg-amber-50 text-amber-900 border border-amber-200' 
              : 'bg-blue-50 text-blue-900 border border-blue-200'
          }`}>
            {job.statusMessage}
          </div>
        )}

        {/* Current Status */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-700 font-medium">Status:</span>
            <span className="font-semibold text-gray-900">
              {job.currentDistrict && `District ${job.currentDistrict} - `}
              Page {job.currentPage || 1}/{job.totalPages || '?'}
            </span>
          </div>
          
          <Progress value={progress} className="h-3" />
          
          <div className="flex justify-between text-sm">
            <span className="text-gray-700 font-medium">Progress:</span>
            <span className="font-semibold text-gray-900">
              {job.listingsProcessed || 0} / {(job.totalPages || 0) * 20} listings ({progress}%)
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-4 pt-4 border-t">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{saved}</div>
            <div className="text-xs text-gray-700 font-medium">Saved</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-600">{skipped}</div>
            <div className="text-xs text-gray-700 font-medium">Skipped</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{errors}</div>
            <div className="text-xs text-gray-700 font-medium">Errors</div>
          </div>
        </div>

        {/* Phone Success Rate */}
        <div className="pt-4 border-t">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-700 font-medium">Phone Success Rate:</span>
            <span className={`text-lg font-bold ${phoneSuccessRate >= 95 ? 'text-green-600' : phoneSuccessRate >= 80 ? 'text-yellow-600' : 'text-red-600'}`}>
              {phoneSuccessRate}%
            </span>
          </div>
          {phoneSuccessRate < 80 && (
            <p className="text-xs text-amber-600 mt-1">
              ⚠️ Low phone success rate - authentication may need refresh
            </p>
          )}
        </div>

        {/* Logs Viewer */}
        {showLogs && (
          <div className="pt-4 border-t">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">
                Console Logs {showLogs && <span className="text-green-500 text-xs">● Live</span>}
              </span>
              <Button
                onClick={handleViewLogs}
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
              >
                Hide Logs
              </Button>
            </div>
            <div 
              ref={logsContainerRef}
              className="bg-gray-900 p-4 rounded-lg font-mono text-xs overflow-auto max-h-96"
            >
              {isLoadingLogs ? (
                <div className="text-white">Loading logs...</div>
              ) : logs.length === 0 ? (
                <div className="text-white">No logs available</div>
              ) : (
                <pre className="whitespace-pre-wrap text-white">
                  {logs.join('\n')}
                </pre>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

