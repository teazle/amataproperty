import { Suspense } from 'react';
import { LinkedInDashboard } from './components/LinkedInDashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function LinkedInPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">LinkedIn Automation</h1>
          <p className="text-gray-700 mt-1">
            Automate catch-up messages for birthdays, work anniversaries, and job changes
          </p>
        </div>
      </div>

      <Suspense fallback={<div>Loading...</div>}>
        <LinkedInDashboard />
      </Suspense>
    </div>
  );
}

