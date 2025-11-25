-- Migration: Add Scheduled Jobs Table
-- Description: Table for managing scheduled scraper jobs with cron expressions

-- ============================================================
-- Scheduled Jobs Table
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Job identification
  name TEXT NOT NULL, -- Human-readable name (e.g., "PG Districts 9-11 Daily")
  platform TEXT NOT NULL CHECK (platform IN ('propertyguru', 'edgeprop')),
  
  -- Scheduling configuration
  cron_expression TEXT NOT NULL, -- Cron expression (e.g., "0 10 * * *" for 10am daily)
  timezone TEXT NOT NULL DEFAULT 'Asia/Singapore', -- Timezone for cron execution
  
  -- Scraper configuration (JSONB for flexibility)
  config JSONB NOT NULL, -- For PG: { districts: ['09', '10', '11'], pages: 5 }, For EP: { pages: 10 }
  
  -- Status and control
  enabled BOOLEAN NOT NULL DEFAULT true,
  
  -- Execution tracking
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_run_status TEXT CHECK (last_run_status IN ('success', 'failed', NULL)),
  last_error TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT scheduled_jobs_platform_check CHECK (platform IN ('propertyguru', 'edgeprop'))
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled ON scheduled_jobs(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_platform ON scheduled_jobs(platform);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at) WHERE enabled = true;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_scheduled_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_update_scheduled_jobs_updated_at
  BEFORE UPDATE ON scheduled_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduled_jobs_updated_at();

-- Insert default schedules
INSERT INTO scheduled_jobs (name, platform, cron_expression, timezone, config, enabled)
VALUES
  (
    'PG Districts 9-11 Daily',
    'propertyguru',
    '0 10 * * *', -- Daily at 10:00 AM
    'Asia/Singapore',
    '{"districts": ["09", "10", "11"], "pages": 5}'::jsonb,
    true
  ),
  (
    'EP Scraper Daily',
    'edgeprop',
    '0 10 * * *', -- Daily at 10:00 AM
    'Asia/Singapore',
    '{"pages": 10}'::jsonb,
    true
  )
ON CONFLICT DO NOTHING;

COMMENT ON TABLE scheduled_jobs IS 'Scheduled scraper jobs with cron expressions for automatic execution';
COMMENT ON COLUMN scheduled_jobs.cron_expression IS 'Cron expression in format: second minute hour day month day-of-week (e.g., "0 10 * * *" for 10am daily)';
COMMENT ON COLUMN scheduled_jobs.config IS 'Platform-specific scraper configuration stored as JSONB';
COMMENT ON COLUMN scheduled_jobs.next_run_at IS 'Calculated next execution time based on cron expression and timezone';

