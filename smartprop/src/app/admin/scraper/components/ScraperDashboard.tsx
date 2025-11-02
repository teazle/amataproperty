'use client';

import { useState, useEffect } from 'react';
import { AuthStatusCard } from './AuthStatusCard';
import { DataQualityDashboard } from './DataQualityDashboard';
import { ScraperConfigForm } from './ScraperConfigForm';
import { LiveProgressPanel } from './LiveProgressPanel';
import { RecentListingsPreview } from './RecentListingsPreview';
import { HistoryTable } from './HistoryTable';
import { getDistrictMetadata } from '../actions';
import { toast } from 'sonner';

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
  const [authStatus, setAuthStatus] = useState(initialAuthStatus);
  const [qualityMetrics, setQualityMetrics] = useState(initialQualityMetrics);
  const [districts, setDistricts] = useState(initialDistricts);
  const [lastJobId, setLastJobId] = useState<string | null | undefined>(initialActiveJob?.id);

  // Connect to SSE for real-time updates
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
              setActiveJob(data.job);
            } else if (data.status === 'idle') {
              // Job just completed! Refresh district metadata
              const refreshDistricts = async () => {
                const result = await getDistrictMetadata();
                if (result.success) {
                  setDistricts(result.districts);
                  toast.success('✅ Scrape complete! District data refreshed');
                }
              };
              
              // Only refresh if we had a job running
              if (lastJobId) {
                refreshDistricts();
              }
              
              setActiveJob(null);
              setLastJobId(null);
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
  }, [lastJobId]);

  return (
    <div className="space-y-6">
      {/* Authentication Status */}
      <AuthStatusCard 
        authStatus={authStatus}
        onAuthStatusChange={setAuthStatus}
      />

      {/* Data Quality Metrics */}
      <DataQualityDashboard metrics={qualityMetrics} />

      {/* Live Progress (only show if active job) */}
      {activeJob && (
        <LiveProgressPanel 
          job={activeJob} 
          onJobStopped={() => {
            setActiveJob(null);
            setLastJobId(null);
          }}
        />
      )}

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

