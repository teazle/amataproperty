'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DistrictSelector } from './DistrictSelector';
import { startScrapeJob } from '../actions';
import { toast } from 'sonner';

interface District {
  district: string;
  last_scraped_at: string | null;
  total_listings: number;
  last_phone_success_rate: number | null;
  is_favorite: boolean;
}

interface Job {
  id?: string;
  [key: string]: unknown;
}

interface ScraperConfigFormProps {
  districts: District[];
  disabled?: boolean;
  onJobStarted?: (job: Job) => void;
}

export function ScraperConfigForm({ districts, disabled = false, onJobStarted }: ScraperConfigFormProps) {
  const [platform, setPlatform] = useState<'propertyguru' | 'edgeprop'>('propertyguru');
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [pages, setPages] = useState<number>(2);
  const [isStarting, setIsStarting] = useState(false);

  const handleStart = async () => {
    // Validation
    if (platform === 'propertyguru' && !selectedDistrict) {
      toast.error('Please select a district for PropertyGuru scraper');
      return;
    }

    if (pages < 1 || pages > 10) {
      toast.error('Pages must be between 1 and 10');
      return;
    }

    setIsStarting(true);

    const config = {
      platform,
      district: platform === 'propertyguru' ? selectedDistrict! : undefined,
      pages,
      minPrice: 1000000,
      maxPrice: 3000000
    };

    const result = await startScrapeJob(config);

    if (result.success) {
      toast.success(result.message);
      onJobStarted?.(result.jobId);
      // Refresh page to show active job
      window.location.reload();
    } else {
      toast.error(result.error || 'Failed to start scraper');
    }

    setIsStarting(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scraper Configuration</CardTitle>
        <CardDescription>
          Configure and start the property scraper
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Platform Selection */}
        <div className="space-y-2">
          <Label>Platform</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={platform === 'propertyguru' ? 'default' : 'outline'}
              onClick={() => setPlatform('propertyguru')}
              disabled={disabled}
              className="flex-1"
            >
              PropertyGuru
            </Button>
            <Button
              type="button"
              variant={platform === 'edgeprop' ? 'default' : 'outline'}
              onClick={() => setPlatform('edgeprop')}
              disabled={disabled}
              className="flex-1"
            >
              EdgeProp
            </Button>
          </div>
        </div>

        {/* District Selection (PropertyGuru only) */}
        {platform === 'propertyguru' && (
          <DistrictSelector
            districts={districts}
            selectedDistrict={selectedDistrict}
            onDistrictChange={setSelectedDistrict}
            disabled={disabled}
          />
        )}

        {/* Price Range (Fixed) */}
        <div className="space-y-2">
          <Label className="text-gray-900">Price Range</Label>
          <div className="flex items-center gap-2 text-sm text-gray-900 font-medium p-3 bg-gray-50 rounded-lg border border-gray-200">
            <span>💰</span>
            <span>$1,000,000 - $3,000,000 (Fixed)</span>
          </div>
        </div>

        {/* Pages Input */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Label htmlFor="pages" className="text-gray-900">
              {platform === 'propertyguru' ? 'Pages per District' : 'Total Pages'}
            </Label>
            <Input
              id="pages"
              type="number"
              min={1}
              max={10}
              value={pages}
              onChange={(e) => setPages(parseInt(e.target.value) || 1)}
              disabled={disabled}
              className="w-32 text-gray-900"
            />
          </div>
          <p className="text-xs text-gray-800">
            Each page contains ~20 listings
          </p>
        </div>

        {/* Advanced Options */}
        <details className="space-y-2">
          <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
            Advanced Options
          </summary>
          <div className="pl-4 pt-2 space-y-2 text-sm text-gray-700">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="auto-retry" defaultChecked disabled className="rounded" />
              <label htmlFor="auto-retry">Auto-retry failed listings (3x)</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="auto-reauth" defaultChecked disabled className="rounded" />
              <label htmlFor="auto-reauth">Auto re-auth on phone failures</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="skip-no-phone" defaultChecked disabled className="rounded" />
              <label htmlFor="skip-no-phone">Skip listings without phone numbers</label>
            </div>
          </div>
        </details>

        {/* Start Button */}
        <div className="pt-4">
          <Button
            onClick={handleStart}
            disabled={disabled || isStarting || (platform === 'propertyguru' && !selectedDistrict)}
            className="w-full"
            size="lg"
          >
            {isStarting ? '🔄 Starting Scraper...' : '🚀 Start Scraping'}
          </Button>
          
          {platform === 'propertyguru' && !selectedDistrict && (
            <p className="text-sm text-amber-600 mt-2 text-center">
              Please select a district to continue
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

