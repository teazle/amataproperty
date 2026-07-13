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
  IF to_regclass('public.newsletter_suppression_events') IS NULL THEN
    v_missing := array_append(v_missing, 'newsletter_suppression_events');
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

-- ASSERT: service-role grants and fixed search paths
DO $$
DECLARE
  v_function_count INTEGER;
BEGIN
  SELECT count(*)::INTEGER INTO v_function_count
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = ANY (ARRAY[
      'claim_newsletter_run',
      'start_newsletter_attempt',
      'finalize_newsletter_attempt',
      'record_newsletter_opt_out',
      'resolve_newsletter_unknown'
    ])
    AND proc.prosecdef = TRUE
    AND proc.proconfig @> ARRAY['search_path=public']
    AND has_function_privilege('service_role', proc.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    );

  IF v_function_count <> 5 THEN
    RAISE EXCEPTION 'RPC security contract matched % of 5 functions', v_function_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'enforce_newsletter_suppression_event_append_only'
      AND proc.prosecdef = TRUE
      AND proc.proconfig @> ARRAY['search_path=public']
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'suppression event trigger function security contract is missing';
  END IF;

  -- ASSERT: suppression event least privilege
  IF NOT has_table_privilege('service_role', 'newsletter_suppression_events', 'SELECT')
     OR has_table_privilege('service_role', 'newsletter_suppression_events', 'INSERT')
     OR has_table_privilege('service_role', 'newsletter_suppression_events', 'UPDATE')
     OR has_table_privilege('service_role', 'newsletter_suppression_events', 'DELETE')
     OR has_table_privilege('service_role', 'newsletter_suppression_events', 'TRUNCATE')
     OR has_table_privilege('service_role', 'newsletter_suppression_events', 'REFERENCES')
     OR has_table_privilege('service_role', 'newsletter_suppression_events', 'TRIGGER')
     OR has_table_privilege('anon', 'newsletter_suppression_events', 'SELECT')
     OR has_table_privilege('anon', 'newsletter_suppression_events', 'INSERT')
     OR has_table_privilege('anon', 'newsletter_suppression_events', 'UPDATE')
     OR has_table_privilege('anon', 'newsletter_suppression_events', 'DELETE')
     OR has_table_privilege('anon', 'newsletter_suppression_events', 'TRUNCATE')
     OR has_table_privilege('anon', 'newsletter_suppression_events', 'REFERENCES')
     OR has_table_privilege('anon', 'newsletter_suppression_events', 'TRIGGER')
     OR has_table_privilege('authenticated', 'newsletter_suppression_events', 'SELECT')
     OR has_table_privilege('authenticated', 'newsletter_suppression_events', 'INSERT')
     OR has_table_privilege('authenticated', 'newsletter_suppression_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'newsletter_suppression_events', 'DELETE')
     OR has_table_privilege('authenticated', 'newsletter_suppression_events', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'newsletter_suppression_events', 'REFERENCES')
     OR has_table_privilege('authenticated', 'newsletter_suppression_events', 'TRIGGER')
     OR EXISTS (
       SELECT 1
       FROM pg_class AS relation
       CROSS JOIN LATERAL aclexplode(
         COALESCE(relation.relacl, acldefault('r', relation.relowner))
       ) AS acl
       WHERE relation.oid = 'newsletter_suppression_events'::regclass
         AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'suppression event table privileges are not service-role read-only';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    JOIN pg_class AS relation ON relation.oid = 'newsletter_suppression_events'::regclass
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'record_newsletter_opt_out'
      AND proc.prosecdef = TRUE
      AND proc.proowner = relation.relowner
  ) THEN
    RAISE EXCEPTION 'STOP RPC is not owner-executed for suppression event insertion';
  END IF;

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
     OR to_regclass('public.uniq_newsletter_run_slot') IS NULL
     OR to_regclass('public.uniq_newsletter_operator_summary') IS NULL THEN
    RAISE EXCEPTION 'one or more newsletter uniqueness indexes are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'newsletter_sends'::regclass
      AND tgname = 'trg_newsletter_attempt_append_only'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'newsletter_sends'::regclass
      AND tgname = 'trg_newsletter_attempt_submission'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'newsletter ledger guards are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'newsletter_suppression_events'::regclass
      AND tgname = 'trg_newsletter_suppression_event_append_only'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'suppression event append-only guard is missing';
  END IF;
END;
$$;

CREATE TEMP TABLE newsletter_assertion_fixture (
  project_id UUID NOT NULL,
  issue_id UUID NOT NULL,
  run_id UUID NOT NULL,
  stale_run_id UUID NOT NULL,
  stop_run_id UUID NOT NULL,
  lead_ids UUID[] NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_sgt_date DATE := (clock_timestamp() AT TIME ZONE 'Asia/Singapore')::DATE;
  v_project_id UUID;
  v_issue_id UUID;
  v_run newsletter_runs%ROWTYPE;
  v_stale_run_id UUID;
  v_stop_run_id UUID;
  v_lead_ids UUID[] := ARRAY[]::UUID[];
  v_lead_id UUID;
  v_i INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM newsletter_runs
    WHERE run_date BETWEEN v_sgt_date - 1 AND v_sgt_date + 1
  ) THEN
    RAISE EXCEPTION 'newsletter schema assertions require a scratch database without adjacent-day runs';
  END IF;

  INSERT INTO crm_projects (slug, title, source)
  VALUES ('newsletter-assertion-' || txid_current(), 'Newsletter assertion fixture', 'test')
  RETURNING id INTO v_project_id;

  FOR v_i IN 1..8 LOOP
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
      'Newsletter Fixture ' || v_i,
      '91' || lpad(v_i::TEXT, 6, '0'),
      '+6591' || lpad(v_i::TEXT, 6, '0'),
      'newsletter-' || v_i || '@example.invalid',
      'schema assertion',
      'Schema Assertion',
      '/schema-assertion',
      'new'
    )
    RETURNING id INTO v_lead_id;

    v_lead_ids := array_append(v_lead_ids, v_lead_id);
  END LOOP;

  INSERT INTO newsletter_issues (slug, status, created_by, approved_by, approved_at)
  VALUES (
    'newsletter-assertion-' || txid_current(),
    'approved',
    'schema_assertion',
    'schema_assertion',
    clock_timestamp()
  )
  RETURNING id INTO v_issue_id;

  v_run := claim_newsletter_run('schema-assertion-current');
  IF v_run.run_date <> v_sgt_date OR v_run.issue_id <> v_issue_id OR v_run.status <> 'running' THEN
    RAISE EXCEPTION 'claim_newsletter_run did not create the current SGT run';
  END IF;

  INSERT INTO newsletter_runs (run_date, issue_id, status, claim_token, started_at)
  VALUES (v_sgt_date - 1, v_issue_id, 'running', 'schema-assertion-stale', clock_timestamp())
  RETURNING id INTO v_stale_run_id;

  INSERT INTO newsletter_runs (run_date, issue_id, status, claim_token, started_at)
  VALUES (v_sgt_date + 1, v_issue_id, 'running', 'schema-assertion-stop', clock_timestamp())
  RETURNING id INTO v_stop_run_id;

  INSERT INTO newsletter_assertion_fixture
  VALUES (v_project_id, v_issue_id, v_run.id, v_stale_run_id, v_stop_run_id, v_lead_ids);
END;
$$;

-- ASSERT: stale-run rejection and resume safety
DO $$
DECLARE
  v_issue_id UUID;
  v_run_id UUID;
  v_stale_run_id UUID;
  v_lead_ids UUID[];
  v_resumed newsletter_runs%ROWTYPE;
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT issue_id, run_id, stale_run_id, lead_ids
  INTO v_issue_id, v_run_id, v_stale_run_id, v_lead_ids
  FROM newsletter_assertion_fixture;

  BEGIN
    PERFORM start_newsletter_attempt(v_stale_run_id, v_lead_ids[4], 1, 'stale run must fail');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'stale running run authorized a provider submission';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO newsletter_sends (
      issue_id, run_id, slot_no, lead_id, recipient_name, recipient_key,
      attempt_no, phone, rendered_body, status, attempt_started_at, is_test
    ) VALUES (
      v_issue_id, v_stale_run_id, 1, v_lead_ids[4], 'Stale bypass fixture', '+6591000004',
      1, '+6591000004', 'direct stale provider submission', 'sending', clock_timestamp(), FALSE
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'stale running run bypassed the submission trigger';
  END IF;

  v_resumed := claim_newsletter_run('schema-assertion-current');
  IF v_resumed.id <> v_run_id OR v_resumed.attempted_count <> 0 THEN
    RAISE EXCEPTION 'same-token resume did not return the untouched current run';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM claim_newsletter_run('schema-assertion-conflict');
  EXCEPTION WHEN SQLSTATE '55006' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'conflicting claim token resumed a running SGT-day run';
  END IF;
END;
$$;

-- ASSERT: provider submission negative transitions
DO $$
DECLARE
  v_issue_id UUID;
  v_run_id UUID;
  v_lead_ids UUID[];
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT issue_id, run_id, lead_ids INTO v_issue_id, v_run_id, v_lead_ids
  FROM newsletter_assertion_fixture;

  BEGIN
    INSERT INTO newsletter_sends (
      issue_id, run_id, slot_no, lead_id, recipient_name, recipient_key,
      attempt_no, phone, rendered_body, status, attempt_started_at, is_test
    ) VALUES (
      v_issue_id, v_run_id, NULL, v_lead_ids[4], 'Null slot fixture', '+6591000004',
      1, '+6591000004', 'null slot provider submission', 'sending', clock_timestamp(), FALSE
    );
  EXCEPTION WHEN not_null_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'real provider submission with a null slot was accepted';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO newsletter_sends (
      issue_id, run_id, slot_no, lead_id, recipient_name, recipient_key,
      attempt_no, phone, rendered_body, status, attempt_started_at, is_test
    ) VALUES (
      v_issue_id, v_run_id, 1, v_lead_ids[4], 'Alternate key fixture', '65 9100 0004',
      1, '+6591000004', 'alternate recipient key', 'sending', clock_timestamp(), FALSE
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'alternate textual recipient key bypassed canonical identity';
  END IF;
END;
$$;

-- ASSERT: three-attempt recipient limit
DO $$
DECLARE
  v_issue_id UUID;
  v_run_id UUID;
  v_lead_ids UUID[];
  v_send newsletter_sends%ROWTYPE;
  v_first_send_id UUID;
  v_i INTEGER;
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT issue_id, run_id, lead_ids INTO v_issue_id, v_run_id, v_lead_ids
  FROM newsletter_assertion_fixture;

  FOR v_i IN 1..3 LOOP
    v_send := start_newsletter_attempt(v_run_id, v_lead_ids[1], v_i, 'recipient attempt ' || v_i);
    IF v_i = 1 THEN
      v_first_send_id := v_send.id;
    END IF;
    v_send := finalize_newsletter_attempt(v_send.id, 'failed', NULL, 'attempt-' || v_i, TRUE);
  END LOOP;

  BEGIN
    PERFORM start_newsletter_attempt(v_run_id, v_lead_ids[1], 4, 'fourth recipient attempt');
  EXCEPTION WHEN SQLSTATE '54000' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'fourth provider submission for one issue/recipient was accepted';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO newsletter_sends (
      issue_id, run_id, slot_no, lead_id, recipient_name, recipient_key,
      attempt_no, phone, rendered_body, status, attempt_started_at, is_test
    ) VALUES (
      v_issue_id, v_run_id, 4, v_lead_ids[1], 'Recipient bypass fixture', '+6591000001',
      4, '+6591000001', 'direct fourth recipient submission', 'sending', clock_timestamp(), FALSE
    );
  EXCEPTION WHEN SQLSTATE '54000' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'fourth provider submission bypassed the trigger gate';
  END IF;

  IF (
    SELECT count(*)
    FROM newsletter_sends
    WHERE lead_id = v_lead_ids[1]
      AND attempt_started_at IS NOT NULL
  ) <> 3 THEN
    RAISE EXCEPTION 'recipient attempt ledger does not contain exactly three submissions';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM finalize_newsletter_attempt(v_first_send_id, 'failed', NULL, 'conflicting-error', FALSE);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'conflicting finalization replay was accepted';
  END IF;

  v_rejected := FALSE;
  BEGIN
    UPDATE newsletter_sends
    SET attempt_started_at = NULL
    WHERE id = v_first_send_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'provider attempt start timestamp was cleared';
  END IF;

  v_rejected := FALSE;
  BEGIN
    UPDATE newsletter_sends
    SET status = 'queued'
    WHERE id = v_first_send_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'provider attempt reverted to queued';
  END IF;
END;
$$;

-- ASSERT: unknown is non-retryable
DO $$
DECLARE
  v_run_id UUID;
  v_lead_ids UUID[];
  v_send newsletter_sends%ROWTYPE;
BEGIN
  SELECT run_id, lead_ids INTO v_run_id, v_lead_ids
  FROM newsletter_assertion_fixture;

  v_send := start_newsletter_attempt(v_run_id, v_lead_ids[2], 4, 'fourth global attempt');
  v_send := finalize_newsletter_attempt(v_send.id, 'failed', NULL, 'fourth-global', FALSE);

  v_send := start_newsletter_attempt(v_run_id, v_lead_ids[3], 5, 'unknown global attempt');
  v_send := finalize_newsletter_attempt(v_send.id, 'unknown', NULL, 'provider timeout', TRUE);
  IF v_send.retryable <> FALSE OR v_send.provider_outcome <> 'unknown' THEN
    RAISE EXCEPTION 'unknown outcome was retryable or lost its provider outcome';
  END IF;

  v_send := resolve_newsletter_unknown(v_send.id, 'schema_assertion', 'failed', 'provider confirmed failure');
  IF v_send.provider_outcome <> 'unknown'
     OR v_send.unknown_resolution <> 'failed'
     OR v_send.unknown_resolved_by <> 'schema_assertion'
     OR v_send.retryable <> FALSE THEN
    RAISE EXCEPTION 'unknown resolution overwrote provider evidence or missed its audit';
  END IF;
END;
$$;

-- ASSERT: global five-attempt gate
DO $$
DECLARE
  v_issue_id UUID;
  v_run_id UUID;
  v_lead_ids UUID[];
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT issue_id, run_id, lead_ids INTO v_issue_id, v_run_id, v_lead_ids
  FROM newsletter_assertion_fixture;

  BEGIN
    PERFORM start_newsletter_attempt(v_run_id, v_lead_ids[4], 1, 'sixth global attempt');
  EXCEPTION WHEN SQLSTATE '54000' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'sixth provider submission was accepted by the RPC';
  END IF;

  v_rejected := FALSE;
  BEGIN
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
      attempt_started_at,
      is_test
    )
    VALUES (
      v_issue_id,
      v_run_id,
      1,
      v_lead_ids[4],
      'Direct bypass fixture',
      '+6591000004',
      1,
      '+6591000004',
      'direct sixth provider submission',
      'sending',
      clock_timestamp(),
      FALSE
    );
  EXCEPTION WHEN SQLSTATE '54000' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'sixth provider submission bypassed the trigger gate';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM newsletter_runs
    WHERE id = v_run_id
      AND attempted_count = 5
  ) THEN
    RAISE EXCEPTION 'current run counter is not exactly five';
  END IF;
END;
$$;

-- ASSERT: FK lead nulling
DO $$
DECLARE
  v_project_id UUID;
  v_lead_ids UUID[];
  v_send_id UUID;
  v_recipient_key TEXT;
  v_recipient_name TEXT;
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT project_id, lead_ids INTO v_project_id, v_lead_ids
  FROM newsletter_assertion_fixture;

  SELECT id, recipient_key, recipient_name
  INTO v_send_id, v_recipient_key, v_recipient_name
  FROM newsletter_sends
  WHERE lead_id = v_lead_ids[1]
  ORDER BY attempt_no
  LIMIT 1;

  BEGIN
    UPDATE newsletter_sends SET lead_id = NULL WHERE id = v_send_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'manual ledger lead nulling was accepted while the lead existed';
  END IF;

  DELETE FROM crm_leads WHERE id = v_lead_ids[1];

  IF NOT EXISTS (
    SELECT 1
    FROM newsletter_sends
    WHERE id = v_send_id
      AND lead_id IS NULL
      AND recipient_key = v_recipient_key
      AND recipient_name = v_recipient_name
  ) THEN
    RAISE EXCEPTION 'ON DELETE SET NULL failed or send-time snapshots changed';
  END IF;
END;
$$;

-- ASSERT: duplicate-phone STOP idempotency
-- ASSERT: STOP event ledger A-B-A replay
DO $$
DECLARE
  v_project_id UUID;
  v_issue_id UUID;
  v_stop_run_id UUID;
  v_lead_a UUID;
  v_lead_b UUID;
  v_a_opt_out TIMESTAMPTZ;
  v_a_updated TIMESTAMPTZ;
  v_b_opt_out TIMESTAMPTZ;
  v_b_updated TIMESTAMPTZ;
  v_seen_after_b TIMESTAMPTZ;
  v_send_updated_after_b TIMESTAMPTZ;
  v_run_updated_after_b TIMESTAMPTZ;
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT project_id, issue_id, stop_run_id
  INTO v_project_id, v_issue_id, v_stop_run_id
  FROM newsletter_assertion_fixture;

  INSERT INTO crm_leads (
    project_id, name, phone, phone_e164, email, message, property_title, source_path
  ) VALUES (
    v_project_id, 'Duplicate STOP A', '92345678', '+6592345678',
    'stop-a@example.invalid', 'schema assertion', 'Schema Assertion', '/schema-assertion'
  ) RETURNING id INTO v_lead_a;

  INSERT INTO crm_leads (
    project_id, name, phone, phone_e164, email, message, property_title, source_path
  ) VALUES (
    v_project_id, 'Duplicate STOP B', '9234 5678', NULL,
    'stop-b@example.invalid', 'schema assertion', 'Schema Assertion', '/schema-assertion'
  ) RETURNING id INTO v_lead_b;

  INSERT INTO newsletter_sends (
    issue_id, run_id, slot_no, lead_id, recipient_name, recipient_key,
    attempt_no, phone, rendered_body, status, is_test
  ) VALUES (
    v_issue_id, v_stop_run_id, 1, v_lead_a, 'Duplicate STOP A', '+6592345678',
    1, '+6592345678', 'queued STOP assertion', 'queued', FALSE
  );

  PERFORM record_newsletter_opt_out('+65 9234 5678', 'stop-message-1', 'STOP');

  SELECT opt_out_at, updated_at INTO v_a_opt_out, v_a_updated FROM crm_leads WHERE id = v_lead_a;
  SELECT opt_out_at, updated_at INTO v_b_opt_out, v_b_updated FROM crm_leads WHERE id = v_lead_b;

  IF v_a_opt_out IS NULL OR v_b_opt_out IS NULL THEN
    RAISE EXCEPTION 'STOP did not update every CRM row sharing the normalized phone';
  END IF;

  PERFORM record_newsletter_opt_out('+65 9234 5678', 'stop-message-2', 'STOP again');

  SELECT last_seen_at INTO v_seen_after_b
  FROM newsletter_suppressions
  WHERE recipient_key = '+6592345678';

  SELECT updated_at INTO v_send_updated_after_b
  FROM newsletter_sends
  WHERE recipient_key = '+6592345678';

  SELECT updated_at INTO v_run_updated_after_b
  FROM newsletter_runs
  WHERE id = v_stop_run_id;

  IF (SELECT last_message_id FROM newsletter_suppressions WHERE recipient_key = '+6592345678') <> 'stop-message-2' THEN
    RAISE EXCEPTION 'new STOP event B did not advance last_message_id';
  END IF;

  PERFORM record_newsletter_opt_out('+65 9234 5678', 'stop-message-1', 'delayed replay A');

  IF EXISTS (
    SELECT 1
    FROM crm_leads
    WHERE (id = v_lead_a AND (opt_out_at, updated_at) IS DISTINCT FROM (v_a_opt_out, v_a_updated))
       OR (id = v_lead_b AND (opt_out_at, updated_at) IS DISTINCT FROM (v_b_opt_out, v_b_updated))
  ) THEN
    RAISE EXCEPTION 'replayed STOP rewrote CRM timestamps';
  END IF;

  IF (SELECT count(*) FROM newsletter_suppressions WHERE recipient_key = '+6592345678') <> 1
     OR (SELECT last_message_id FROM newsletter_suppressions WHERE recipient_key = '+6592345678') <> 'stop-message-2'
     OR (SELECT last_seen_at FROM newsletter_suppressions WHERE recipient_key = '+6592345678') IS DISTINCT FROM v_seen_after_b THEN
    RAISE EXCEPTION 'delayed replay A moved suppression state backward or changed its timestamp';
  END IF;

  IF (SELECT count(*) FROM newsletter_suppression_events WHERE recipient_key = '+6592345678') <> 2 THEN
    RAISE EXCEPTION 'A-B-A sequence did not deduplicate to two append-only events';
  END IF;

  IF (SELECT updated_at FROM newsletter_sends WHERE recipient_key = '+6592345678') IS DISTINCT FROM v_send_updated_after_b
     OR (SELECT updated_at FROM newsletter_runs WHERE id = v_stop_run_id) IS DISTINCT FROM v_run_updated_after_b THEN
    RAISE EXCEPTION 'delayed replay A mutated send or run timestamps';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM newsletter_sends
    WHERE recipient_key = '+6592345678'
      AND status = 'opted_out'
  ) OR NOT EXISTS (
    SELECT 1
    FROM newsletter_runs
    WHERE id = v_stop_run_id
      AND skipped_count = 1
  ) THEN
    RAISE EXCEPTION 'initial STOP did not cancel and count the queued attempt exactly once';
  END IF;

  BEGIN
    UPDATE newsletter_suppression_events
    SET reason = 'mutated'
    WHERE recipient_key = '+6592345678'
      AND provider_message_id = 'stop-message-1';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'suppression event ledger accepted an update';
  END IF;
END;
$$;

DO $$
DECLARE
  v_run_id UUID;
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT run_id INTO v_run_id FROM newsletter_assertion_fixture;

  INSERT INTO newsletter_operator_reports (run_id, operator_key, kind, body, status)
  VALUES (v_run_id, 'schema-operator', 'summary', 'summary one', 'queued');

  BEGIN
    INSERT INTO newsletter_operator_reports (run_id, operator_key, kind, body, status)
    VALUES (v_run_id, 'schema-operator', 'summary', 'summary duplicate', 'queued');
  EXCEPTION WHEN unique_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'duplicate null-send summary operator report was accepted';
  END IF;
END;
$$;

ROLLBACK;
