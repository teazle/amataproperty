'use client';

import { useState, useEffect, useRef } from 'react';
import { AuthStatusCard } from './AuthStatusCard';
import { DataQualityDashboard } from './DataQualityDashboard';
import { ScraperConfigForm } from './ScraperConfigForm';
import { LiveProgressPanel } from './LiveProgressPanel';
import { RecentListingsPreview } from './RecentListingsPreview';
import { HistoryTable } from './HistoryTable';
import { ScheduledJobsSection } from './ScheduledJobsSection';
import { ChromiumProcessManager } from './ChromiumProcessManager';
import { getDistrictMetadata, forceResetStuckJobs, diagnoseStuckJobs, forceFixStuckJob, syncCompletedJobs } from '../actions';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface Job {
  id?: string;
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
  [key: string]: unknown;
}

interface District {
  district: string;
  last_scraped_at: string | null;
  total_listings: number;
  last_phone_success_rate: number | null;
  is_favorite: boolean;
}

interface AuthStatus {
  propertyguru: { isAuthenticated: boolean; lastAuth: string | null };
  edgeprop: { isAuthenticated: boolean; lastAuth: string | null };
}

interface QualityMetrics {
  completenessScore: number;
  phoneValidationRate: number;
  duplicatesToday: number;
  staleListings: number;
}

interface JobHistory {
  id: string;
  platform: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  listings_processed: number;
  config?: {
    district?: string;
    pages?: number;
  };
  stats?: {
    saved?: number;
    skipped?: number;
    errors?: number;
  };
}

interface ScraperDashboardProps {
  initialActiveJob: Job | null;
  initialJobHistory: JobHistory[];
  initialDistricts: District[];
  initialQualityMetrics: QualityMetrics;
  initialAuthStatus: AuthStatus;
}

export function ScraperDashboard({
  initialActiveJob,
  initialJobHistory,
  initialDistricts,
  initialQualityMetrics,
  initialAuthStatus
}: ScraperDashboardProps) {
  const [activeJob, setActiveJob] = useState(initialActiveJob);
  const [completedJob, setCompletedJob] = useState<Job | null>(null); // Keep completed job for log review
  const [authStatus, setAuthStatus] = useState(initialAuthStatus);
  const [qualityMetrics, setQualityMetrics] = useState(initialQualityMetrics);
  const [districts, setDistricts] = useState(initialDistricts);
  const [lastJobId, setLastJobId] = useState<string | null | undefined>(initialActiveJob?.id);
  const [isResetting, setIsResetting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [stuckJobInfo, setStuckJobInfo] = useState<any[] | null>(null);

  const handleForceReset = async () => {
    if (!confirm('Are you sure you want to force reset all stuck jobs? This will mark all active jobs as failed and clear lock files. Use this if you cannot start a new scrape.')) {
      return;
    }
    
    setIsResetting(true);
    try {
      const result = await forceResetStuckJobs();
      if (result.success) {
        toast.success(result.message || `Reset ${result.jobsReset || 0} stuck job(s)`);
        setActiveJob(null);
        setLastJobId(null);
        setStuckJobInfo(null);
        // Wait longer to ensure database update completes and propagates
        // The force reset function now does extensive verification, so we wait a bit more
        setTimeout(() => {
          // Force a hard reload to clear any cached state
          window.location.reload();
        }, 2000);
      } else {
        const errorMsg = result.error || 'Failed to reset stuck jobs';
        toast.error(errorMsg, {
          duration: 10000, // Show for 10 seconds
          description: result.stuckJobs ? `Stuck job IDs: ${result.stuckJobs.map((j: any) => j.id).join(', ')}` : undefined
        });
        console.error('Force reset failed:', result);
        
        // If there are stuck jobs, fetch diagnostic info
        if (result.stuckJobs && result.stuckJobs.length > 0) {
          const diagnostic = await diagnoseStuckJobs();
          if (diagnostic.success) {
            setStuckJobInfo(diagnostic.stuckJobs);
          }
        }
        
        setIsResetting(false);
      }
    } catch (error) {
      toast.error('Failed to reset stuck jobs');
      console.error('Error resetting stuck jobs:', error);
      setIsResetting(false);
    }
  };

  const handleSyncCompleted = async () => {
    setIsSyncing(true);
    try {
      const result = await syncCompletedJobs();
      if (result.success) {
        if (result.synced && result.synced > 0) {
          toast.success(result.message || `Synced ${result.synced} completed job(s)`);
          // Reload page to show updated status
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        } else {
          toast.info(result.message || 'No jobs needed syncing');
          setIsSyncing(false);
        }
      } else {
        toast.error(result.error || 'Failed to sync completed jobs');
        setIsSyncing(false);
      }
    } catch (error) {
      toast.error('Failed to sync completed jobs');
      console.error('Error syncing completed jobs:', error);
      setIsSyncing(false);
    }
  };

  const handleFixStuckJob = async (jobId: string) => {
    try {
      const result = await forceFixStuckJob(jobId);
      if (result.success) {
        toast.success(result.message || `Fixed stuck job ${jobId}`);
        // Refresh stuck job info
        const diagnostic = await diagnoseStuckJobs();
        if (diagnostic.success) {
          setStuckJobInfo(diagnostic.stuckJobs);
          if (diagnostic.stuckJobs.length === 0) {
            // No more stuck jobs, reload page
            setTimeout(() => window.location.reload(), 1000);
          }
        }
      } else {
        toast.error(result.error || `Failed to fix job ${jobId}`, {
          duration: 10000,
          description: result.sqlFix ? `SQL to run: ${result.sqlFix}` : undefined
        });
      }
    } catch (error) {
      toast.error(`Failed to fix job ${jobId}`);
      console.error('Error fixing stuck job:', error);
    }
  };

  // Connect to SSE for real-time updates
  // Use refs to avoid stale closures and prevent unnecessary reconnections
  const activeJobRef = useRef(activeJob);
  const lastJobIdRef = useRef(lastJobId);
  
  // Keep refs in sync with state
  useEffect(() => {
    activeJobRef.current = activeJob;
  }, [activeJob]);
  
  useEffect(() => {
    lastJobIdRef.current = lastJobId;
  }, [lastJobId]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectSSE = () => {
      try {
        eventSource = new EventSource(`${window.location.origin}/api/scraper/status`);

        eventSource.onopen = () => {
          console.log('SSE connection opened');
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            if (data.status === 'active' && data.job) {
              // Always update active job with latest data from SSE
              setActiveJob(data.job);
              // Update lastJobId when we receive a job update
              if (data.job.id) {
                setLastJobId(data.job.id);
              }
              // Clear completed job when new job starts
              setCompletedJob(null);
            } else if (data.status === 'idle') {
              // Job just completed! Refresh district metadata
              const currentActiveJob = activeJobRef.current;
              const currentLastJobId = lastJobIdRef.current;
              
              // Only refresh if we had a job running
              if (currentLastJobId && currentActiveJob) {
                const refreshDistricts = async () => {
                  const result = await getDistrictMetadata();
                  if (result.success) {
                    setDistricts(result.districts);
                    toast.success('✅ Scrape complete! District data refreshed');
                  }
                };
                
                refreshDistricts();
                // Keep the completed job visible for log review
                setCompletedJob(currentActiveJob);
              }
              
              setActiveJob(null);
              setLastJobId(null);
              
              // Note: Completed job will be cleared when a new job starts (handled above)
              // Or user can manually close it via the UI
            }
          } catch (error) {
            console.error('Error parsing SSE message:', error);
            console.error('Raw event data:', event.data);
          }
        };

        eventSource.onerror = (error) => {
          console.error('SSE error:', error);
          console.error('EventSource readyState:', eventSource?.readyState);
          console.error('EventSource url:', eventSource?.url);
          
          // Close current connection
          if (eventSource && eventSource.readyState !== EventSource.CLOSED) {
            eventSource.close();
          }
          
          // Reconnect after 3 seconds if not manually closed
          reconnectTimeout = setTimeout(() => {
            console.log('Reconnecting to SSE...');
            connectSSE();
          }, 3000);
        };
      } catch (error) {
        console.error('Error creating EventSource:', error);
      }
    };

    // Start the connection
    connectSSE();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (eventSource && eventSource.readyState !== EventSource.CLOSED) {
        eventSource.close();
      }
    };
  }, []); // Empty dependency array - SSE should persist for the component lifetime

  return (
    <div className="space-y-6">
      {/* Force Reset Button and Stuck Job Info - Always visible */}
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <Button
              onClick={handleSyncCompleted}
              disabled={isSyncing}
              variant="outline"
              size="sm"
              className="border-blue-500 text-blue-700 hover:bg-blue-50"
            >
              {isSyncing ? 'Syncing...' : 'Sync Completed Jobs'}
            </Button>
            <Button
              onClick={handleForceReset}
              disabled={isResetting}
              variant="outline"
              size="sm"
              className="border-amber-500 text-amber-700 hover:bg-amber-50"
            >
              {isResetting ? 'Resetting...' : 'Force Reset Stuck Jobs'}
            </Button>
          </div>
          
          {/* Show stuck job details if any */}
          {stuckJobInfo && stuckJobInfo.length > 0 && (
            <div className="border border-red-300 bg-red-50 rounded-lg p-4">
              <h3 className="font-semibold text-red-800 mb-2">
                ⚠️ {stuckJobInfo.length} Stuck Job(s) Detected
              </h3>
              <div className="space-y-2">
                {stuckJobInfo.map((job: any) => (
                  <div key={job.id} className="bg-white rounded p-3 border border-red-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono text-sm text-gray-700">
                          <strong>Job ID:</strong> {job.id}
                        </p>
                        <p className="text-sm text-gray-600">
                          Platform: {job.platform} | Status: {job.status} | Process Running: {job.isProcessRunning ? 'Yes' : 'No'} | Lock File: {job.hasLockFile ? 'Yes' : 'No'}
                        </p>
                        {job.sqlFix && (
                          <p className="text-xs text-gray-500 mt-1 font-mono bg-gray-100 p-2 rounded">
                            SQL: {job.sqlFix}
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={() => handleFixStuckJob(job.id)}
                        variant="outline"
                        size="sm"
                        className="border-red-500 text-red-700 hover:bg-red-100"
                      >
                        Fix This Job
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      {/* Chromium Process Manager */}
      <ChromiumProcessManager />

      {/* Authentication Status */}
      <AuthStatusCard 
        authStatus={authStatus}
        onAuthStatusChange={setAuthStatus}
      />

      {/* Data Quality Metrics */}
      <DataQualityDashboard metrics={qualityMetrics} />

      {/* Live Progress (show if active job or completed job) */}
      {(activeJob || completedJob) && (
        <LiveProgressPanel 
          key={(activeJob || completedJob)?.id || 'progress'} // Force re-render when job changes
          job={activeJob || completedJob!} 
          isCompleted={!!completedJob && !activeJob}
          onJobStopped={() => {
            setActiveJob(null);
            setCompletedJob(null);
            setLastJobId(null);
          }}
        />
      )}

      {/* Scheduled Jobs */}
      <ScheduledJobsSection />

      {/* Scraper Configuration Form */}
      <ScraperConfigForm
        districts={districts}
        disabled={!!activeJob}
        onJobStarted={(job) => {
          setActiveJob(job);
          setLastJobId(job.id);
        }}
      />

      {/* Recent Listings */}
      <RecentListingsPreview />

      {/* History Table */}
      <HistoryTable 
        initialHistory={initialJobHistory} 
        onHistoryChanged={() => {
          // No need to refresh - the table updates its own state
          console.log('History updated');
        }}
      />
    </div>
  );
}

