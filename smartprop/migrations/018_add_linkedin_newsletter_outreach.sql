-- LinkedIn newsletter outreach campaigns.
-- Separate from linkedin_messages because the existing table is for catch-up
-- messages and has a profile-url unique constraint that blocks repeat campaigns.

CREATE TABLE IF NOT EXISTS linkedin_newsletter_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_slug TEXT NOT NULL UNIQUE,
  newsletter_title TEXT,
  newsletter_url TEXT,
  linkedin_message_template TEXT,
  approval_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft', 'approved', 'cancelled')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sending', 'sent', 'paused', 'failed', 'reauth_required')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS linkedin_newsletter_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES linkedin_newsletter_campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  headline TEXT,
  visible_location TEXT,
  message_body TEXT,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (
      status IN (
        'candidate',
        'approved',
        'queued',
        'sent',
        'failed',
        'skipped_duplicate',
        'skipped_location',
        'test'
      )
    ),
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, profile_url)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_newsletter_campaign_status
  ON linkedin_newsletter_campaigns(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkedin_newsletter_recipients_campaign_status
  ON linkedin_newsletter_recipients(campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_linkedin_newsletter_recipients_profile_sent
  ON linkedin_newsletter_recipients(profile_url, sent_at DESC)
  WHERE sent_at IS NOT NULL;

COMMENT ON TABLE linkedin_newsletter_campaigns IS 'Approved OpenClaw newsletter campaigns adapted for LinkedIn DM outreach.';
COMMENT ON TABLE linkedin_newsletter_recipients IS 'Per-profile candidate/send ledger for LinkedIn newsletter campaigns.';
