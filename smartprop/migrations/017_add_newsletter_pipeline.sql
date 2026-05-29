-- Property Valuation Newsletter pipeline:
-- opt-out columns on crm_leads, newsletter issues/sends ledger, and a
-- PropNex valuation cache so we don't re-scrape per send.

ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS opt_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opt_out_reason TEXT,
  ADD COLUMN IF NOT EXISTS lead_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_crm_leads_lead_code
  ON crm_leads(lead_code)
  WHERE lead_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_leads_opt_out_at
  ON crm_leads(opt_out_at)
  WHERE opt_out_at IS NOT NULL;

-- One row per weekly newsletter run.
CREATE TABLE IF NOT EXISTS newsletter_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sending', 'sent', 'cancelled')),
  audience_project_slug TEXT,
  featured_projects JSONB NOT NULL DEFAULT '[]',
  copy_template TEXT,
  notes TEXT,
  created_by TEXT NOT NULL DEFAULT 'admin',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  sent_started_at TIMESTAMPTZ,
  sent_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (issue, lead). Drives idempotency + delivery audit.
CREATE TABLE IF NOT EXISTS newsletter_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES newsletter_issues(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  rendered_body TEXT NOT NULL,
  valuation_snapshot JSONB,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'failed', 'opted_out', 'skipped', 'test')),
  waha_message_id TEXT,
  error TEXT,
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  override_phone TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issue_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_sends_issue_status
  ON newsletter_sends(issue_id, status);
CREATE INDEX IF NOT EXISTS idx_newsletter_sends_lead
  ON newsletter_sends(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_sends_phone_recent
  ON newsletter_sends(phone, created_at DESC);

-- PropNex valuation cache, keyed by normalized address (lower+squashed).
-- Newsletter composer reads from here; scraper writes to here.
CREATE TABLE IF NOT EXISTS propnex_valuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address_key TEXT NOT NULL UNIQUE,
  display_address TEXT NOT NULL,
  postal_code TEXT,
  project_name TEXT,
  low_sgd NUMERIC,
  mid_sgd NUMERIC,
  high_sgd NUMERIC,
  psf_low NUMERIC,
  psf_high NUMERIC,
  area_sqft NUMERIC,
  comparables_count INTEGER,
  confidence TEXT,
  raw_response JSONB,
  as_of DATE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_propnex_valuations_expires_at
  ON propnex_valuations(expires_at);

COMMENT ON TABLE newsletter_issues IS 'Weekly Property Valuation newsletter runs. One row per issue. Draft -> approved -> sending -> sent.';
COMMENT ON TABLE newsletter_sends IS 'Per-recipient delivery ledger for newsletter_issues. UNIQUE(issue_id, lead_id) prevents double-sends.';
COMMENT ON COLUMN newsletter_sends.is_test IS 'TRUE for /api/admin/newsletter/test-send rows. Real batch sends never collide with tests (different issue ids).';
COMMENT ON COLUMN newsletter_sends.override_phone IS 'Phone we actually sent to when is_test=true (e.g. +6596612002). NULL on real sends.';
COMMENT ON TABLE propnex_valuations IS 'Cache of PropNex Connect valuations, keyed by normalized address. 30-day TTL via expires_at.';
COMMENT ON COLUMN crm_leads.lead_code IS 'Short opaque tracking code (e.g. vp1a2b3c) used in newsletter CTA URLs. Auto-generated on first newsletter render.';
