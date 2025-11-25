'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScheduledJobList } from './ScheduledJobList';
import { ScheduledJobForm } from './ScheduledJobForm';
import { getScheduledJobs, type ScheduledJob } from '../actions';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

export function ScheduledJobsSection() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null);

  const loadJobs = async () => {
    setIsLoading(true);
    try {
      const data = await getScheduledJobs();
      setJobs(data);
    } catch (error) {
      toast.error('Failed to load scheduled jobs');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
    // Refresh every 60 seconds to update next run times (reduced frequency to avoid rate limits)
    const interval = setInterval(loadJobs, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = () => {
    setEditingJob(null);
    setShowForm(true);
  };

  const handleEdit = (job: ScheduledJob) => {
    setEditingJob(job);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingJob(null);
    loadJobs();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Scheduled Jobs</CardTitle>
            <CardDescription>
              Automatically run scrapers on a schedule. Jobs run daily at 10:00 AM SGT by default.
            </CardDescription>
          </div>
          <Button onClick={handleCreate} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Schedule
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showForm ? (
          <ScheduledJobForm
            job={editingJob}
            onClose={handleFormClose}
            onSuccess={handleFormClose}
          />
        ) : (
          <ScheduledJobList
            jobs={jobs}
            isLoading={isLoading}
            onEdit={handleEdit}
            onRefresh={loadJobs}
          />
        )}
      </CardContent>
    </Card>
  );
}

