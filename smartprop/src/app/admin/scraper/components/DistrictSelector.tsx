'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface District {
  district: string;
  last_scraped_at: string | null;
  total_listings: number;
  last_phone_success_rate: number | null;
  is_favorite: boolean;
}

interface DistrictSelectorProps {
  districts: District[];
  selectedDistrict?: string | null;
  onDistrictChange?: (district: string | null) => void;
  selectedDistricts?: string[];
  onDistrictsChange?: (districts: string[]) => void;
  disabled?: boolean;
}

export function DistrictSelector({
  districts,
  selectedDistrict,
  onDistrictChange,
  selectedDistricts,
  onDistrictsChange,
  disabled = false
}: DistrictSelectorProps) {
  const multiSelectEnabled = Array.isArray(selectedDistricts) && typeof onDistrictsChange === 'function';
  const activeDistricts = multiSelectEnabled ? selectedDistricts : selectedDistrict ? [selectedDistrict] : [];

  const handleToggleDistrict = (districtCode: string) => {
    if (multiSelectEnabled) {
      const nextDistricts = activeDistricts.includes(districtCode)
        ? activeDistricts.filter((entry) => entry !== districtCode)
        : [...activeDistricts, districtCode];
      onDistrictsChange(nextDistricts);
      return;
    }

    onDistrictChange?.(activeDistricts[0] === districtCode ? null : districtCode);
  };

  const getDistrictPriority = (district: District) => {
    if (!district.last_scraped_at) return 'high'; // Never scraped

    const lastScraped = new Date(district.last_scraped_at);
    const hoursSince = (Date.now() - lastScraped.getTime()) / (1000 * 60 * 60);

    if (hoursSince > 48) return 'high'; // >2 days
    if (hoursSince > 6) return 'medium'; // >6 hours
    return 'low'; // <6 hours
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-100 border-red-300 hover:border-red-400';
      case 'medium': return 'bg-yellow-100 border-yellow-300 hover:border-yellow-400';
      default: return 'bg-green-100 border-green-300 hover:border-green-400';
    }
  };

  const formatLastScraped = (lastScraped: string | null) => {
    if (!lastScraped) return 'Never';

    const date = new Date(lastScraped);
    const hoursSince = (Date.now() - date.getTime()) / (1000 * 60 * 60);

    if (hoursSince < 1) return `${Math.floor(hoursSince * 60)}m ago`;
    if (hoursSince < 24) return `${Math.floor(hoursSince)}h ago`;
    return `${Math.floor(hoursSince / 24)}d ago`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Select District{multiSelectEnabled ? 's' : ''}</h3>
          <p className="text-sm text-gray-700">
            {multiSelectEnabled ? 'Choose one or more districts to scrape' : 'Choose ONE district to scrape'}
          </p>
        </div>
        {activeDistricts.length > 0 && (
          <button
            onClick={() => (multiSelectEnabled ? onDistrictsChange?.([]) : onDistrictChange?.(null))}
            className="text-sm text-blue-600 hover:underline"
            disabled={disabled}
          >
            Clear Selection
          </button>
        )}
      </div>

      {/* Priority Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-700">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-green-400"></div>
          <span>Fresh (&lt;6h)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
          <span>Stale (6h-2d)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-red-400"></div>
          <span>Very Stale (&gt;2d)</span>
        </div>
      </div>

      {/* District Grid - Single Select Radio Buttons */}
      <div className="grid grid-cols-4 sm:grid-cols-7 lg:grid-cols-10 gap-2">
        {districts.map((district) => {
          const priority = getDistrictPriority(district);
          const isSelected = activeDistricts.includes(district.district);

          return (
            <button
              key={district.district}
              onClick={() => handleToggleDistrict(district.district)}
              disabled={disabled}
              className={cn(
                'relative p-3 border-2 rounded-lg transition-all',
                'flex flex-col items-center gap-1',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isSelected
                  ? 'border-blue-600 bg-blue-50 shadow-lg scale-105'
                  : getPriorityColor(priority),
                !disabled && !isSelected && 'hover:scale-105 hover:shadow-md'
              )}
            >
              {/* District Code */}
              <span className={cn(
                'font-bold text-sm',
                isSelected ? 'text-blue-600' : 'text-gray-900'
              )}>
                {district.district}
              </span>

              {/* Last Scraped */}
              <span className="text-[10px] text-gray-700 font-medium">
                {formatLastScraped(district.last_scraped_at)}
              </span>

              {/* Listing Count */}
              {district.total_listings > 0 && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0">
                  {district.total_listings}
                </Badge>
              )}

              {/* Favorite Star */}
              {district.is_favorite && (
                <span className="absolute top-1 right-1 text-xs">⭐</span>
              )}

              {/* Selected Indicator */}
              {isSelected && (
                <span className="absolute -top-1 -right-1 text-blue-600 text-lg">✓</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
