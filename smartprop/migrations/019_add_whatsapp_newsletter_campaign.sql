-- Transactional state machine for the five-recipient daily WhatsApp newsletter.

ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT;

WITH normalized AS (
  SELECT
    id,
    regexp_replace(phone, '[^0-9]', '', 'g') AS digits
  FROM crm_leads
  WHERE phone_e164 IS NULL
)
UPDATE crm_leads AS lead
SET phone_e164 = CASE
  WHEN length(normalized.digits) = 8 THEN '+65' || normalized.digits
  WHEN length(normalized.digits) BETWEEN 8 AND 15 THEN '+' || normalized.digits
  ELSE NULL
END
FROM normalized
WHERE lead.id = normalized.id;

CREATE INDEX IF NOT EXISTS idx_crm_leads_phone_e164
  ON crm_leads(phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE TABLE IF NOT EXISTS newsletter_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL,
  issue_id UUID REFERENCES newsletter_issues(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('blocked','running','completed','failed')),
  claim_token TEXT,
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count BETWEEN 0 AND 5),
  attempted_count INTEGER NOT NULL DEFAULT 0 CHECK (attempted_count BETWEEN 0 AND 5),
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  unknown_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  blocker TEXT,
  report_error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_date)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_runs_status_date
  ON newsletter_runs(status, run_date DESC);

CREATE TABLE IF NOT EXISTS newsletter_suppressions (
  recipient_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  first_message_id TEXT,
  last_message_id TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_suppression_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_key TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipient_key, provider_message_id)
);

INSERT INTO newsletter_suppression_events (
  recipient_key,
  provider_message_id,
  reason,
  received_at
)
SELECT recipient_key, first_message_id, reason, first_seen_at
FROM newsletter_suppressions
WHERE first_message_id IS NOT NULL
UNION
SELECT recipient_key, last_message_id, reason, last_seen_at
FROM newsletter_suppressions
WHERE last_message_id IS NOT NULL
ON CONFLICT (recipient_key, provider_message_id) DO NOTHING;

ALTER TABLE newsletter_sends
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES newsletter_runs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS slot_no INTEGER,
  ADD COLUMN IF NOT EXISTS recipient_name TEXT,
  ADD COLUMN IF NOT EXISTS recipient_key TEXT,
  ADD COLUMN IF NOT EXISTS attempt_no INTEGER,
  ADD COLUMN IF NOT EXISTS attempt_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS provider_outcome TEXT,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS crm_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS unknown_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unknown_resolved_by TEXT,
  ADD COLUMN IF NOT EXISTS unknown_resolution TEXT,
  ADD COLUMN IF NOT EXISTS unknown_resolution_reason TEXT;

ALTER TABLE newsletter_sends
  DROP CONSTRAINT IF EXISTS newsletter_sends_issue_id_lead_id_key,
  DROP CONSTRAINT IF EXISTS newsletter_sends_lead_id_fkey,
  DROP CONSTRAINT IF EXISTS newsletter_sends_status_check,
  DROP CONSTRAINT IF EXISTS newsletter_sends_slot_no_check,
  DROP CONSTRAINT IF EXISTS newsletter_sends_attempt_no_check,
  DROP CONSTRAINT IF EXISTS newsletter_sends_provider_outcome_check,
  DROP CONSTRAINT IF EXISTS newsletter_sends_unknown_resolution_check,
  DROP CONSTRAINT IF EXISTS newsletter_sends_unknown_retryable_check,
  DROP CONSTRAINT IF EXISTS newsletter_sends_submission_started_check,
  DROP CONSTRAINT IF EXISTS newsletter_sends_submission_identity_check;

ALTER TABLE newsletter_sends
  ALTER COLUMN lead_id DROP NOT NULL,
  ADD CONSTRAINT newsletter_sends_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL,
  ADD CONSTRAINT newsletter_sends_status_check
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'unknown', 'opted_out', 'skipped', 'test')),
  ADD CONSTRAINT newsletter_sends_slot_no_check
    CHECK (slot_no BETWEEN 1 AND 5),
  ADD CONSTRAINT newsletter_sends_attempt_no_check
    CHECK (attempt_no IS NULL OR attempt_no BETWEEN 1 AND 3),
  ADD CONSTRAINT newsletter_sends_provider_outcome_check
    CHECK (provider_outcome IS NULL OR provider_outcome IN ('sent', 'failed', 'unknown')),
  ADD CONSTRAINT newsletter_sends_unknown_resolution_check
    CHECK (unknown_resolution IS NULL OR unknown_resolution IN ('sent', 'failed')),
  ADD CONSTRAINT newsletter_sends_unknown_retryable_check
    CHECK (status <> 'unknown' OR retryable = FALSE);

UPDATE newsletter_sends
SET
  status = 'skipped',
  error_code = COALESCE(error_code, 'legacy_pre_campaign_no_provider_evidence')
WHERE status = 'failed'
  AND is_test = FALSE
  AND sent_at IS NULL
  AND waha_message_id IS NULL;

WITH backfill AS (
  SELECT
    send.id,
    lead.name,
    regexp_replace(COALESCE(lead.phone_e164, send.phone), '[^0-9]', '', 'g') AS digits
  FROM newsletter_sends AS send
  LEFT JOIN crm_leads AS lead ON lead.id = send.lead_id
)
UPDATE newsletter_sends AS send
SET
  recipient_name = COALESCE(send.recipient_name, backfill.name),
  recipient_key = COALESCE(
    send.recipient_key,
    CASE
      WHEN length(backfill.digits) = 8 THEN '+65' || backfill.digits
      WHEN length(backfill.digits) = 10 AND left(backfill.digits, 2) = '65'
        THEN '+' || backfill.digits
      ELSE NULL
    END
  ),
  attempt_no = COALESCE(send.attempt_no, 1),
  attempt_started_at = COALESCE(
    send.attempt_started_at,
    CASE
      WHEN send.status IN ('sent', 'failed') THEN COALESCE(send.sent_at, send.created_at)
      ELSE NULL
    END
  ),
  completed_at = COALESCE(send.completed_at, send.sent_at, send.updated_at),
  provider_outcome = COALESCE(
    send.provider_outcome,
    CASE WHEN send.status IN ('sent', 'failed') THEN send.status ELSE NULL END
  )
FROM backfill
WHERE send.id = backfill.id;

ALTER TABLE newsletter_sends
  ADD CONSTRAINT newsletter_sends_submission_started_check
    CHECK (
      status NOT IN ('sending', 'sent', 'failed', 'unknown')
      OR attempt_started_at IS NOT NULL
    ),
  ADD CONSTRAINT newsletter_sends_submission_identity_check
    CHECK (
      is_test = TRUE
      OR attempt_started_at IS NULL
      OR (
        slot_no IS NOT NULL
        AND recipient_key IS NOT NULL
        AND recipient_key ~ '^\+65[689][0-9]{7}$'
        AND recipient_key = CASE
          WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 8
            THEN '+65' || regexp_replace(phone, '[^0-9]', '', 'g')
          WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10
               AND left(regexp_replace(phone, '[^0-9]', '', 'g'), 2) = '65'
            THEN '+' || regexp_replace(phone, '[^0-9]', '', 'g')
          ELSE NULL
        END
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_attempt_number
  ON newsletter_sends(issue_id, recipient_key, attempt_no)
  WHERE recipient_key IS NOT NULL AND is_test = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_active_recipient
  ON newsletter_sends(issue_id, recipient_key)
  WHERE status IN ('queued', 'sending', 'sent', 'unknown')
    AND recipient_key IS NOT NULL
    AND is_test = FALSE
;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_run_slot
  ON newsletter_sends(run_id, slot_no)
  WHERE run_id IS NOT NULL AND slot_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_newsletter_sends_run_status
  ON newsletter_sends(run_id, status);

CREATE INDEX IF NOT EXISTS idx_newsletter_sends_recipient_key
  ON newsletter_sends(recipient_key, created_at DESC)
  WHERE recipient_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS newsletter_operator_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES newsletter_runs(id) ON DELETE RESTRICT,
  operator_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('summary','recipient')),
  send_id UUID REFERENCES newsletter_sends(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sending','sent','failed','unknown')),
  provider_message_id TEXT,
  error TEXT,
  attempt_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, operator_key, kind, send_id)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_operator_reports_run_status
  ON newsletter_operator_reports(run_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_operator_summary
  ON newsletter_operator_reports(run_id, operator_key, kind)
  WHERE send_id IS NULL;

CREATE OR REPLACE FUNCTION enforce_newsletter_suppression_event_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'newsletter suppression events are append-only'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_newsletter_suppression_event_append_only
  ON newsletter_suppression_events;
CREATE TRIGGER trg_newsletter_suppression_event_append_only
  BEFORE UPDATE OR DELETE ON newsletter_suppression_events
  FOR EACH ROW
  EXECUTE FUNCTION enforce_newsletter_suppression_event_append_only();

CREATE OR REPLACE FUNCTION enforce_newsletter_attempt_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fk_lead_nulling BOOLEAN := FALSE;
  v_authorized_start BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'newsletter attempts are append-only'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN
    v_fk_lead_nulling := OLD.lead_id IS NOT NULL
      AND NEW.lead_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM crm_leads
        WHERE id = OLD.lead_id
      );

    IF NOT v_fk_lead_nulling THEN
      RAISE EXCEPTION 'newsletter attempt lead identity is immutable while the CRM lead exists'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  v_authorized_start := OLD.status = 'queued'
    AND NEW.status = 'sending'
    AND OLD.attempt_started_at IS NULL
    AND NEW.attempt_started_at IS NOT NULL
    AND current_setting('app.newsletter_start_send_id', TRUE) = NEW.id::TEXT;

  IF NEW.issue_id IS DISTINCT FROM OLD.issue_id
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR (NEW.slot_no IS DISTINCT FROM OLD.slot_no AND NOT v_authorized_start)
     OR NEW.recipient_name IS DISTINCT FROM OLD.recipient_name
     OR NEW.recipient_key IS DISTINCT FROM OLD.recipient_key
     OR (NEW.attempt_no IS DISTINCT FROM OLD.attempt_no AND NOT v_authorized_start)
     OR NEW.phone IS DISTINCT FROM OLD.phone
     OR NEW.rendered_body IS DISTINCT FROM OLD.rendered_body
     OR NEW.valuation_snapshot IS DISTINCT FROM OLD.valuation_snapshot
     OR NEW.is_test IS DISTINCT FROM OLD.is_test THEN
    RAISE EXCEPTION 'newsletter attempt identity and send-time snapshots are immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_newsletter_attempt_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sgt_date DATE := (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::DATE;
  v_run newsletter_runs%ROWTYPE;
  v_day_attempt_count INTEGER;
  v_recipient_attempt_count INTEGER;
  v_phone_digits TEXT;
  v_canonical_recipient_key TEXT;
  v_is_start_transition BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.attempt_started_at IS NULL AND NEW.attempt_started_at IS NOT NULL THEN
      IF OLD.status <> 'queued'
         OR NEW.status <> 'sending'
         OR current_setting('app.newsletter_start_send_id', TRUE) IS DISTINCT FROM NEW.id::TEXT THEN
        RAISE EXCEPTION 'provider submissions must be created by start_newsletter_attempt'
          USING ERRCODE = '55000';
      END IF;

      v_is_start_transition := TRUE;
    END IF;

    IF OLD.attempt_started_at IS NOT NULL THEN
      IF NEW.attempt_started_at IS DISTINCT FROM OLD.attempt_started_at THEN
        RAISE EXCEPTION 'attempt_started_at is immutable once provider submission begins'
          USING ERRCODE = '55000';
      END IF;

      IF NEW.status = OLD.status
         OR (OLD.status = 'sending' AND NEW.status IN ('sent', 'failed', 'unknown'))
         OR (OLD.status = 'unknown' AND NEW.status IN ('sent', 'failed')) THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'invalid newsletter provider state transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '55000';
    END IF;

    IF NOT v_is_start_transition THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.is_test = TRUE OR NEW.attempt_started_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.run_id IS NULL
     OR NEW.issue_id IS NULL
     OR NEW.slot_no IS NULL
     OR NEW.recipient_key IS NULL
     OR NEW.attempt_no IS NULL THEN
    RAISE EXCEPTION 'real provider submissions require run, issue, slot, recipient, and attempt identity'
      USING ERRCODE = '23502';
  END IF;

  v_phone_digits := regexp_replace(NEW.phone, '[^0-9]', '', 'g');
  v_canonical_recipient_key := CASE
    WHEN length(v_phone_digits) = 8 THEN '+65' || v_phone_digits
    WHEN length(v_phone_digits) = 10 AND left(v_phone_digits, 2) = '65'
      THEN '+' || v_phone_digits
    ELSE NULL
  END;

  IF v_canonical_recipient_key IS NULL
     OR v_canonical_recipient_key !~ '^\+65[689][0-9]{7}$'
     OR NEW.recipient_key IS DISTINCT FROM v_canonical_recipient_key THEN
    RAISE EXCEPTION 'recipient key must equal canonical Singapore E.164 phone snapshot'
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'real provider submissions must transition from a persisted queued row'
      USING ERRCODE = '55000';
  END IF;

  -- Lock order: SGT day -> recipient -> run -> lead -> send.
  PERFORM pg_advisory_xact_lock(
    hashtext('newsletter_sgt_day'),
    v_sgt_date - DATE '2000-01-01'
  );
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_recipient:' || NEW.recipient_key));
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_run:' || NEW.run_id::TEXT));

  SELECT * INTO v_run
  FROM newsletter_runs
  WHERE id = NEW.run_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_run.status <> 'running'
     OR v_run.issue_id IS DISTINCT FROM NEW.issue_id
     OR v_run.run_date <> v_sgt_date THEN
    RAISE EXCEPTION 'provider submission requires the current running SGT-day run'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::INTEGER INTO v_day_attempt_count
  FROM newsletter_sends AS send
  JOIN newsletter_runs AS run ON run.id = send.run_id
  WHERE run.run_date = v_sgt_date
    AND send.is_test = FALSE
    AND send.attempt_started_at IS NOT NULL;

  IF v_day_attempt_count >= 5 THEN
    RAISE EXCEPTION 'SGT day has consumed all five provider submissions'
      USING ERRCODE = '54000';
  END IF;

  SELECT count(*)::INTEGER INTO v_recipient_attempt_count
  FROM newsletter_sends AS send
  WHERE send.issue_id = NEW.issue_id
    AND send.recipient_key = NEW.recipient_key
    AND send.is_test = FALSE
    AND send.attempt_started_at IS NOT NULL;

  IF v_recipient_attempt_count >= 3 OR NEW.attempt_no NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'recipient has consumed all three provider submissions for this issue'
      USING ERRCODE = '54000';
  END IF;

  UPDATE newsletter_runs
  SET attempted_count = v_day_attempt_count + 1,
      selected_count = GREATEST(selected_count, v_day_attempt_count + 1),
      last_heartbeat_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_run.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_newsletter_attempt_append_only ON newsletter_sends;
CREATE TRIGGER trg_newsletter_attempt_append_only
  BEFORE UPDATE OR DELETE ON newsletter_sends
  FOR EACH ROW
  EXECUTE FUNCTION enforce_newsletter_attempt_append_only();

DROP TRIGGER IF EXISTS trg_newsletter_attempt_submission ON newsletter_sends;
CREATE TRIGGER trg_newsletter_attempt_submission
  BEFORE INSERT OR UPDATE ON newsletter_sends
  FOR EACH ROW
  EXECUTE FUNCTION enforce_newsletter_attempt_submission();

CREATE OR REPLACE FUNCTION claim_newsletter_run(p_claim_token TEXT)
RETURNS newsletter_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_date DATE := (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::DATE;
  v_issue_id UUID;
  v_run newsletter_runs%ROWTYPE;
BEGIN
  IF p_claim_token IS NULL OR btrim(p_claim_token) = '' THEN
    RAISE EXCEPTION 'claim token is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('newsletter_sgt_day'),
    v_run_date - DATE '2000-01-01'
  );

  SELECT * INTO v_run
  FROM newsletter_runs
  WHERE run_date = v_run_date
  FOR UPDATE;

  IF FOUND THEN
    IF v_run.status = 'running'
       AND v_run.claim_token IS DISTINCT FROM btrim(p_claim_token) THEN
      IF v_run.last_heartbeat_at >= clock_timestamp() - INTERVAL '15 minutes' THEN
        RAISE EXCEPTION 'newsletter run is already claimed'
          USING ERRCODE = '55006';
      END IF;

      UPDATE newsletter_runs
      SET claim_token = btrim(p_claim_token),
          last_heartbeat_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE id = v_run.id
      RETURNING * INTO v_run;
    END IF;
    RETURN v_run;
  END IF;

  SELECT id INTO v_issue_id
  FROM newsletter_issues
  WHERE status = 'approved'
  ORDER BY approved_at DESC NULLS LAST, created_at DESC, id
  LIMIT 1;

  INSERT INTO newsletter_runs (
    run_date,
    issue_id,
    status,
    claim_token,
    blocker,
    started_at
  )
  VALUES (
    v_run_date,
    v_issue_id,
    CASE WHEN v_issue_id IS NULL THEN 'blocked' ELSE 'running' END,
    btrim(p_claim_token),
    CASE WHEN v_issue_id IS NULL THEN 'no approved newsletter issue' ELSE NULL END,
    CASE WHEN v_issue_id IS NULL THEN NULL ELSE clock_timestamp() END
  )
  RETURNING * INTO v_run;

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION queue_newsletter_attempt(
  p_run_id UUID,
  p_lead_id UUID,
  p_claim_token TEXT,
  p_rendered_body TEXT,
  p_valuation_snapshot JSONB
)
RETURNS newsletter_sends
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sgt_date DATE := (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::DATE;
  v_run newsletter_runs%ROWTYPE;
  v_issue newsletter_issues%ROWTYPE;
  v_lead crm_leads%ROWTYPE;
  v_send newsletter_sends%ROWTYPE;
  v_digits TEXT;
  v_recipient_key TEXT;
  v_recipient_attempt_count INTEGER;
  v_committed_count INTEGER;
BEGIN
  IF p_run_id IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'run id and lead id are required' USING ERRCODE = '22023';
  END IF;
  IF p_claim_token IS NULL OR btrim(p_claim_token) = '' THEN
    RAISE EXCEPTION 'claim token is required' USING ERRCODE = '22023';
  END IF;
  IF p_rendered_body IS NULL OR btrim(p_rendered_body) = '' THEN
    RAISE EXCEPTION 'rendered body is required' USING ERRCODE = '22023';
  END IF;
  IF p_valuation_snapshot IS NULL THEN
    RAISE EXCEPTION 'valuation snapshot is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_lead
  FROM crm_leads
  WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRM lead not found' USING ERRCODE = 'P0002';
  END IF;

  v_digits := regexp_replace(COALESCE(v_lead.phone_e164, v_lead.phone), '[^0-9]', '', 'g');
  v_recipient_key := CASE
    WHEN length(v_digits) = 8 THEN '+65' || v_digits
    WHEN length(v_digits) = 10 AND left(v_digits, 2) = '65' THEN '+' || v_digits
    ELSE NULL
  END;
  IF v_recipient_key IS NULL OR v_recipient_key !~ '^\+65[689][0-9]{7}$' THEN
    RAISE EXCEPTION 'lead does not have a canonical Singapore recipient key'
      USING ERRCODE = '22023';
  END IF;

  -- Lock order: SGT day -> recipient -> run -> lead -> send.
  PERFORM pg_advisory_xact_lock(
    hashtext('newsletter_sgt_day'),
    v_sgt_date - DATE '2000-01-01'
  );
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_recipient:' || v_recipient_key));
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_run:' || p_run_id::TEXT));

  SELECT * INTO v_run
  FROM newsletter_runs
  WHERE id = p_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter run not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> 'running'
     OR v_run.run_date <> v_sgt_date
     OR v_run.issue_id IS NULL
     OR v_run.claim_token IS DISTINCT FROM btrim(p_claim_token) THEN
    RAISE EXCEPTION 'newsletter run is not claimed and queueable'
      USING ERRCODE = '55000';
  END IF;

  SELECT issue.* INTO v_issue
  FROM newsletter_issues AS issue
  WHERE issue.id = v_run.issue_id
    AND issue.status IN ('approved', 'sending');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter issue is not active' USING ERRCODE = '55000';
  END IF;

  SELECT lead.* INTO v_lead
  FROM crm_leads AS lead
  JOIN crm_projects AS project ON project.id = lead.project_id
  JOIN newsletter_issues AS issue ON issue.id = v_run.issue_id
  WHERE lead.id = p_lead_id
    AND project.is_active = TRUE
    AND issue.audience_project_slug = project.slug
    AND lead.status <> 'lost'
    AND lead.opt_out_at IS NULL
  FOR UPDATE OF lead;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead is not active in the newsletter audience'
      USING ERRCODE = '55000';
  END IF;

  IF v_recipient_key IS DISTINCT FROM (CASE
    WHEN length(regexp_replace(COALESCE(v_lead.phone_e164, v_lead.phone), '[^0-9]', '', 'g')) = 8
      THEN '+65' || regexp_replace(COALESCE(v_lead.phone_e164, v_lead.phone), '[^0-9]', '', 'g')
    WHEN length(regexp_replace(COALESCE(v_lead.phone_e164, v_lead.phone), '[^0-9]', '', 'g')) = 10
         AND left(regexp_replace(COALESCE(v_lead.phone_e164, v_lead.phone), '[^0-9]', '', 'g'), 2) = '65'
      THEN '+' || regexp_replace(COALESCE(v_lead.phone_e164, v_lead.phone), '[^0-9]', '', 'g')
    ELSE NULL
  END) THEN
    RAISE EXCEPTION 'lead recipient changed while queueing; retry'
      USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM newsletter_suppressions WHERE recipient_key = v_recipient_key
  ) THEN
    RAISE EXCEPTION 'recipient is suppressed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::INTEGER INTO v_recipient_attempt_count
  FROM newsletter_sends
  WHERE issue_id = v_run.issue_id
    AND recipient_key = v_recipient_key
    AND is_test = FALSE
    AND attempt_started_at IS NOT NULL;
  IF v_recipient_attempt_count >= 3 THEN
    RAISE EXCEPTION 'recipient has consumed all three provider submissions for this issue'
      USING ERRCODE = '54000';
  END IF;

  SELECT * INTO v_send
  FROM newsletter_sends
  WHERE issue_id = v_run.issue_id
    AND recipient_key = v_recipient_key
    AND is_test = FALSE
    AND status IN ('queued', 'sending', 'sent', 'unknown')
  FOR UPDATE;
  IF FOUND THEN
    IF v_send.run_id = v_run.id AND v_send.status = 'queued' THEN
      RETURN v_send;
    END IF;
    RAISE EXCEPTION 'recipient already has an active newsletter attempt'
      USING ERRCODE = '23505';
  END IF;

  SELECT count(*)::INTEGER INTO v_committed_count
  FROM newsletter_sends
  WHERE run_id = v_run.id
    AND is_test = FALSE
    AND (attempt_started_at IS NOT NULL OR status = 'queued');
  IF v_committed_count >= 5 THEN
    RAISE EXCEPTION 'newsletter run already has five persisted or started attempts'
      USING ERRCODE = '54000';
  END IF;

  INSERT INTO newsletter_sends (
    issue_id,
    run_id,
    lead_id,
    recipient_name,
    recipient_key,
    attempt_no,
    phone,
    rendered_body,
    valuation_snapshot,
    status,
    retryable,
    is_test
  )
  VALUES (
    v_run.issue_id,
    v_run.id,
    v_lead.id,
    v_lead.name,
    v_recipient_key,
    NULL,
    v_recipient_key,
    p_rendered_body,
    p_valuation_snapshot,
    'queued',
    TRUE,
    FALSE
  )
  RETURNING * INTO v_send;

  UPDATE newsletter_runs
  SET selected_count = v_committed_count + 1,
      last_heartbeat_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_run.id;

  RETURN v_send;
END;
$$;

DROP FUNCTION IF EXISTS start_newsletter_attempt(UUID, UUID, INTEGER, TEXT);
DROP FUNCTION IF EXISTS start_newsletter_attempt(UUID, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION start_newsletter_attempt(
  p_send_id UUID,
  p_slot_no INTEGER,
  p_claim_token TEXT
)
RETURNS newsletter_sends
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sgt_date DATE := (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::DATE;
  v_identity newsletter_sends%ROWTYPE;
  v_send newsletter_sends%ROWTYPE;
  v_run newsletter_runs%ROWTYPE;
  v_lead crm_leads%ROWTYPE;
  v_day_attempt_count INTEGER;
  v_recipient_attempt_count INTEGER;
  v_attempt_no INTEGER;
  v_current_digits TEXT;
  v_current_recipient_key TEXT;
BEGIN
  IF p_send_id IS NULL THEN
    RAISE EXCEPTION 'send id is required' USING ERRCODE = '22023';
  END IF;
  IF p_slot_no IS NULL OR p_slot_no NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'slot number must be between 1 and 5' USING ERRCODE = '22023';
  END IF;
  IF p_claim_token IS NULL OR btrim(p_claim_token) = '' THEN
    RAISE EXCEPTION 'claim token is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_identity
  FROM public.newsletter_sends
  WHERE id = p_send_id;
  IF NOT FOUND OR v_identity.run_id IS NULL OR v_identity.recipient_key IS NULL THEN
    RAISE EXCEPTION 'queued newsletter attempt not found' USING ERRCODE = 'P0002';
  END IF;

  -- Lock order: SGT day -> recipient -> run -> lead -> send.
  PERFORM pg_advisory_xact_lock(
    hashtext('newsletter_sgt_day'),
    v_sgt_date - DATE '2000-01-01'
  );
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_recipient:' || v_identity.recipient_key));
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_run:' || v_identity.run_id::TEXT));

  SELECT * INTO v_run
  FROM newsletter_runs
  WHERE id = v_identity.run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter run not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> 'running'
     OR v_run.run_date <> v_sgt_date
     OR v_run.claim_token IS DISTINCT FROM btrim(p_claim_token) THEN
    RAISE EXCEPTION 'newsletter run claim is not valid for start'
      USING ERRCODE = '55000';
  END IF;

  IF v_identity.lead_id IS NULL THEN
    RAISE EXCEPTION 'queued attempt no longer has an active CRM lead'
      USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_lead
  FROM crm_leads
  WHERE id = v_identity.lead_id
  FOR UPDATE;
  IF NOT FOUND OR v_lead.status = 'lost' THEN
    RAISE EXCEPTION 'queued attempt lead is no longer sendable'
      USING ERRCODE = '55000';
  END IF;

  v_current_digits := regexp_replace(
    COALESCE(v_lead.phone_e164, v_lead.phone),
    '[^0-9]',
    '',
    'g'
  );
  v_current_recipient_key := CASE
    WHEN length(v_current_digits) = 8 THEN '+65' || v_current_digits
    WHEN length(v_current_digits) = 10 AND left(v_current_digits, 2) = '65'
      THEN '+' || v_current_digits
    ELSE NULL
  END;
  IF v_current_recipient_key IS DISTINCT FROM v_identity.recipient_key
     OR v_current_recipient_key !~ '^\+65[689][0-9]{7}$' THEN
    RAISE EXCEPTION 'queued recipient no longer matches the current CRM phone'
      USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('newsletter_send:' || p_send_id::TEXT));
  SELECT * INTO v_send
  FROM newsletter_sends
  WHERE id = p_send_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter attempt is not queued'
      USING ERRCODE = '55000';
  END IF;
  IF v_send.status = 'opted_out' AND v_send.attempt_started_at IS NULL THEN
    RETURN v_send;
  END IF;
  IF v_send.status <> 'queued' OR v_send.attempt_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'newsletter attempt is not queued'
      USING ERRCODE = '55000';
  END IF;

  IF v_send.run_id IS DISTINCT FROM v_run.id
     OR v_send.issue_id IS DISTINCT FROM v_run.issue_id
     OR v_send.recipient_key IS DISTINCT FROM (CASE
       WHEN length(regexp_replace(v_send.phone, '[^0-9]', '', 'g')) = 8
         THEN '+65' || regexp_replace(v_send.phone, '[^0-9]', '', 'g')
       WHEN length(regexp_replace(v_send.phone, '[^0-9]', '', 'g')) = 10
            AND left(regexp_replace(v_send.phone, '[^0-9]', '', 'g'), 2) = '65'
         THEN '+' || regexp_replace(v_send.phone, '[^0-9]', '', 'g')
       ELSE NULL
     END) THEN
    RAISE EXCEPTION 'queued attempt identity is invalid' USING ERRCODE = '55000';
  END IF;

  IF v_lead.opt_out_at IS NOT NULL THEN
    UPDATE newsletter_sends
    SET status = 'opted_out',
        retryable = FALSE,
        error = COALESCE(error, 'CRM lead opted out before provider start'),
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_send.id
      AND status = 'queued'
      AND attempt_started_at IS NULL
    RETURNING * INTO v_send;

    UPDATE newsletter_runs
    SET skipped_count = skipped_count + 1,
        last_heartbeat_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_run.id;

    RETURN v_send;
  END IF;

  IF EXISTS (
    SELECT 1 FROM newsletter_suppressions WHERE recipient_key = v_send.recipient_key
  ) THEN
    UPDATE newsletter_sends
    SET status = 'opted_out',
        retryable = FALSE,
        error = COALESCE(error, 'recipient suppressed before provider start'),
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_send.id
      AND status = 'queued'
      AND attempt_started_at IS NULL
    RETURNING * INTO v_send;

    UPDATE newsletter_runs
    SET skipped_count = skipped_count + 1,
        last_heartbeat_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_run.id;

    RETURN v_send;
  END IF;

  SELECT count(*)::INTEGER INTO v_day_attempt_count
  FROM newsletter_sends AS send
  JOIN newsletter_runs AS run ON run.id = send.run_id
  WHERE run.run_date = v_sgt_date
    AND send.is_test = FALSE
    AND send.attempt_started_at IS NOT NULL;
  IF v_day_attempt_count >= 5 OR v_run.attempted_count >= 5 THEN
    RAISE EXCEPTION 'SGT day has consumed all five provider submissions'
      USING ERRCODE = '54000';
  END IF;

  SELECT count(*)::INTEGER, COALESCE(max(attempt_no), 0) + 1
  INTO v_recipient_attempt_count, v_attempt_no
  FROM newsletter_sends
  WHERE issue_id = v_send.issue_id
    AND recipient_key = v_send.recipient_key
    AND is_test = FALSE
    AND attempt_started_at IS NOT NULL;
  IF v_recipient_attempt_count >= 3 OR v_attempt_no > 3 THEN
    RAISE EXCEPTION 'recipient has consumed all three provider submissions for this issue'
      USING ERRCODE = '54000';
  END IF;

  PERFORM set_config('app.newsletter_start_send_id', v_send.id::TEXT, TRUE);

  UPDATE newsletter_sends
  SET status = 'sending',
      slot_no = p_slot_no,
      attempt_no = v_attempt_no,
      attempt_started_at = clock_timestamp(),
      retryable = TRUE,
      updated_at = clock_timestamp()
  WHERE id = v_send.id
  RETURNING * INTO v_send;

  RETURN v_send;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_newsletter_attempt(
  p_send_id UUID,
  p_provider_outcome TEXT,
  p_provider_message_id TEXT,
  p_error TEXT,
  p_retryable BOOLEAN
)
RETURNS newsletter_sends
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identity newsletter_sends%ROWTYPE;
  v_send newsletter_sends%ROWTYPE;
  v_run newsletter_runs%ROWTYPE;
  v_locked_lead_id UUID;
  v_effective_retryable BOOLEAN;
BEGIN
  IF p_send_id IS NULL THEN
    RAISE EXCEPTION 'send id is required' USING ERRCODE = '22023';
  END IF;
  IF p_provider_outcome IS NULL OR p_provider_outcome NOT IN ('sent', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'provider outcome must be sent, failed, or unknown' USING ERRCODE = '22023';
  END IF;

  v_effective_retryable := CASE
    WHEN p_provider_outcome = 'unknown' THEN FALSE
    ELSE COALESCE(p_retryable, FALSE)
  END;

  SELECT * INTO v_identity
  FROM public.newsletter_sends
  WHERE id = p_send_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter attempt not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_identity.run_id IS NULL OR v_identity.recipient_key IS NULL THEN
    RAISE EXCEPTION 'newsletter attempt is missing lock identity' USING ERRCODE = '55000';
  END IF;

  -- Lock order: SGT day -> recipient -> run -> lead -> send.
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_recipient:' || v_identity.recipient_key));
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_run:' || v_identity.run_id::TEXT));

  SELECT * INTO v_run
  FROM newsletter_runs
  WHERE id = v_identity.run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter run not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_identity.lead_id IS NOT NULL THEN
    SELECT id INTO v_locked_lead_id
    FROM crm_leads
    WHERE id = v_identity.lead_id
    FOR UPDATE;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('newsletter_send:' || p_send_id::TEXT));

  SELECT * INTO v_send
  FROM newsletter_sends
  WHERE id = p_send_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter attempt not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_send.status <> 'sending' THEN
    IF v_send.status = p_provider_outcome
       AND v_send.provider_outcome = p_provider_outcome
       AND v_send.waha_message_id IS NOT DISTINCT FROM NULLIF(btrim(p_provider_message_id), '')
       AND v_send.error IS NOT DISTINCT FROM NULLIF(btrim(p_error), '')
       AND v_send.retryable IS NOT DISTINCT FROM v_effective_retryable THEN
      RETURN v_send;
    END IF;
    RAISE EXCEPTION 'conflicting finalization replay for attempt already finalized as %', v_send.status
      USING ERRCODE = '55000';
  END IF;
  IF v_send.run_id IS NULL THEN
    RAISE EXCEPTION 'newsletter attempt is not attached to a run' USING ERRCODE = '55000';
  END IF;
  IF p_provider_outcome = 'sent'
     AND (p_provider_message_id IS NULL OR btrim(p_provider_message_id) = '') THEN
    RAISE EXCEPTION 'provider message id is required for sent attempts' USING ERRCODE = '22023';
  END IF;

  UPDATE newsletter_sends
  SET status = p_provider_outcome,
      provider_outcome = p_provider_outcome,
      waha_message_id = NULLIF(btrim(p_provider_message_id), ''),
      error = NULLIF(btrim(p_error), ''),
      retryable = v_effective_retryable,
      sent_at = CASE WHEN p_provider_outcome = 'sent' THEN clock_timestamp() ELSE sent_at END,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_send.id
  RETURNING * INTO v_send;

  IF p_provider_outcome = 'sent' AND v_send.lead_id IS NOT NULL THEN
    UPDATE crm_leads
    SET status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
        last_activity_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_send.lead_id;

    INSERT INTO crm_lead_activities (lead_id, type, note, metadata, created_by)
    VALUES (
      v_send.lead_id,
      'status_change',
      'WhatsApp newsletter delivered',
      jsonb_build_object(
        'newsletter_send_id', v_send.id,
        'newsletter_run_id', v_send.run_id,
        'provider_message_id', v_send.waha_message_id
      ),
      'newsletter_runner'
    );
  END IF;

  UPDATE newsletter_runs
  SET sent_count = sent_count + CASE WHEN p_provider_outcome = 'sent' THEN 1 ELSE 0 END,
      failed_count = failed_count + CASE WHEN p_provider_outcome = 'failed' THEN 1 ELSE 0 END,
      unknown_count = unknown_count + CASE WHEN p_provider_outcome = 'unknown' THEN 1 ELSE 0 END,
      last_heartbeat_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_send.run_id;

  RETURN v_send;
END;
$$;

CREATE OR REPLACE FUNCTION record_accepted_newsletter_recovery(
  p_send_id UUID,
  p_provider_message_id TEXT,
  p_error TEXT
)
RETURNS newsletter_sends
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identity newsletter_sends%ROWTYPE;
  v_send newsletter_sends%ROWTYPE;
  v_run newsletter_runs%ROWTYPE;
  v_locked_lead_id UUID;
BEGIN
  IF p_send_id IS NULL THEN
    RAISE EXCEPTION 'send id is required' USING ERRCODE = '22023';
  END IF;
  IF p_provider_message_id IS NULL OR btrim(p_provider_message_id) = '' THEN
    RAISE EXCEPTION 'accepted provider message id is required' USING ERRCODE = '22023';
  END IF;
  IF p_error IS NULL OR btrim(p_error) = '' THEN
    RAISE EXCEPTION 'accepted recovery error is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_identity
  FROM public.newsletter_sends
  WHERE id = p_send_id;
  IF NOT FOUND OR v_identity.run_id IS NULL OR v_identity.recipient_key IS NULL THEN
    RAISE EXCEPTION 'newsletter attempt not found' USING ERRCODE = 'P0002';
  END IF;

  -- Lock order: SGT day -> recipient -> run -> lead -> send.
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_recipient:' || v_identity.recipient_key));
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_run:' || v_identity.run_id::TEXT));

  SELECT * INTO v_run
  FROM newsletter_runs
  WHERE id = v_identity.run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter run not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_identity.lead_id IS NOT NULL THEN
    SELECT id INTO v_locked_lead_id
    FROM crm_leads
    WHERE id = v_identity.lead_id
    FOR UPDATE;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('newsletter_send:' || p_send_id::TEXT));
  SELECT * INTO v_send
  FROM newsletter_sends
  WHERE id = p_send_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter attempt not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_send.status = 'unknown' THEN
    IF v_send.provider_outcome = 'sent'
       AND v_send.waha_message_id = btrim(p_provider_message_id)
       AND v_send.error = btrim(p_error)
       AND v_send.crm_sync_error = btrim(p_error)
       AND v_send.retryable = FALSE THEN
      RETURN v_send;
    END IF;
    RAISE EXCEPTION 'conflicting accepted recovery replay'
      USING ERRCODE = '55000';
  END IF;
  IF v_send.status <> 'sending' THEN
    RAISE EXCEPTION 'accepted recovery requires a sending attempt'
      USING ERRCODE = '55000';
  END IF;

  UPDATE newsletter_sends
  SET status = 'unknown',
      provider_outcome = 'sent',
      waha_message_id = btrim(p_provider_message_id),
      error = btrim(p_error),
      crm_sync_error = btrim(p_error),
      retryable = FALSE,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_send.id
  RETURNING * INTO v_send;

  UPDATE newsletter_runs
  SET status = 'failed',
      blocker = 'accepted send requires CRM finalization recovery',
      unknown_count = unknown_count + 1,
      last_heartbeat_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_send.run_id;

  RETURN v_send;
END;
$$;

CREATE OR REPLACE FUNCTION create_newsletter_test_send(
  p_issue_id UUID,
  p_lead_id UUID,
  p_override_phone TEXT,
  p_rendered_body TEXT,
  p_valuation_snapshot JSONB
)
RETURNS newsletter_sends
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_issue newsletter_issues%ROWTYPE;
  v_lead crm_leads%ROWTYPE;
  v_send newsletter_sends%ROWTYPE;
  v_source_digits TEXT;
  v_recipient_key TEXT;
  v_override_digits TEXT;
  v_override_phone TEXT;
BEGIN
  IF p_issue_id IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'issue id and lead id are required' USING ERRCODE = '22023';
  END IF;
  IF p_rendered_body IS NULL OR btrim(p_rendered_body) = '' THEN
    RAISE EXCEPTION 'rendered body is required' USING ERRCODE = '22023';
  END IF;
  IF p_valuation_snapshot IS NULL THEN
    RAISE EXCEPTION 'valuation snapshot is required' USING ERRCODE = '22023';
  END IF;

  v_override_digits := regexp_replace(COALESCE(p_override_phone, ''), '[^0-9]', '', 'g');
  v_override_phone := CASE
    WHEN length(v_override_digits) = 8 THEN '+65' || v_override_digits
    WHEN length(v_override_digits) = 10 AND left(v_override_digits, 2) = '65'
      THEN '+' || v_override_digits
    ELSE NULL
  END;
  IF v_override_phone IS NULL OR v_override_phone !~ '^\+65[689][0-9]{7}$' THEN
    RAISE EXCEPTION 'override phone must be canonical Singapore E.164'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_issue
  FROM newsletter_issues
  WHERE id = p_issue_id
    AND status IN ('approved', 'sending')
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter issue is not active' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_lead
  FROM crm_leads
  WHERE id = p_lead_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRM lead not found' USING ERRCODE = 'P0002';
  END IF;

  v_source_digits := regexp_replace(
    COALESCE(v_lead.phone_e164, v_lead.phone),
    '[^0-9]',
    '',
    'g'
  );
  v_recipient_key := CASE
    WHEN length(v_source_digits) = 8 THEN '+65' || v_source_digits
    WHEN length(v_source_digits) = 10 AND left(v_source_digits, 2) = '65'
      THEN '+' || v_source_digits
    ELSE NULL
  END;
  IF v_recipient_key IS NULL OR v_recipient_key !~ '^\+65[689][0-9]{7}$' THEN
    RAISE EXCEPTION 'lead does not have a canonical Singapore recipient key'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO newsletter_sends (
    issue_id,
    lead_id,
    recipient_name,
    recipient_key,
    phone,
    override_phone,
    rendered_body,
    valuation_snapshot,
    status,
    retryable,
    is_test
  )
  VALUES (
    v_issue.id,
    v_lead.id,
    v_lead.name,
    v_recipient_key,
    v_recipient_key,
    v_override_phone,
    p_rendered_body,
    p_valuation_snapshot,
    'test',
    FALSE,
    TRUE
  )
  RETURNING * INTO v_send;

  RETURN v_send;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_newsletter_test_send(
  p_send_id UUID,
  p_provider_outcome TEXT,
  p_provider_message_id TEXT,
  p_error TEXT,
  p_retryable BOOLEAN
)
RETURNS newsletter_sends
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_send newsletter_sends%ROWTYPE;
  v_effective_retryable BOOLEAN;
BEGIN
  IF p_send_id IS NULL THEN
    RAISE EXCEPTION 'send id is required' USING ERRCODE = '22023';
  END IF;
  IF p_provider_outcome IS NULL OR p_provider_outcome NOT IN ('sent', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'provider outcome must be sent, failed, or unknown' USING ERRCODE = '22023';
  END IF;
  IF p_provider_outcome = 'sent'
     AND (p_provider_message_id IS NULL OR btrim(p_provider_message_id) = '') THEN
    RAISE EXCEPTION 'provider message id is required for sent test sends'
      USING ERRCODE = '22023';
  END IF;

  v_effective_retryable := CASE
    WHEN p_provider_outcome = 'unknown' THEN FALSE
    ELSE COALESCE(p_retryable, FALSE)
  END;

  PERFORM pg_advisory_xact_lock(hashtext('newsletter_test_send:' || p_send_id::TEXT));
  SELECT * INTO v_send
  FROM newsletter_sends
  WHERE id = p_send_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter test send not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_send.is_test <> TRUE OR v_send.status <> 'test' THEN
    RAISE EXCEPTION 'test-send finalization requires a test ledger row'
      USING ERRCODE = '55000';
  END IF;

  IF v_send.completed_at IS NOT NULL THEN
    IF v_send.provider_outcome = p_provider_outcome
       AND v_send.waha_message_id IS NOT DISTINCT FROM NULLIF(btrim(p_provider_message_id), '')
       AND v_send.error IS NOT DISTINCT FROM NULLIF(btrim(p_error), '')
       AND v_send.retryable IS NOT DISTINCT FROM v_effective_retryable THEN
      RETURN v_send;
    END IF;
    RAISE EXCEPTION 'conflicting finalization replay for test send'
      USING ERRCODE = '55000';
  END IF;

  UPDATE newsletter_sends
  SET provider_outcome = p_provider_outcome,
      waha_message_id = NULLIF(btrim(p_provider_message_id), ''),
      error = NULLIF(btrim(p_error), ''),
      retryable = v_effective_retryable,
      sent_at = CASE WHEN p_provider_outcome = 'sent' THEN clock_timestamp() ELSE sent_at END,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_send.id
  RETURNING * INTO v_send;

  RETURN v_send;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_newsletter_operator_report(
  p_report_id UUID,
  p_provider_outcome TEXT,
  p_provider_message_id TEXT,
  p_error TEXT
)
RETURNS newsletter_operator_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identity newsletter_operator_reports%ROWTYPE;
  v_report newsletter_operator_reports%ROWTYPE;
  v_run newsletter_runs%ROWTYPE;
  v_status TEXT;
  v_message_id TEXT := NULLIF(btrim(p_provider_message_id), '');
  v_error TEXT := NULLIF(btrim(p_error), '');
  v_report_error TEXT;
BEGIN
  IF p_report_id IS NULL THEN
    RAISE EXCEPTION 'operator report id is required' USING ERRCODE = '22023';
  END IF;
  IF p_provider_outcome IS NULL OR p_provider_outcome NOT IN ('sent', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'operator report outcome must be sent, failed, or unknown'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_outcome = 'sent' AND v_message_id IS NULL THEN
    RAISE EXCEPTION 'provider message id is required for sent operator reports'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_outcome <> 'sent' AND v_error IS NULL THEN
    RAISE EXCEPTION 'operator report error is required for failed or unknown outcomes'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_identity
  FROM newsletter_operator_reports
  WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operator report not found' USING ERRCODE = 'P0002';
  END IF;

  -- Lock order: run -> operator report.
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_run:' || v_identity.run_id::TEXT));
  SELECT * INTO v_run
  FROM newsletter_runs
  WHERE id = v_identity.run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter run not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('newsletter_operator_report:' || p_report_id::TEXT));
  SELECT * INTO v_report
  FROM newsletter_operator_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND OR v_report.run_id IS DISTINCT FROM v_run.id THEN
    RAISE EXCEPTION 'operator report identity changed while finalizing'
      USING ERRCODE = '40001';
  END IF;

  v_status := p_provider_outcome;
  v_report_error := CASE
    WHEN p_provider_outcome = 'unknown' THEN 'operator report outcome unknown: ' || v_error
    WHEN p_provider_outcome = 'failed' THEN 'operator report failed: ' || v_error
    ELSE NULL
  END;

  IF v_report.status IN ('sent', 'failed', 'unknown') THEN
    IF v_report.status = v_status
       AND v_report.provider_message_id IS NOT DISTINCT FROM v_message_id
       AND v_report.error IS NOT DISTINCT FROM v_error
       AND v_report.completed_at IS NOT NULL
       AND (
         p_provider_outcome = 'sent'
         OR NULLIF(btrim(v_run.report_error), '') IS NOT NULL
       ) THEN
      RETURN v_report;
    END IF;
    RAISE EXCEPTION 'conflicting operator report finalization replay'
      USING ERRCODE = '55000';
  END IF;

  IF v_report.status <> 'sending' OR v_report.attempt_started_at IS NULL THEN
    RAISE EXCEPTION 'operator report is not in a started sending state'
      USING ERRCODE = '55000';
  END IF;

  UPDATE newsletter_operator_reports
  SET status = v_status,
      provider_message_id = v_message_id,
      error = v_error,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_report.id
  RETURNING * INTO v_report;

  IF p_provider_outcome <> 'sent' THEN
    UPDATE newsletter_runs
    SET report_error = v_report_error,
        updated_at = clock_timestamp()
    WHERE id = v_run.id;
  END IF;

  RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION recover_stale_newsletter_operator_reports(
  p_run_id UUID,
  p_before TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run newsletter_runs%ROWTYPE;
  v_recovered_count INTEGER;
BEGIN
  IF p_run_id IS NULL OR p_before IS NULL THEN
    RAISE EXCEPTION 'run id and stale cutoff are required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('newsletter_run:' || p_run_id::TEXT));
  SELECT * INTO v_run
  FROM newsletter_runs
  WHERE id = p_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter run not found' USING ERRCODE = 'P0002';
  END IF;

  WITH recovered AS (
    UPDATE newsletter_operator_reports
    SET status = 'unknown',
        error = COALESCE(error, 'runner restarted before report outcome was finalized'),
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE run_id = p_run_id
      AND status = 'sending'
      AND attempt_started_at IS NOT NULL
      AND attempt_started_at < p_before
    RETURNING id
  )
  SELECT count(*)::INTEGER INTO v_recovered_count FROM recovered;

  IF v_recovered_count > 0 THEN
    UPDATE newsletter_runs
    SET report_error = 'stale operator report outcome unknown',
        last_heartbeat_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = p_run_id;
  END IF;

  RETURN v_recovered_count;
END;
$$;

CREATE OR REPLACE FUNCTION record_newsletter_opt_out(
  p_recipient TEXT,
  p_message_id TEXT,
  p_reason TEXT
)
RETURNS newsletter_suppressions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits TEXT;
  v_recipient_key TEXT;
  v_message_id TEXT;
  v_claimed_message_id TEXT;
  v_suppression newsletter_suppressions%ROWTYPE;
BEGIN
  IF p_recipient IS NULL OR btrim(p_recipient) = '' THEN
    RAISE EXCEPTION 'recipient is required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'opt-out reason is required' USING ERRCODE = '22023';
  END IF;

  v_message_id := NULLIF(btrim(p_message_id), '');
  IF v_message_id IS NULL THEN
    RAISE EXCEPTION 'provider message id is required for STOP deduplication'
      USING ERRCODE = '22023';
  END IF;

  v_digits := regexp_replace(p_recipient, '[^0-9]', '', 'g');
  v_recipient_key := CASE
    WHEN length(v_digits) = 8 THEN '+65' || v_digits
    WHEN length(v_digits) BETWEEN 8 AND 15 THEN '+' || v_digits
    ELSE NULL
  END;

  IF v_recipient_key IS NULL OR v_recipient_key !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'recipient must normalize to E.164' USING ERRCODE = '22023';
  END IF;

  -- Lock order: SGT day -> recipient -> run -> lead -> send.
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_recipient:' || v_recipient_key));

  INSERT INTO newsletter_suppression_events (
    recipient_key,
    provider_message_id,
    reason
  )
  VALUES (
    v_recipient_key,
    v_message_id,
    btrim(p_reason)
  )
  ON CONFLICT (recipient_key, provider_message_id) DO NOTHING
  RETURNING provider_message_id INTO v_claimed_message_id;

  IF v_claimed_message_id IS NULL THEN
    SELECT * INTO v_suppression
    FROM newsletter_suppressions
    WHERE recipient_key = v_recipient_key;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'suppression event exists without suppression state'
        USING ERRCODE = '55000';
    END IF;

    RETURN v_suppression;
  END IF;

  SELECT * INTO v_suppression
  FROM newsletter_suppressions
  WHERE recipient_key = v_recipient_key
  FOR UPDATE;

  IF FOUND THEN
    UPDATE newsletter_suppressions
    SET last_message_id = v_message_id,
        last_seen_at = clock_timestamp()
    WHERE recipient_key = v_recipient_key
    RETURNING * INTO v_suppression;

    RETURN v_suppression;
  END IF;

  INSERT INTO newsletter_suppressions (
    recipient_key,
    reason,
    first_message_id,
    last_message_id
  )
  VALUES (
    v_recipient_key,
    btrim(p_reason),
    v_message_id,
    v_message_id
  )
  RETURNING * INTO v_suppression;

  PERFORM run.id
  FROM newsletter_runs AS run
  JOIN (
    SELECT DISTINCT send.run_id
    FROM newsletter_sends AS send
    WHERE send.recipient_key = v_recipient_key
      AND send.status = 'queued'
      AND send.run_id IS NOT NULL
  ) AS queued_run ON queued_run.run_id = run.id
  ORDER BY run.id
  FOR UPDATE OF run;

  PERFORM lead.id
  FROM crm_leads AS lead
  WHERE lead.phone_e164 = v_recipient_key
     OR (
       lead.phone_e164 IS NULL
       AND CASE
         WHEN length(regexp_replace(lead.phone, '[^0-9]', '', 'g')) = 8
           THEN '+65' || regexp_replace(lead.phone, '[^0-9]', '', 'g')
         WHEN length(regexp_replace(lead.phone, '[^0-9]', '', 'g')) BETWEEN 8 AND 15
           THEN '+' || regexp_replace(lead.phone, '[^0-9]', '', 'g')
         ELSE NULL
       END = v_recipient_key
     )
  ORDER BY lead.id
  FOR UPDATE;

  PERFORM send.id
  FROM newsletter_sends AS send
  WHERE send.recipient_key = v_recipient_key
    AND send.status = 'queued'
  ORDER BY send.id
  FOR UPDATE;

  UPDATE crm_leads
  SET phone_e164 = COALESCE(phone_e164, v_recipient_key),
      opt_out_at = COALESCE(opt_out_at, clock_timestamp()),
      opt_out_reason = COALESCE(opt_out_reason, btrim(p_reason)),
      last_activity_at = GREATEST(last_activity_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE phone_e164 = v_recipient_key
     OR (
       phone_e164 IS NULL
       AND CASE
         WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 8
           THEN '+65' || regexp_replace(phone, '[^0-9]', '', 'g')
         WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 8 AND 15
           THEN '+' || regexp_replace(phone, '[^0-9]', '', 'g')
         ELSE NULL
       END = v_recipient_key
     );

  WITH cancelled AS (
    UPDATE newsletter_sends
    SET status = 'opted_out',
        error = COALESCE(error, 'recipient opted out before send'),
        retryable = FALSE,
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE recipient_key = v_recipient_key
      AND status = 'queued'
    RETURNING run_id
  ), cancelled_by_run AS (
    SELECT run_id, count(*)::INTEGER AS cancelled_count
    FROM cancelled
    WHERE run_id IS NOT NULL
    GROUP BY run_id
  )
  UPDATE newsletter_runs AS run
  SET skipped_count = run.skipped_count + cancelled_by_run.cancelled_count,
      updated_at = clock_timestamp(),
      last_heartbeat_at = clock_timestamp()
  FROM cancelled_by_run
  WHERE run.id = cancelled_by_run.run_id;

  RETURN v_suppression;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_newsletter_unknown(
  p_send_id UUID,
  p_resolver TEXT,
  p_resolution TEXT,
  p_reason TEXT
)
RETURNS newsletter_sends
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identity newsletter_sends%ROWTYPE;
  v_send newsletter_sends%ROWTYPE;
  v_run newsletter_runs%ROWTYPE;
  v_locked_lead_id UUID;
  v_clears_recovery_blocker BOOLEAN;
BEGIN
  IF p_send_id IS NULL THEN
    RAISE EXCEPTION 'send id is required' USING ERRCODE = '22023';
  END IF;
  IF p_resolver IS NULL OR btrim(p_resolver) = '' THEN
    RAISE EXCEPTION 'resolver is required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'resolution reason is required' USING ERRCODE = '22023';
  END IF;
  IF p_resolution IS NULL OR p_resolution NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'resolution must be sent or failed' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_identity
  FROM public.newsletter_sends
  WHERE id = p_send_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter attempt not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_identity.run_id IS NULL OR v_identity.recipient_key IS NULL THEN
    RAISE EXCEPTION 'newsletter attempt is missing lock identity' USING ERRCODE = '55000';
  END IF;

  -- Lock order: SGT day -> recipient -> run -> lead -> send.
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_recipient:' || v_identity.recipient_key));
  PERFORM pg_advisory_xact_lock(hashtext('newsletter_run:' || v_identity.run_id::TEXT));

  SELECT * INTO v_run
  FROM newsletter_runs
  WHERE id = v_identity.run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter run not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_identity.lead_id IS NOT NULL THEN
    SELECT id INTO v_locked_lead_id
    FROM crm_leads
    WHERE id = v_identity.lead_id
    FOR UPDATE;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('newsletter_send:' || p_send_id::TEXT));

  SELECT * INTO v_send
  FROM newsletter_sends
  WHERE id = p_send_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter attempt not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_send.status <> 'unknown' THEN
    IF v_send.unknown_resolution = p_resolution
       AND v_send.unknown_resolved_by = btrim(p_resolver)
       AND v_send.unknown_resolution_reason = btrim(p_reason) THEN
      RETURN v_send;
    END IF;
    RAISE EXCEPTION 'newsletter attempt is not unresolved unknown'
      USING ERRCODE = '55000';
  END IF;
  IF v_send.run_id IS NULL THEN
    RAISE EXCEPTION 'newsletter attempt is not attached to a run' USING ERRCODE = '55000';
  END IF;

  v_clears_recovery_blocker := v_send.provider_outcome = 'sent'
    AND v_run.status = 'failed'
    AND v_run.blocker = 'accepted send requires CRM finalization recovery'
    AND v_run.unknown_count = 1;

  UPDATE newsletter_sends
  SET status = p_resolution,
      retryable = FALSE,
      sent_at = CASE WHEN p_resolution = 'sent' THEN clock_timestamp() ELSE sent_at END,
      completed_at = clock_timestamp(),
      unknown_resolved_at = clock_timestamp(),
      unknown_resolved_by = btrim(p_resolver),
      unknown_resolution = p_resolution,
      unknown_resolution_reason = btrim(p_reason),
      updated_at = clock_timestamp()
  WHERE id = v_send.id
  RETURNING * INTO v_send;

  IF p_resolution = 'sent' AND v_send.lead_id IS NOT NULL THEN
    UPDATE crm_leads
    SET status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
        last_activity_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_send.lead_id;

    INSERT INTO crm_lead_activities (lead_id, type, note, metadata, created_by)
    VALUES (
      v_send.lead_id,
      'status_change',
      'WhatsApp newsletter delivery confirmed after unknown outcome',
      jsonb_build_object(
        'newsletter_send_id', v_send.id,
        'newsletter_run_id', v_send.run_id,
        'resolver', btrim(p_resolver),
        'resolution_reason', btrim(p_reason)
      ),
      'newsletter_runner'
    );
  END IF;

  UPDATE newsletter_runs
  SET status = CASE
        WHEN v_clears_recovery_blocker AND unknown_count = 1 THEN
          CASE WHEN attempted_count < 5 THEN 'running' ELSE 'completed' END
        ELSE status
      END,
      blocker = CASE
        WHEN v_clears_recovery_blocker AND unknown_count = 1 THEN NULL
        ELSE blocker
      END,
      completed_at = CASE
        WHEN v_clears_recovery_blocker AND unknown_count = 1 AND attempted_count >= 5
          THEN clock_timestamp()
        WHEN v_clears_recovery_blocker AND unknown_count = 1 THEN NULL
        ELSE completed_at
      END,
      unknown_count = unknown_count - 1,
      sent_count = sent_count + CASE WHEN p_resolution = 'sent' THEN 1 ELSE 0 END,
      failed_count = failed_count + CASE WHEN p_resolution = 'failed' THEN 1 ELSE 0 END,
      last_heartbeat_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_send.run_id
    AND unknown_count > 0;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'newsletter run has no unknown counter to resolve'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_send;
END;
$$;

REVOKE ALL ON FUNCTION enforce_newsletter_attempt_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_newsletter_attempt_submission() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_newsletter_suppression_event_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_newsletter_run(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION queue_newsletter_attempt(UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION start_newsletter_attempt(UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_newsletter_attempt(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_accepted_newsletter_recovery(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_newsletter_test_send(UUID, UUID, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finalize_newsletter_test_send(UUID, TEXT, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finalize_newsletter_operator_report(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION recover_stale_newsletter_operator_reports(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_newsletter_opt_out(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_newsletter_unknown(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION claim_newsletter_run(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION queue_newsletter_attempt(UUID, UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION start_newsletter_attempt(UUID, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_newsletter_attempt(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION record_accepted_newsletter_recovery(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION create_newsletter_test_send(UUID, UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_newsletter_test_send(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_newsletter_operator_report(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION recover_stale_newsletter_operator_reports(UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION record_newsletter_opt_out(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION resolve_newsletter_unknown(UUID, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON TABLE newsletter_sends FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE newsletter_sends TO service_role;
REVOKE ALL ON TABLE newsletter_suppression_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE newsletter_suppression_events TO service_role;

COMMENT ON TABLE newsletter_runs IS 'One globally unique Singapore-calendar-day WhatsApp newsletter run.';
COMMENT ON TABLE newsletter_suppressions IS 'Global recipient suppression ledger; independent of CRM lead matching.';
COMMENT ON TABLE newsletter_suppression_events IS 'Append-only STOP webhook event ledger used for replay deduplication.';
COMMENT ON TABLE newsletter_operator_reports IS 'Operator delivery ledger, separate from the five lead-message slots.';
COMMENT ON TABLE newsletter_sends IS 'Append-only WhatsApp newsletter attempt ledger with immutable send-time snapshots.';
