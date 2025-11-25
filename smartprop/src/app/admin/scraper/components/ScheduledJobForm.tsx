'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DistrictSelector } from './DistrictSelector';
import {
  createScheduledJob,
  updateScheduledJob,
  type ScheduledJob,
  getDistrictMetadata,
} from '../actions';
import { toast } from 'sonner';
// Note: cron validation is done server-side via API
import { X } from 'lucide-react';

interface ScheduledJobFormProps {
  job?: ScheduledJob | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ScheduledJobForm({ job, onClose, onSuccess }: ScheduledJobFormProps) {
  const isEditing = !!job;
  const [name, setName] = useState(job?.name || '');
  const [platform, setPlatform] = useState<'propertyguru' | 'edgeprop'>(job?.platform || 'propertyguru');
  const [cronExpression, setCronExpression] = useState(job?.cron_expression || '0 10 * * *');
  const [timezone, setTimezone] = useState(job?.timezone || 'Asia/Singapore');
  const [pages, setPages] = useState(job?.config.pages || 5);
  const [districts, setDistricts] = useState<string[]>(job?.config.districts || []);
  const [districtsList, setDistrictsList] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cronError, setCronError] = useState<string | null>(null);
  const [nextRunPreview, setNextRunPreview] = useState<string | null>(null);

  // Load districts for PG platform
  useEffect(() => {
    if (platform === 'propertyguru') {
      getDistrictMetadata().then(result => {
        setDistrictsList(result.districts || []);
      });
    }
  }, [platform]);

  // Validate cron expression and calculate next run (via API)
  useEffect(() => {
    const validateAndPreview = async () => {
      if (!cronExpression.trim()) {
        setCronError(null);
        setNextRunPreview(null);
        return;
      }

      try {
        // Call API to validate and get next run time
        const response = await fetch(`/api/scheduler/validate?expression=${encodeURIComponent(cronExpression)}&timezone=${encodeURIComponent(timezone)}`);
        const data = await response.json();
        
        if (data.valid) {
          setCronError(null);
          if (data.nextRun) {
            const nextRunDate = new Date(data.nextRun);
            setNextRunPreview(nextRunDate.toLocaleString('en-SG', {
              timeZone: timezone,
              dateStyle: 'full',
              timeStyle: 'short',
            }));
          }
        } else {
          setCronError(data.error || 'Invalid cron expression');
          setNextRunPreview(null);
        }
      } catch (error) {
        // If API fails, just do basic validation (check format)
        const cronPattern = /^(\*|([0-9]|[1-5][0-9])|\*\/([0-9]|[1-5][0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|[12][0-9]|3[01])|\*\/([1-9]|[12][0-9]|3[01])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/;
        if (!cronPattern.test(cronExpression)) {
          setCronError('Invalid cron format');
        } else {
          setCronError(null);
        }
        setNextRunPreview(null);
      }
    };

    const timeoutId = setTimeout(validateAndPreview, 500); // Debounce
    return () => clearTimeout(timeoutId);
  }, [cronExpression, timezone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Validation
      if (!name.trim()) {
        toast.error('Name is required');
        return;
      }

      if (platform === 'propertyguru' && districts.length === 0) {
        toast.error('Please select at least one district');
        return;
      }

      if (pages < 1 || pages > 100) {
        toast.error('Pages must be between 1 and 100');
        return;
      }

      const config = {
        pages,
        ...(platform === 'propertyguru' && { districts }),
      };

      let result;
      if (isEditing) {
        result = await updateScheduledJob(job.id, {
          name,
          platform,
          cron_expression: cronExpression,
          timezone,
          config,
        });
      } else {
        result = await createScheduledJob({
          name,
          platform,
          cron_expression: cronExpression,
          timezone,
          config,
          enabled: true,
        });
      }

      if (result.success) {
        toast.success(`Schedule ${isEditing ? 'updated' : 'created'} successfully`);
        onSuccess();
      } else {
        toast.error(result.error || 'Failed to save schedule');
      }
    } catch (error) {
      toast.error('An error occurred');
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            {isEditing ? 'Edit Schedule' : 'Create Schedule'}
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure when and how scrapers should run automatically
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., PG Districts 9-11 Daily"
            required
          />
        </div>

        <div>
          <Label htmlFor="platform">Platform</Label>
          <Select value={platform} onValueChange={(value: 'propertyguru' | 'edgeprop') => setPlatform(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="propertyguru">PropertyGuru</SelectItem>
              <SelectItem value="edgeprop">EdgeProp</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {platform === 'propertyguru' && (
          <div>
            <Label>Districts</Label>
            <DistrictSelector
              districts={districtsList}
              selectedDistricts={districts}
              onDistrictsChange={setDistricts}
            />
          </div>
        )}

        <div>
          <Label htmlFor="pages">Pages</Label>
          <Input
            id="pages"
            type="number"
            min="1"
            max="100"
            value={pages}
            onChange={(e) => setPages(parseInt(e.target.value) || 1)}
            required
          />
          <p className="text-xs text-muted-foreground mt-1">
            Number of pages to scrape {platform === 'propertyguru' && districts.length > 0 && `per district (${districts.length} districts = ${pages * districts.length} total pages)`}
          </p>
        </div>

        <div>
          <Label htmlFor="cron">Cron Expression</Label>
          <Input
            id="cron"
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            placeholder="0 10 * * *"
            required
            className={cronError ? 'border-red-500' : ''}
          />
          {cronError && (
            <p className="text-xs text-red-500 mt-1">{cronError}</p>
          )}
          {!cronError && nextRunPreview && (
            <p className="text-xs text-muted-foreground mt-1">
              Next run: {nextRunPreview}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Format: second minute hour day month day-of-week (e.g., "0 10 * * *" for 10am daily)
          </p>
        </div>

        <div>
          <Label htmlFor="timezone">Timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Asia/Singapore">Asia/Singapore (SGT)</SelectItem>
              <SelectItem value="UTC">UTC</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || !!cronError}>
          {isSubmitting ? 'Saving...' : isEditing ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

