import { Suspense } from 'react';
import { getActiveJob, getJobHistory, getDistrictMetadata, getDataQualityMetrics, checkAuthStatus } from './actions';
import { ScraperDashboard } from './components/ScraperDashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ScraperPage() {
  // Fetch all data in parallel
  const [activeJob, jobHistory, districtData, qualityMetrics, authStatus] = await Promise.all([
    getActiveJob(),
    getJobHistory(10),
    getDistrictMetadata(),
    getDataQualityMetrics(),
    checkAuthStatus()
  ]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Scraper Management</h1>
          <p className="text-gray-700 mt-1">
            Manage and monitor PropertyGuru and EdgeProp scrapers
          </p>
        </div>
      </div>

      <Suspense fallback={<div>Loading...</div>}>
        <ScraperDashboard
          initialActiveJob={activeJob}
          initialJobHistory={jobHistory.jobs || []}
          initialDistricts={districtData.districts || []}
          initialQualityMetrics={qualityMetrics.metrics || {
            completenessScore: 0,
            phoneValidationRate: 0,
            duplicatesToday: 0,
            staleListings: 0,
          }}
          initialAuthStatus={authStatus.auth || {
            propertyguru: { exists: false, isAuthenticated: false, isFresh: false, cookieCount: 0, lastModified: null, lastAuth: null, stateAgeHours: null, failureReason: 'Auth status unavailable' },
            edgeprop: { exists: false, isAuthenticated: false, isFresh: false, cookieCount: 0, lastModified: null, lastAuth: null, stateAgeHours: null, failureReason: 'Auth status unavailable' },
          }}
        />
      </Suspense>
    </div>
  );
}
