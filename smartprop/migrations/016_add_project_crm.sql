-- Project CRM for customer inquiries from Luxe Realty and future public pages.

CREATE TABLE IF NOT EXISTS crm_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'luxe-realty',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES crm_projects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  property_title TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'viewing_scheduled', 'offer', 'won', 'lost')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  assigned_to TEXT,
  follow_up_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('created', 'note', 'call', 'status_change', 'follow_up_scheduled')),
  note TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_projects_slug ON crm_projects(slug);
CREATE INDEX IF NOT EXISTS idx_crm_leads_project_status ON crm_leads(project_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_leads_created_at ON crm_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_leads_follow_up_at ON crm_leads(follow_up_at);
CREATE INDEX IF NOT EXISTS idx_crm_lead_activities_lead_id ON crm_lead_activities(lead_id, created_at DESC);

INSERT INTO crm_projects (slug, title, source)
VALUES
  ('river-modern', 'River Modern at River Valley Green', 'luxe-realty'),
  ('upperhouse', 'UPPERHOUSE at Orchard Boulevard', 'luxe-realty'),
  ('zyon-grand', 'ZYON GRAND at Zion Road', 'luxe-realty'),
  ('promenade-peak', 'Promenade Peak at Zion Promenade', 'luxe-realty'),
  ('union-square', 'Union Square', 'luxe-realty'),
  ('general-luxe', 'General Luxe Realty Inquiry', 'luxe-realty')
ON CONFLICT (slug) DO UPDATE
SET title = EXCLUDED.title,
    source = EXCLUDED.source,
    is_active = TRUE,
    updated_at = now();
