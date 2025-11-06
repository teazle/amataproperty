'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { stopScraperJob, forceResetStuckJobs } from '../actions';
import { toast } from 'sonner';
import { useState } from 'react';

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

  const handleStopScraper = async () => {
    setIsStopping(true);
    try {
      const result = await stopScraperJob();
      if (result.success) {
        toast.success(result.message);
        onJobStopped?.();
        // Wait a moment before reloading to ensure database update completes and propagates
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        toast.error(result.error || 'Failed to stop scraper');
        setIsStopping(false);
      }
    } catch (error) {
      toast.error('Failed to stop scraper');
      console.error('Error stopping scraper:', error);
      setIsStopping(false);
    }
  };

  const handleForceReset = async () => {
    if (!confirm('Are you sure you want to force reset all stuck jobs? This will mark all active jobs as failed and clear lock files.')) {
      return;
    }
    
    setIsResetting(true);
    try {
      const result = await forceResetStuckJobs();
      if (result.success) {
        toast.success(result.message || `Reset ${result.jobsReset || 0} stuck job(s)`);
        onJobStopped?.();
        // Wait a moment before reloading to ensure database update completes
        setTimeout(() => {
          window.location.reload();
        }, 500);
      } else {
        toast.error(result.error || 'Failed to reset stuck jobs');
        setIsResetting(false);
      }
    } catch (error) {
      toast.error('Failed to reset stuck jobs');
      console.error('Error resetting stuck jobs:', error);
      setIsResetting(false);
    }
  };
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
      </CardContent>
    </Card>
  );
}

