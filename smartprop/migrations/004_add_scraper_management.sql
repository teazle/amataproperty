-- Migration: Add Scraper Management Tables
-- Description: Tables for tracking scraper jobs, district metadata, and data quality metrics

-- ============================================================
-- 1. Scraper Jobs Table
-- ============================================================
CREATE TABLE IF NOT EXISTS scraper_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Job configuration
  platform TEXT NOT NULL CHECK (platform IN ('propertyguru', 'edgeprop')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'paused', 'failed', 'cancelled')),
  config JSONB NOT NULL, -- { district: '09', pages: 3, priceRange: {...} }
  
  -- Progress tracking
  current_district TEXT,
  current_page INTEGER,
  total_pages INTEGER,
  listings_processed INTEGER DEFAULT 0,
  
  -- Results/Statistics
  stats JSONB, -- { saved: 35, skipped: 2, errors: 0, phoneSuccessRate: 0.95 }
  
  -- Checkpoint for resume (if job crashes)
  checkpoint JSONB, -- { district: 'D09', page: 2, listingIndex: 15, processedUrls: [...] }
  
  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Error tracking
  error_message TEXT,
  cloudflare_detected BOOLEAN DEFAULT FALSE,
  auth_failures INTEGER DEFAULT 0,
  
  -- Indexes for queries
  CONSTRAINT scraper_jobs_platform_check CHECK (platform IN ('propertyguru', 'edgeprop'))
);

-- Index for finding active jobs
CREATE INDEX IF NOT EXISTS idx_scraper_jobs_status ON scraper_jobs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraper_jobs_platform ON scraper_jobs(platform, started_at DESC);

-- ============================================================
-- 2. District Metadata Table
-- ============================================================
CREATE TABLE IF NOT EXISTS district_metadata (
  district TEXT PRIMARY KEY, -- 'D01', 'D02', ..., 'D28'
  
  -- Scraping metadata
  last_scraped_at TIMESTAMPTZ,
  total_listings INTEGER DEFAULT 0,
  avg_scrape_duration_seconds INTEGER, -- Average time to scrape this district
  last_phone_success_rate DECIMAL(5,4), -- 0.0000 to 1.0000 (e.g., 0.9500 = 95%)
  
  -- User preferences
  is_favorite BOOLEAN DEFAULT FALSE,
  priority INTEGER DEFAULT 0, -- Higher number = higher priority for auto-scraping
  
  -- Statistics
  last_job_id UUID REFERENCES scraper_jobs(id),
  
  CONSTRAINT district_code_format CHECK (district ~ '^D[0-2][0-9]$')
);

-- Initialize all 28 districts
INSERT INTO district_metadata (district) 
VALUES 
  ('D01'), ('D02'), ('D03'), ('D04'), ('D05'), ('D06'), ('D07'), ('D08'), ('D09'), ('D10'),
  ('D11'), ('D12'), ('D13'), ('D14'), ('D15'), ('D16'), ('D17'), ('D18'), ('D19'), ('D20'),
  ('D21'), ('D22'), ('D23'), ('D24'), ('D25'), ('D26'), ('D27'), ('D28')
ON CONFLICT (district) DO NOTHING;

COMMENT ON TABLE district_metadata IS 'Metadata about each Singapore district for scraper management';
COMMENT ON COLUMN district_metadata.last_phone_success_rate IS 'Percentage of listings where phone number was successfully extracted';

