-- Fail-closed valuation preparation for the daily WhatsApp newsletter.

ALTER TABLE crm_projects
  ADD COLUMN IF NOT EXISTS valuation_location TEXT,
  ADD COLUMN IF NOT EXISTS valuation_property_type TEXT,
  ADD COLUMN IF NOT EXISTS valuation_tenure TEXT,
  ADD COLUMN IF NOT EXISTS valuation_area_distribution JSONB,
  ADD COLUMN IF NOT EXISTS valuation_profile_updated_at TIMESTAMPTZ;

ALTER TABLE propnex_valuations
  ADD COLUMN IF NOT EXISTS project_slug TEXT,
  ADD COLUMN IF NOT EXISTS evidence_status TEXT,
  ADD COLUMN IF NOT EXISTS evidence_contract_version TEXT,
  ADD COLUMN IF NOT EXISTS validated_confidence TEXT;

CREATE TABLE newsletter_valuation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL,
  issue_id UUID REFERENCES newsletter_issues(id) ON DELETE RESTRICT,
  issue_slug TEXT,
  project_slug TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','completed','quiet','blocked','failed')),
  lease_token UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count BETWEEN 0 AND 5),
  project_count INTEGER NOT NULL DEFAULT 0 CHECK (project_count BETWEEN 0 AND 5),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count BETWEEN 0 AND 5),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count BETWEEN 0 AND 5),
  blocked_count INTEGER NOT NULL DEFAULT 0 CHECK (blocked_count BETWEEN 0 AND 5),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count BETWEEN 0 AND 5),
  blocker TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_meaningful_work_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE NULLS NOT DISTINCT (run_date, issue_id)
);

CREATE TABLE newsletter_valuation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES newsletter_valuation_runs(id) ON DELETE RESTRICT,
  project_slug TEXT NOT NULL,
  project_profile JSONB NOT NULL,
  candidate_count INTEGER NOT NULL CHECK (candidate_count BETWEEN 1 AND 5),
  reason TEXT NOT NULL CHECK (reason IN ('missing','expired','unsupported')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','accepted','rejected','blocked','failed')),
  outcome JSONB,
  evidence_hash TEXT,
  validation_error TEXT,
  cache_valuation_id UUID REFERENCES propnex_valuations(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (run_id, project_slug),
  CHECK (project_slug = lower(project_slug))
);

ALTER TABLE propnex_valuations
  ADD COLUMN IF NOT EXISTS evidence_item_id UUID
    REFERENCES newsletter_valuation_items(id) ON DELETE RESTRICT;

ALTER TABLE propnex_valuations
  DROP CONSTRAINT IF EXISTS propnex_valuations_evidence_status_check,
  DROP CONSTRAINT IF EXISTS propnex_valuations_validated_confidence_check,
  ADD CONSTRAINT propnex_valuations_evidence_status_check
    CHECK (evidence_status IS NULL OR evidence_status IN ('accepted','rejected')),
  ADD CONSTRAINT propnex_valuations_validated_confidence_check
    CHECK (validated_confidence IS NULL OR validated_confidence IN ('medium','high'));

CREATE INDEX idx_newsletter_valuation_runs_date_status
  ON newsletter_valuation_runs(run_date DESC, status);
CREATE INDEX idx_newsletter_valuation_items_run_status
  ON newsletter_valuation_items(run_id, status);
CREATE INDEX idx_propnex_valuations_accepted_project_slug
  ON propnex_valuations (project_slug, expires_at DESC)
  WHERE evidence_status = 'accepted'
    AND evidence_contract_version = 'chloe-valuation-v1'
    AND validated_confidence IN ('medium', 'high');

CREATE OR REPLACE FUNCTION enforce_newsletter_valuation_item_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'newsletter valuation items are append-preserved'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.project_slug IS DISTINCT FROM OLD.project_slug
     OR NEW.project_profile IS DISTINCT FROM OLD.project_profile
     OR NEW.candidate_count IS DISTINCT FROM OLD.candidate_count
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'newsletter valuation item identity and profile are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_newsletter_valuation_item_immutable
  BEFORE UPDATE OR DELETE ON newsletter_valuation_items
  FOR EACH ROW
  EXECUTE FUNCTION enforce_newsletter_valuation_item_immutable();

CREATE OR REPLACE FUNCTION resolve_active_newsletter_issue()
RETURNS newsletter_issues
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT issue
  FROM newsletter_issues AS issue
  WHERE issue.status IN ('approved', 'sending')
  ORDER BY approved_at ASC NULLS LAST, created_at ASC, id ASC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION has_current_newsletter_project_valuation(p_project_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM propnex_valuations
    WHERE project_slug = p_project_slug
      AND evidence_status = 'accepted'
      AND evidence_contract_version = 'chloe-valuation-v1'
      AND validated_confidence IN ('medium', 'high')
      AND expires_at > clock_timestamp()
  )
$$;

CREATE OR REPLACE FUNCTION claim_newsletter_valuation_run(p_worker_id text, p_source_revision text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::date;
  v_issue newsletter_issues%rowtype;
  v_project crm_projects%rowtype;
  v_run newsletter_valuation_runs%rowtype;
  v_item newsletter_valuation_items%rowtype;
  v_candidate_count integer := 0;
  v_reason text;
  v_profile jsonb;
  v_candidates jsonb := '[]'::jsonb;
BEGIN
  IF p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR length(btrim(p_worker_id)) > 100 THEN
    RAISE EXCEPTION 'worker identity is required' USING ERRCODE = '22023';
  END IF;
  IF p_source_revision IS NULL OR btrim(p_source_revision) = ''
     OR length(btrim(p_source_revision)) > 200 THEN
    RAISE EXCEPTION 'source revision is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('newsletter_valuation_sgt_day'),
    v_today - DATE '2000-01-01'
  );

  SELECT * INTO v_issue FROM resolve_active_newsletter_issue();

  SELECT * INTO v_run
  FROM newsletter_valuation_runs
  WHERE run_date = v_today
    AND issue_id IS NOT DISTINCT FROM v_issue.id
  FOR UPDATE;

  IF FOUND THEN
    IF v_run.status = 'running'
       AND (v_run.worker_id IS DISTINCT FROM btrim(p_worker_id)
            OR v_run.source_revision IS DISTINCT FROM btrim(p_source_revision)) THEN
      IF v_run.last_heartbeat_at >= clock_timestamp() - INTERVAL '15 minutes' THEN
        RAISE EXCEPTION 'newsletter valuation run is already claimed'
          USING ERRCODE = '55006';
      END IF;
      UPDATE newsletter_valuation_runs
      SET worker_id = btrim(p_worker_id),
          source_revision = btrim(p_source_revision),
          lease_token = gen_random_uuid(),
          last_heartbeat_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE id = v_run.id
      RETURNING * INTO v_run;
    END IF;
  ELSIF v_issue.id IS NULL THEN
    INSERT INTO newsletter_valuation_runs (
      run_date, issue_id, status, worker_id, source_revision,
      candidate_count, project_count, completed_at
    ) VALUES (
      v_today, NULL, 'quiet', btrim(p_worker_id), btrim(p_source_revision),
      0, 0, clock_timestamp()
    ) RETURNING * INTO v_run;
  ELSE
    SELECT * INTO v_project
    FROM crm_projects
    WHERE slug = v_issue.audience_project_slug
      AND is_active = true;

    IF v_project.id IS NOT NULL THEN
      SELECT least(count(*), 5)::integer INTO v_candidate_count
      FROM crm_leads AS lead
      WHERE lead.project_id = v_project.id
        AND lead.opt_out_at IS NULL
        AND lead.status <> 'lost'
        AND lead.lead_code IS NOT NULL
        AND COALESCE(lead.phone_e164, '') ~ '^\+65[689][0-9]{7}$'
        AND NOT EXISTS (
          SELECT 1 FROM newsletter_suppressions AS suppression
          WHERE suppression.recipient_key = lead.phone_e164
        )
        AND NOT EXISTS (
          SELECT 1 FROM newsletter_sends AS send
          WHERE send.issue_id = v_issue.id
            AND send.is_test = false
            AND send.recipient_key = lead.phone_e164
            AND send.status IN ('queued','sending','sent','unknown')
        );
    END IF;

    IF v_project.id IS NULL
       OR v_project.valuation_location IS NULL
       OR v_project.valuation_property_type IS NULL
       OR v_project.valuation_tenure IS NULL
       OR v_project.valuation_area_distribution IS NULL THEN
      INSERT INTO newsletter_valuation_runs (
        run_date, issue_id, issue_slug, project_slug, status,
        worker_id, source_revision, candidate_count, project_count,
        blocked_count, blocker, completed_at
      ) VALUES (
        v_today, v_issue.id, v_issue.slug, v_issue.audience_project_slug, 'blocked',
        btrim(p_worker_id), btrim(p_source_revision), v_candidate_count, 0,
        1, 'project valuation profile is incomplete', clock_timestamp()
      ) RETURNING * INTO v_run;
    ELSIF v_candidate_count = 0 OR has_current_newsletter_project_valuation(v_issue.audience_project_slug) THEN
      INSERT INTO newsletter_valuation_runs (
        run_date, issue_id, issue_slug, project_slug, status,
        worker_id, source_revision, candidate_count, project_count, completed_at
      ) VALUES (
        v_today, v_issue.id, v_issue.slug, v_issue.audience_project_slug, 'quiet',
        btrim(p_worker_id), btrim(p_source_revision), 0, 0, clock_timestamp()
      ) RETURNING * INTO v_run;
    ELSE
      IF EXISTS (
        SELECT 1 FROM propnex_valuations
        WHERE project_slug = v_issue.audience_project_slug
          AND expires_at <= clock_timestamp()
      ) THEN
        v_reason := 'expired';
      ELSIF EXISTS (
        SELECT 1 FROM propnex_valuations
        WHERE project_slug = v_issue.audience_project_slug
      ) THEN
        v_reason := 'unsupported';
      ELSE
        v_reason := 'missing';
      END IF;

      v_profile := jsonb_build_object(
        'projectSlug', v_project.slug,
        'projectTitle', v_project.title,
        'location', v_project.valuation_location,
        'propertyType', v_project.valuation_property_type,
        'tenure', v_project.valuation_tenure,
        'areaDistribution', v_project.valuation_area_distribution,
        'profileUpdatedAt', v_project.valuation_profile_updated_at
      );

      INSERT INTO newsletter_valuation_runs (
        run_date, issue_id, issue_slug, project_slug, status,
        worker_id, source_revision, candidate_count, project_count
      ) VALUES (
        v_today, v_issue.id, v_issue.slug, v_project.slug, 'running',
        btrim(p_worker_id), btrim(p_source_revision), v_candidate_count, 1
      ) RETURNING * INTO v_run;

      INSERT INTO newsletter_valuation_items (
        run_id, project_slug, project_profile, candidate_count, reason
      ) VALUES (
        v_run.id, v_project.slug, v_profile, v_candidate_count, v_reason
      ) RETURNING * INTO v_item;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'itemId', item.id,
    'projectSlug', item.project_slug,
    'projectTitle', item.project_profile->>'projectTitle',
    'location', item.project_profile->>'location',
    'propertyType', item.project_profile->>'propertyType',
    'tenure', item.project_profile->>'tenure',
    'areaDistribution', item.project_profile->'areaDistribution',
    'candidateCount', item.candidate_count,
    'reason', item.reason
  ) ORDER BY item.created_at, item.id), '[]'::jsonb)
  INTO v_candidates
  FROM newsletter_valuation_items AS item
  WHERE item.run_id = v_run.id
    AND item.status = 'queued';

  RETURN jsonb_build_object(
    'runId', v_run.id,
    'leaseToken', v_run.lease_token,
    'issueId', v_run.issue_id,
    'issueSlug', v_run.issue_slug,
    'runDate', v_run.run_date,
    'status', v_run.status,
    'deadlineSgt', '09:20',
    'blocker', v_run.blocker,
    'candidates', v_candidates
  );
END;
$$;

CREATE OR REPLACE FUNCTION heartbeat_newsletter_valuation_run(p_run_id uuid, p_lease_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run newsletter_valuation_runs%rowtype;
BEGIN
  UPDATE newsletter_valuation_runs
  SET last_heartbeat_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = p_run_id
    AND lease_token = p_lease_token
    AND status = 'running'
  RETURNING * INTO v_run;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or terminal newsletter valuation lease'
      USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('runId', v_run.id, 'status', v_run.status,
    'lastHeartbeatAt', v_run.last_heartbeat_at);
END;
$$;

CREATE OR REPLACE FUNCTION record_newsletter_valuation_item(p_run_id uuid, p_item_id uuid, p_lease_token uuid, p_outcome jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run newsletter_valuation_runs%rowtype;
  v_item newsletter_valuation_items%rowtype;
  v_kind text := p_outcome->>'kind';
  v_evidence jsonb := p_outcome->'evidence';
  v_cache propnex_valuations%rowtype;
  v_result jsonb;
BEGIN
  SELECT * INTO v_run FROM newsletter_valuation_runs
  WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.lease_token IS DISTINCT FROM p_lease_token
     OR v_run.status <> 'running' THEN
    RAISE EXCEPTION 'invalid or terminal newsletter valuation lease'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_item FROM newsletter_valuation_items
  WHERE id = p_item_id AND run_id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter valuation item does not belong to run'
      USING ERRCODE = '55000';
  END IF;

  IF v_item.status <> 'queued' THEN
    IF p_outcome = v_item.outcome THEN
      RETURN jsonb_build_object(
        'runId', v_run.id, 'itemId', v_item.id, 'status', v_item.status,
        'cacheValuationId', v_item.cache_valuation_id
      );
    END IF;
    RAISE EXCEPTION 'conflicting valuation item replay'
      USING ERRCODE = '55000';
  END IF;

  IF v_kind NOT IN ('accepted','rejected','blocked','failed') THEN
    RAISE EXCEPTION 'unsupported valuation item outcome'
      USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'accepted' THEN
    IF v_evidence IS NULL
       OR v_evidence->>'evidenceContractVersion' <> 'chloe-valuation-v1'
       OR v_evidence->>'confidence' NOT IN ('medium','high')
       OR v_evidence->>'agentIdentity' IS DISTINCT FROM v_run.worker_id
       OR v_evidence->>'sourceRevision' IS DISTINCT FROM v_run.source_revision THEN
      RAISE EXCEPTION 'accepted valuation evidence contract is invalid'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO propnex_valuations (
      address_key, display_address, project_name, project_slug,
      low_sgd, mid_sgd, high_sgd, psf_low, psf_high, area_sqft,
      comparables_count, confidence, validated_confidence, raw_response,
      as_of, fetched_at, expires_at, evidence_status,
      evidence_contract_version, evidence_item_id
    ) VALUES (
      'project:' || v_item.project_slug,
      v_item.project_profile->>'projectTitle',
      v_item.project_profile->>'projectTitle',
      v_item.project_slug,
      NULLIF(v_evidence->>'lowSgd','')::numeric,
      NULLIF(v_evidence->>'midSgd','')::numeric,
      NULLIF(v_evidence->>'highSgd','')::numeric,
      NULLIF(v_evidence->>'psfLow','')::numeric,
      NULLIF(v_evidence->>'psfHigh','')::numeric,
      NULLIF(v_evidence->>'areaSqft','')::numeric,
      COALESCE(NULLIF(v_evidence->>'comparablesCount','')::integer, 0),
      v_evidence->>'confidence',
      v_evidence->>'confidence',
      v_evidence,
      (v_evidence->>'asOf')::date,
      clock_timestamp(),
      clock_timestamp() + INTERVAL '30 days',
      'accepted',
      'chloe-valuation-v1',
      v_item.id
    )
    ON CONFLICT (address_key) DO UPDATE SET
      display_address = EXCLUDED.display_address,
      project_name = EXCLUDED.project_name,
      project_slug = EXCLUDED.project_slug,
      low_sgd = EXCLUDED.low_sgd,
      mid_sgd = EXCLUDED.mid_sgd,
      high_sgd = EXCLUDED.high_sgd,
      psf_low = EXCLUDED.psf_low,
      psf_high = EXCLUDED.psf_high,
      area_sqft = EXCLUDED.area_sqft,
      comparables_count = EXCLUDED.comparables_count,
      confidence = EXCLUDED.confidence,
      validated_confidence = EXCLUDED.validated_confidence,
      raw_response = EXCLUDED.raw_response,
      as_of = EXCLUDED.as_of,
      fetched_at = EXCLUDED.fetched_at,
      expires_at = clock_timestamp() + INTERVAL '30 days',
      evidence_status = EXCLUDED.evidence_status,
      evidence_contract_version = EXCLUDED.evidence_contract_version,
      evidence_item_id = EXCLUDED.evidence_item_id
    RETURNING * INTO v_cache;

    UPDATE newsletter_valuation_items
    SET status = 'accepted', outcome = p_outcome,
        evidence_hash = v_evidence->>'evidenceHash',
        cache_valuation_id = v_cache.id,
        recorded_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = v_item.id
    RETURNING * INTO v_item;
  ELSE
    UPDATE newsletter_valuation_items
    SET status = v_kind,
        outcome = p_outcome,
        evidence_hash = NULLIF(p_outcome->>'evidenceHash',''),
        validation_error = COALESCE(p_outcome->>'errorDetail', p_outcome->>'reason'),
        recorded_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_item.id
    RETURNING * INTO v_item;
  END IF;

  UPDATE newsletter_valuation_runs
  SET last_heartbeat_at = clock_timestamp(),
      last_meaningful_work_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_run.id;

  v_result := jsonb_build_object(
    'runId', v_run.id, 'itemId', v_item.id, 'status', v_item.status,
    'cacheValuationId', v_item.cache_valuation_id
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION complete_newsletter_valuation_run(p_run_id uuid, p_lease_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run newsletter_valuation_runs%rowtype;
BEGIN
  SELECT * INTO v_run FROM newsletter_valuation_runs
  WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'invalid newsletter valuation lease' USING ERRCODE = '55000';
  END IF;
  IF v_run.status <> 'running' THEN
    RETURN jsonb_build_object(
      'runId', v_run.id, 'status', v_run.status,
      'candidateCount', v_run.candidate_count,
      'acceptedCount', v_run.accepted_count,
      'rejectedCount', v_run.rejected_count,
      'blockedCount', v_run.blocked_count,
      'failedCount', v_run.failed_count
    );
  END IF;
  IF EXISTS (
    SELECT 1 FROM newsletter_valuation_items
    WHERE run_id = p_run_id AND status = 'queued'
  ) THEN
    RAISE EXCEPTION 'newsletter valuation items remain queued'
      USING ERRCODE = '55000';
  END IF;

  UPDATE newsletter_valuation_runs AS run
  SET accepted_count = counts.accepted_count,
      rejected_count = counts.rejected_count,
      blocked_count = counts.blocked_count,
      failed_count = counts.failed_count,
      status = CASE
        WHEN run.candidate_count = 0 THEN 'quiet'
        WHEN counts.accepted_count > 0 THEN 'completed'
        WHEN counts.failed_count > 0 THEN 'failed'
        WHEN run.candidate_count > 0 AND counts.accepted_count = 0 THEN 'blocked'
        ELSE 'blocked'
      END,
      blocker = CASE
        WHEN counts.accepted_count > 0 OR run.candidate_count = 0 THEN NULL
        WHEN counts.failed_count > 0 THEN 'valuation research failed'
        ELSE 'no valuation evidence was accepted'
      END,
      completed_at = clock_timestamp(),
      last_heartbeat_at = clock_timestamp(),
      last_meaningful_work_at = clock_timestamp(),
      updated_at = clock_timestamp()
  FROM (
    SELECT
      count(*) FILTER (WHERE status = 'accepted')::integer AS accepted_count,
      count(*) FILTER (WHERE status = 'rejected')::integer AS rejected_count,
      count(*) FILTER (WHERE status = 'blocked')::integer AS blocked_count,
      count(*) FILTER (WHERE status = 'failed')::integer AS failed_count
    FROM newsletter_valuation_items
    WHERE run_id = p_run_id
  ) AS counts
  WHERE run.id = p_run_id
  RETURNING run.* INTO v_run;

  RETURN jsonb_build_object(
    'runId', v_run.id, 'status', v_run.status,
    'candidateCount', v_run.candidate_count,
    'acceptedCount', v_run.accepted_count,
    'rejectedCount', v_run.rejected_count,
    'blockedCount', v_run.blocked_count,
    'failedCount', v_run.failed_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_newsletter_valuation_gate(p_issue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::date;
  v_run newsletter_valuation_runs%rowtype;
  v_healthy boolean := false;
  v_reason text;
BEGIN
  SELECT * INTO v_run
  FROM newsletter_valuation_runs
  WHERE run_date = v_today AND issue_id = p_issue_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    v_reason := 'missing current-day valuation preparation';
  ELSIF v_run.status IN ('completed', 'quiet') THEN
    v_healthy := true;
  ELSE
    v_reason := COALESCE(v_run.blocker, 'valuation preparation is ' || v_run.status);
  END IF;

  RETURN jsonb_build_object(
    'healthy', v_healthy,
    'reason', v_reason,
    'runId', v_run.id,
    'runDate', v_run.run_date,
    'issueId', v_run.issue_id,
    'status', v_run.status,
    'lastHeartbeatAt', v_run.last_heartbeat_at,
    'lastMeaningfulWorkAt', v_run.last_meaningful_work_at,
    'candidateCount', COALESCE(v_run.candidate_count, 0),
    'acceptedCount', COALESCE(v_run.accepted_count, 0),
    'rejectedCount', COALESCE(v_run.rejected_count, 0),
    'blockedCount', COALESCE(v_run.blocked_count, 0),
    'failedCount', COALESCE(v_run.failed_count, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION assert_newsletter_valuation_gate(p_issue_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gate jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM newsletter_valuation_runs
    WHERE run_date = (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::date
      AND issue_id = p_issue_id
      AND status IN ('completed', 'quiet')
  ) THEN
    RAISE SQLSTATE '55000'
      USING MESSAGE = 'newsletter valuation preparation is not healthy';
  END IF;
  v_gate := get_newsletter_valuation_gate(p_issue_id);
  IF NOT COALESCE((v_gate->>'healthy')::boolean, false) THEN
    RAISE SQLSTATE '55000' USING MESSAGE = COALESCE(
      v_gate->>'reason',
      'newsletter valuation preparation is not healthy'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION claim_newsletter_run(p_claim_token text, p_issue_id uuid)
RETURNS newsletter_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run_date date := (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::date;
  v_issue_id uuid := p_issue_id;
  v_run newsletter_runs%rowtype;
BEGIN
  IF p_claim_token IS NULL OR btrim(p_claim_token) = '' THEN
    RAISE EXCEPTION 'claim token is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM newsletter_issues AS issue
    WHERE issue.id = p_issue_id
      AND issue.status IN ('approved', 'sending')
  ) THEN
    RAISE EXCEPTION 'newsletter issue is not active' USING ERRCODE = '55000';
  END IF;
  PERFORM assert_newsletter_valuation_gate(v_issue_id);
  PERFORM pg_advisory_xact_lock(
    hashtext('newsletter_sgt_day'),
    v_run_date - DATE '2000-01-01'
  );

  SELECT * INTO v_run FROM newsletter_runs
  WHERE run_date = v_run_date FOR UPDATE;
  IF FOUND THEN
    IF v_run.issue_id IS DISTINCT FROM v_issue_id THEN
      RAISE EXCEPTION 'newsletter run belongs to a different issue'
        USING ERRCODE = '55000';
    END IF;
    IF v_run.status = 'running'
       AND v_run.claim_token IS DISTINCT FROM btrim(p_claim_token) THEN
      IF v_run.last_heartbeat_at >= clock_timestamp() - INTERVAL '15 minutes' THEN
        RAISE EXCEPTION 'newsletter run is already claimed' USING ERRCODE = '55006';
      END IF;
      UPDATE newsletter_runs
      SET claim_token = btrim(p_claim_token),
          last_heartbeat_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE id = v_run.id RETURNING * INTO v_run;
    END IF;
    RETURN v_run;
  END IF;

  INSERT INTO newsletter_runs (
    run_date, issue_id, status, claim_token, blocker, started_at
  ) VALUES (
    v_run_date, v_issue_id, 'running', btrim(p_claim_token), NULL, clock_timestamp()
  ) RETURNING * INTO v_run;
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION claim_newsletter_run(p_claim_token text)
RETURNS newsletter_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_issue_id uuid;
  v_run newsletter_runs%rowtype;
BEGIN
  SELECT id INTO v_issue_id
  FROM newsletter_issues
  WHERE status IN ('approved', 'sending')
  ORDER BY approved_at ASC NULLS LAST, created_at ASC, id ASC
  LIMIT 1;
  IF v_issue_id IS NULL THEN
    RAISE EXCEPTION 'no active newsletter issue' USING ERRCODE = '55000';
  END IF;
  PERFORM assert_newsletter_valuation_gate(v_issue_id);
  v_run := claim_newsletter_run(p_claim_token, v_issue_id);
  RETURN v_run;
END;
$$;

REVOKE ALL ON TABLE newsletter_valuation_runs FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE newsletter_valuation_items FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE propnex_valuations FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE newsletter_valuation_runs TO service_role;
GRANT SELECT ON TABLE newsletter_valuation_items TO service_role;
GRANT SELECT ON TABLE propnex_valuations TO service_role;

REVOKE ALL ON FUNCTION claim_newsletter_valuation_run(TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION heartbeat_newsletter_valuation_run(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION record_newsletter_valuation_item(UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION complete_newsletter_valuation_run(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION get_newsletter_valuation_gate(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION claim_newsletter_run(TEXT, UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION claim_newsletter_run(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION resolve_active_newsletter_issue() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION has_current_newsletter_project_valuation(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION assert_newsletter_valuation_gate(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION enforce_newsletter_valuation_item_immutable() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION claim_newsletter_valuation_run(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION heartbeat_newsletter_valuation_run(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION record_newsletter_valuation_item(UUID, UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION complete_newsletter_valuation_run(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_newsletter_valuation_gate(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION claim_newsletter_run(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION claim_newsletter_run(TEXT) TO service_role;

COMMENT ON TABLE newsletter_valuation_runs IS
  'One lease-owned valuation preparation run per Singapore date and issue.';
COMMENT ON TABLE newsletter_valuation_items IS
  'PII-free project research snapshots and terminal evidence outcomes.';
