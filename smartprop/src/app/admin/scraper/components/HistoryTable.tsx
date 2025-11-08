'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { deleteScraperJob, deleteScraperHistory } from '../actions';
import { toast } from 'sonner';
import { useState } from 'react';
import { Trash2, Trash } from 'lucide-react';

interface Job {
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
    totalSuccess?: number;
    totalSkippedNoPhone?: number;
    totalErrors?: number;
    totalListings?: number;
    totalDistricts?: number;
    // Legacy fields for backward compatibility
    saved?: number;
    skipped?: number;
    errors?: number;
  };
}

interface HistoryTableProps {
  initialHistory: Job[];
  onHistoryChanged?: () => void;
}

export function HistoryTable({ initialHistory, onHistoryChanged }: HistoryTableProps) {
  const [history, setHistory] = useState(initialHistory);
  const [deletingJobs, setDeletingJobs] = useState<Set<string>>(new Set());
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to delete this scraper job record? This will only remove the job history entry, not the actual listings that were scraped.')) {
      return;
    }
    
    setDeletingJobs(prev => new Set(prev).add(jobId));
    try {
      const result = await deleteScraperJob(jobId);
      if (result.success) {
        setHistory(prev => prev.filter(job => job.id !== jobId));
        toast.success('Job history deleted successfully');
        onHistoryChanged?.();
      } else {
        // Ensure error is a string, not an object
        const errorMessage = typeof result.error === 'string' 
          ? result.error 
          : result.error?.message || JSON.stringify(result.error) || 'Failed to delete job';
        toast.error(errorMessage);
      }
    } catch (error) {
      // Handle unexpected errors
      const errorMessage = error instanceof Error 
        ? error.message 
        : typeof error === 'string' 
        ? error 
        : 'Failed to delete job';
      toast.error(errorMessage);
      console.error('Error deleting job:', error);
    } finally {
      setDeletingJobs(prev => {
        const newSet = new Set(prev);
        newSet.delete(jobId);
        return newSet;
      });
    }
  };

  const handleDeleteAllHistory = async () => {
    if (!confirm('Are you sure you want to delete all scraping history records? This will only remove job history entries, not the actual listings that were scraped. This action cannot be undone.')) {
      return;
    }
    
    setIsDeletingAll(true);
    try {
      const result = await deleteScraperHistory();
      if (result.success) {
        setHistory([]);
        toast.success('All scraping history deleted');
        onHistoryChanged?.();
      } else {
        // Ensure error is a string, not an object
        const errorMessage = typeof result.error === 'string' 
          ? result.error 
          : result.error?.message || JSON.stringify(result.error) || 'Failed to delete history';
        toast.error(errorMessage);
      }
    } catch (error) {
      // Handle unexpected errors
      const errorMessage = error instanceof Error 
        ? error.message 
        : typeof error === 'string' 
        ? error 
        : 'Failed to delete history';
      toast.error(errorMessage);
      console.error('Error deleting history:', error);
    } finally {
      setIsDeletingAll(false);
    }
  };
  const formatDuration = (started: string, completed: string | null) => {
    if (!completed) return 'In progress';
    
    const start = new Date(started);
    const end = new Date(completed);
    const diffMs = end.getTime() - start.getTime();
    const minutes = Math.floor(diffMs / 60000);
    
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    return `${hours}h ${remainingMins}m`;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      completed: 'default',
      running: 'secondary',
      failed: 'destructive',
      cancelled: 'outline'
    };
    
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Scraping History</CardTitle>
          {history.length > 0 && (
            <Button
              onClick={handleDeleteAllHistory}
              disabled={isDeletingAll}
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash className="w-4 h-4 mr-2" />
              {isDeletingAll ? 'Deleting...' : 'Delete All'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Config</TableHead>
              <TableHead>Saved</TableHead>
              <TableHead>Skipped</TableHead>
              <TableHead>Errors</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-gray-700">
                  No scraping history yet
                </TableCell>
              </TableRow>
            ) : (
              history.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="text-sm text-gray-800">
                    {new Date(job.started_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="capitalize text-gray-800">{job.platform}</TableCell>
                  <TableCell className="text-sm text-gray-800">
                    {job.config?.district || 'All'} • {job.config?.pages || 0}p
                  </TableCell>
                  <TableCell className="text-gray-800">{job.stats?.totalSuccess || job.stats?.saved || 0}</TableCell>
                  <TableCell className="text-gray-800">{job.stats?.totalSkippedNoPhone || job.stats?.skipped || 0}</TableCell>
                  <TableCell className="text-gray-800">{job.stats?.totalErrors || job.stats?.errors || 0}</TableCell>
                  <TableCell className="text-gray-800">{formatDuration(job.started_at, job.completed_at)}</TableCell>
                  <TableCell>{getStatusBadge(job.status)}</TableCell>
                  <TableCell>
                    <Button
                      onClick={() => handleDeleteJob(job.id)}
                      disabled={deletingJobs.has(job.id)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

