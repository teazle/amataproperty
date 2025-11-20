-- LinkedIn Message Automation Tracking
-- Creates tables for tracking LinkedIn catch-up messages and settings

-- LinkedIn Settings Table (frontend-configurable)
CREATE TABLE IF NOT EXISTS linkedin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_url TEXT,
  company_url TEXT DEFAULT 'https://www.linkedin.com/company/muxin-asset/?viewAsMember=true',
  daily_limit INTEGER DEFAULT 25 CHECK (daily_limit >= 1 AND daily_limit <= 100),
  min_delay INTEGER DEFAULT 3000 CHECK (min_delay >= 1000 AND min_delay <= 30000),
  max_delay INTEGER DEFAULT 8000 CHECK (max_delay >= 1000 AND max_delay <= 60000),
  message_template_profile TEXT DEFAULT E'\n\nFeel free to connect with me: {profile_url}',
  message_template_company TEXT DEFAULT 'Check out our company updates: {company_url}',
  enabled BOOLEAN DEFAULT true,
  auto_run_schedule TEXT, -- Cron expression
  timezone TEXT DEFAULT 'Asia/Singapore',
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

-- Only one settings row should exist
CREATE UNIQUE INDEX IF NOT EXISTS idx_linkedin_settings_single ON linkedin_settings((1));

-- LinkedIn Messages Table
CREATE TABLE IF NOT EXISTS linkedin_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_name TEXT,
  contact_profile_url TEXT NOT NULL,
  contact_linkedin_id TEXT,
  message_type TEXT CHECK (message_type IN ('birthday', 'work_anniversary', 'job_change')),
  original_template TEXT,
  enhanced_message TEXT,
  status TEXT CHECK (status IN ('pending', 'sent', 'failed', 'skipped')) DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  linkedin_job_id UUID, -- Track which automation run this belongs to
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for linkedin_messages
CREATE UNIQUE INDEX IF NOT EXISTS idx_linkedin_messages_profile_url ON linkedin_messages(contact_profile_url);
CREATE INDEX IF NOT EXISTS idx_linkedin_messages_status ON linkedin_messages(status);
CREATE INDEX IF NOT EXISTS idx_linkedin_messages_sent_at ON linkedin_messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_linkedin_messages_type ON linkedin_messages(message_type);
CREATE INDEX IF NOT EXISTS idx_linkedin_messages_job_id ON linkedin_messages(linkedin_job_id);

-- Daily Statistics Table (for rate limiting)
CREATE TABLE IF NOT EXISTS linkedin_daily_stats (
  date DATE PRIMARY KEY,
  messages_sent INTEGER DEFAULT 0,
  messages_failed INTEGER DEFAULT 0,
  contacts_processed INTEGER DEFAULT 0,
  by_type JSONB DEFAULT '{"birthday": 0, "work_anniversary": 0, "job_change": 0}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Comments for documentation
COMMENT ON TABLE linkedin_settings IS 'Frontend-configurable settings for LinkedIn automation';
COMMENT ON TABLE linkedin_messages IS 'Tracks all LinkedIn catch-up messages sent';
COMMENT ON TABLE linkedin_daily_stats IS 'Daily statistics for rate limiting and monitoring';

COMMENT ON COLUMN linkedin_settings.profile_url IS 'User''s LinkedIn profile URL (auto-detected on first run)';
COMMENT ON COLUMN linkedin_settings.company_url IS 'Company page URL to include in messages';
COMMENT ON COLUMN linkedin_settings.daily_limit IS 'Maximum messages to send per day';
COMMENT ON COLUMN linkedin_settings.message_template_profile IS 'Template for adding profile link (supports {profile_url} placeholder)';
COMMENT ON COLUMN linkedin_settings.message_template_company IS 'Template for adding company link (supports {company_url} placeholder)';
COMMENT ON COLUMN linkedin_messages.message_type IS 'Type of catch-up: birthday, work_anniversary, or job_change';
COMMENT ON COLUMN linkedin_messages.linkedin_job_id IS 'Optional job ID to track automation runs';

-- Initialize default settings if table is empty
INSERT INTO linkedin_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM linkedin_settings)
ON CONFLICT DO NOTHING;

