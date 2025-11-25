'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { type ScheduledJob, toggleScheduledJob, deleteScheduledJob, reloadScheduler } from '../actions';
import { toast } from 'sonner';
import { Edit, Trash2, RefreshCw } from 'lucide-react';
// Format date relative to now
const formatDistanceToNow = (date: Date): string => {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `in ${days} day${days > 1 ? 's' : ''}`;
  if (hours > 0) return `in ${hours} hour${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
  if (seconds > 0) return `in ${seconds} second${seconds > 1 ? 's' : ''}`;
  
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) > 1 ? 's' : ''} ago`;
  if (hours < 0) return `${Math.abs(hours)} hour${Math.abs(hours) > 1 ? 's' : ''} ago`;
  if (minutes < 0) return `${Math.abs(minutes)} minute${Math.abs(minutes) > 1 ? 's' : ''} ago`;
  return `${Math.abs(seconds)} second${Math.abs(seconds) > 1 ? 's' : ''} ago`;
};

interface ScheduledJobListProps {
  jobs: ScheduledJob[];
  isLoading: boolean;
  onEdit: (job: ScheduledJob) => void;
  onRefresh: () => void;
}

export function ScheduledJobList({ jobs, isLoading, onEdit, onRefresh }: ScheduledJobListProps) {
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const handleToggle = async (job: ScheduledJob) => {
    setTogglingIds(prev => new Set(prev).add(job.id));
    try {
      const result = await toggleScheduledJob(job.id, !job.enabled);
      if (result.success) {
        toast.success(`Schedule ${job.enabled ? 'disabled' : 'enabled'}`);
        await reloadScheduler();
        onRefresh();
      } else {
        toast.error(result.error || 'Failed to toggle schedule');
      }
    } catch (error) {
      toast.error('Failed to toggle schedule');
    } finally {
      setTogglingIds(prev => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  };

  const handleDelete = async (job: ScheduledJob) => {
    if (!confirm(`Are you sure you want to delete "${job.name}"?`)) {
      return;
    }

    setDeletingIds(prev => new Set(prev).add(job.id));
    try {
      const result = await deleteScheduledJob(job.id);
      if (result.success) {
        toast.success('Schedule deleted');
        await reloadScheduler();
        onRefresh();
      } else {
        toast.error(result.error || 'Failed to delete schedule');
      }
    } catch (error) {
      toast.error('Failed to delete schedule');
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  };

  const formatNextRun = (nextRunAt: string | null) => {
    if (!nextRunAt) return 'N/A';
    try {
      const date = new Date(nextRunAt);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return 'Invalid date';
    }
  };

  const formatLastRun = (lastRunAt: string | null) => {
    if (!lastRunAt) return 'Never';
    try {
      const date = new Date(lastRunAt);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return 'Invalid date';
    }
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading schedules...</div>;
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No scheduled jobs yet.</p>
        <p className="text-sm mt-2">Create a schedule to automatically run scrapers.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Next Run</TableHead>
              <TableHead>Last Run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-medium">{job.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {job.platform === 'propertyguru' ? 'PropertyGuru' : 'EdgeProp'}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">{job.cron_expression}</TableCell>
                <TableCell>{formatNextRun(job.next_run_at)}</TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <div>{formatLastRun(job.last_run_at)}</div>
                    {job.last_run_status && (
                      <Badge
                        variant={job.last_run_status === 'success' ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        {job.last_run_status}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={job.enabled}
                    onCheckedChange={() => handleToggle(job)}
                    disabled={togglingIds.has(job.id)}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(job)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(job)}
                      disabled={deletingIds.has(job.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>
  );
}

