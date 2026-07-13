\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF to_regclass('public.newsletter_runs') IS NULL THEN
    v_missing := array_append(v_missing, 'newsletter_runs');
  END IF;
  IF to_regclass('public.newsletter_suppressions') IS NULL THEN
    v_missing := array_append(v_missing, 'newsletter_suppressions');
  END IF;
  IF to_regclass('public.newsletter_operator_reports') IS NULL THEN
    v_missing := array_append(v_missing, 'newsletter_operator_reports');
  END IF;
  IF to_regprocedure('public.claim_newsletter_run(text)') IS NULL THEN
    v_missing := array_append(v_missing, 'claim_newsletter_run(text)');
  END IF;
  IF to_regprocedure('public.start_newsletter_attempt(uuid,uuid,integer,text)') IS NULL THEN
    v_missing := array_append(v_missing, 'start_newsletter_attempt(uuid,uuid,integer,text)');
  END IF;
  IF to_regprocedure('public.finalize_newsletter_attempt(uuid,text,text,text,boolean)') IS NULL THEN
    v_missing := array_append(v_missing, 'finalize_newsletter_attempt(uuid,text,text,text,boolean)');
  END IF;
  IF to_regprocedure('public.record_newsletter_opt_out(text,text,text)') IS NULL THEN
    v_missing := array_append(v_missing, 'record_newsletter_opt_out(text,text,text)');
  END IF;
  IF to_regprocedure('public.resolve_newsletter_unknown(uuid,text,text,text)') IS NULL THEN
    v_missing := array_append(v_missing, 'resolve_newsletter_unknown(uuid,text,text,text)');
  END IF;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'missing newsletter schema objects: %', array_to_string(v_missing, ', ');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'newsletter_runs'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (run_date)'
  ) THEN
    RAISE EXCEPTION 'newsletter_runs.run_date unique constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'newsletter_sends'::regclass
      AND conname = 'newsletter_sends_lead_id_fkey'
      AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'newsletter_sends lead FK is not ON DELETE SET NULL';
  END IF;

  IF to_regclass('public.uniq_newsletter_attempt_number') IS NULL
     OR to_regclass('public.uniq_newsletter_active_recipient') IS NULL
     OR to_regclass('public.uniq_newsletter_run_slot') IS NULL THEN
    RAISE EXCEPTION 'one or more newsletter attempt indexes are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'newsletter_sends'::regclass
      AND tgname = 'trg_newsletter_attempt_append_only'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'append-only newsletter attempt trigger is missing';
  END IF;
END;
$$;

CREATE TEMP TABLE newsletter_assertion_fixture (
  project_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  second_lead_id UUID NOT NULL,
  issue_id UUID NOT NULL,
  run_id UUID NOT NULL,
  stop_run_id UUID NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_project_id UUID;
  v_lead_id UUID;
  v_second_lead_id UUID;
  v_issue_id UUID;
  v_run_id UUID;
  v_stop_run_id UUID;
BEGIN
  INSERT INTO crm_projects (slug, title, source)
  VALUES ('newsletter-assertion-' || txid_current(), 'Newsletter assertion fixture', 'test')
  RETURNING id INTO v_project_id;

  INSERT INTO crm_leads (
    project_id,
    name,
    phone,
    phone_e164,
    email,
    message,
    property_title,
    source_path,
    status
  )
  VALUES (
    v_project_id,
    'Newsletter Finalize Fixture',
    '91234567',
    '+6591234567',
    'newsletter-finalize@example.invalid',
    'schema assertion',
    'Schema Assertion',
    '/schema-assertion',
    'new'
  )
  RETURNING id INTO v_lead_id;

  INSERT INTO crm_leads (
    project_id,
    name,
    phone,
    phone_e164,
    email,
    message,
    property_title,
    source_path,
    status
  )
  VALUES (
    v_project_id,
    'Newsletter STOP Fixture',
    '92345678',
    '+6592345678',
    'newsletter-stop@example.invalid',
    'schema assertion',
    'Schema Assertion',
    '/schema-assertion',
    'new'
  )
  RETURNING id INTO v_second_lead_id;

  INSERT INTO newsletter_issues (slug, status, created_by)
  VALUES ('newsletter-assertion-' || txid_current(), 'approved', 'schema_assertion')
  RETURNING id INTO v_issue_id;

  INSERT INTO newsletter_runs (run_date, issue_id, status, claim_token, started_at)
  VALUES (DATE '2099-01-01', v_issue_id, 'running', 'schema-assertion-primary', now())
  RETURNING id INTO v_run_id;

  INSERT INTO newsletter_runs (run_date, issue_id, status, claim_token, started_at)
  VALUES (DATE '2099-01-02', v_issue_id, 'running', 'schema-assertion-stop', now())
  RETURNING id INTO v_stop_run_id;

  INSERT INTO newsletter_assertion_fixture
  VALUES (v_project_id, v_lead_id, v_second_lead_id, v_issue_id, v_run_id, v_stop_run_id);
END;
$$;

DO $$
DECLARE
  v_issue_id UUID;
  v_run_id UUID;
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT issue_id, run_id INTO v_issue_id, v_run_id
  FROM newsletter_assertion_fixture;

  BEGIN
    INSERT INTO newsletter_sends (
      issue_id,
      run_id,
      slot_no,
      recipient_key,
      attempt_no,
      phone,
      rendered_body,
      status,
      is_test
    )
    VALUES (
      v_issue_id,
      v_run_id,
      6,
      '+6599999999',
      1,
      '+6599999999',
      'must not be inserted',
      'queued',
      FALSE
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := TRUE;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'sixth newsletter slot was accepted';
  END IF;
END;
$$;

DO $$
DECLARE
  v_issue_id UUID;
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT issue_id INTO v_issue_id FROM newsletter_assertion_fixture;

  BEGIN
    INSERT INTO newsletter_runs (run_date, issue_id, status, claim_token)
    VALUES (DATE '2099-01-01', v_issue_id, 'running', 'duplicate-date');
  EXCEPTION WHEN unique_violation THEN
    v_rejected := TRUE;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'second run for the same SGT date was accepted';
  END IF;
END;
$$;

DO $$
DECLARE
  v_lead_id UUID;
  v_run_id UUID;
  v_send newsletter_sends%ROWTYPE;
BEGIN
  SELECT lead_id, run_id INTO v_lead_id, v_run_id
  FROM newsletter_assertion_fixture;

  v_send := start_newsletter_attempt(v_run_id, v_lead_id, 1, 'Atomic CRM assertion body');
  v_send := finalize_newsletter_attempt(v_send.id, 'sent', 'assertion-provider-id', NULL, FALSE);

  IF NOT EXISTS (
    SELECT 1
    FROM crm_leads
    WHERE id = v_lead_id
      AND status = 'contacted'
      AND last_activity_at >= v_send.attempt_started_at
  ) THEN
    RAISE EXCEPTION 'sent finalization did not atomically update the CRM lead';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm_lead_activities
    WHERE lead_id = v_lead_id
      AND metadata ->> 'newsletter_send_id' = v_send.id::TEXT
  ) THEN
    RAISE EXCEPTION 'sent finalization did not insert a CRM activity';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM newsletter_runs
    WHERE id = v_run_id
      AND attempted_count = 1
      AND sent_count = 1
  ) THEN
    RAISE EXCEPTION 'sent finalization did not update run counters';
  END IF;
END;
$$;

DO $$
DECLARE
  v_issue_id UUID;
  v_lead_id UUID;
  v_run_id UUID;
  v_skipped_count INTEGER;
BEGIN
  SELECT issue_id, second_lead_id, stop_run_id
  INTO v_issue_id, v_lead_id, v_run_id
  FROM newsletter_assertion_fixture;

  INSERT INTO newsletter_sends (
    issue_id,
    run_id,
    slot_no,
    lead_id,
    recipient_name,
    recipient_key,
    attempt_no,
    phone,
    rendered_body,
    status,
    is_test
  )
  VALUES (
    v_issue_id,
    v_run_id,
    1,
    v_lead_id,
    'Newsletter STOP Fixture',
    '+6592345678',
    1,
    '+6592345678',
    'queued STOP assertion body',
    'queued',
    FALSE
  );

  PERFORM record_newsletter_opt_out('+65 9234 5678', 'stop-message-1', 'STOP');
  PERFORM record_newsletter_opt_out('+65 9234 5678', 'stop-message-1', 'STOP');

  IF (SELECT count(*) FROM newsletter_suppressions WHERE recipient_key = '+6592345678') <> 1 THEN
    RAISE EXCEPTION 'repeated STOP created duplicate suppressions';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm_leads
    WHERE id = v_lead_id
      AND opt_out_at IS NOT NULL
      AND opt_out_reason = 'STOP'
  ) THEN
    RAISE EXCEPTION 'STOP did not update the matching CRM lead';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM newsletter_sends
    WHERE recipient_key = '+6592345678'
      AND status = 'queued'
  ) THEN
    RAISE EXCEPTION 'STOP did not cancel queued attempts';
  END IF;

  SELECT skipped_count INTO v_skipped_count
  FROM newsletter_runs
  WHERE id = v_run_id;

  IF v_skipped_count <> 1 THEN
    RAISE EXCEPTION 'repeated STOP changed skipped_count more than once: %', v_skipped_count;
  END IF;
END;
$$;

ROLLBACK;
