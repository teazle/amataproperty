export type ScraperPlatform = 'propertyguru' | 'edgeprop';

export type ScraperJobSource = 'manual' | 'scheduled' | 'retry';

export interface ScraperJobPayload {
  platform: ScraperPlatform;
  config: {
    district?: string;
    pages: number;
    maxListings?: number;
    minPrice?: number;
    maxPrice?: number;
  };
  jobId: string;
  priority: number;
  source: ScraperJobSource;
  idempotencyKey: string;
}

export const SCRAPER_QUEUE_NAME = 'scraper-jobs';
export const SCRAPER_DLQ_NAME = 'scraper-failed';
