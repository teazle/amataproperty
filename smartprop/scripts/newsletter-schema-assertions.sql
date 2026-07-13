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
  IF to_regprocedure('public.queue_newsletter_attempt(uuid,uuid,text,text,jsonb)') IS NULL THEN
    v_missing := array_append(v_missing, 'queue_newsletter_attempt(uuid,uuid,text,text,jsonb)');
  END IF;
  IF to_regprocedure('public.start_newsletter_attempt(uuid,integer,text)') IS NULL THEN
    v_missing := array_append(v_missing, 'start_newsletter_attempt(uuid,integer,text)');
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
  IF to_regprocedure('public.record_accepted_newsletter_recovery(uuid,text,text)') IS NULL THEN
    v_missing := array_append(v_missing, 'record_accepted_newsletter_recovery(uuid,text,text)');
  END IF;
  IF to_regprocedure('public.create_newsletter_test_send(uuid,uuid,text,text,jsonb)') IS NULL THEN
    v_missing := array_append(v_missing, 'create_newsletter_test_send(uuid,uuid,text,text,jsonb)');
  END IF;
  IF to_regprocedure('public.finalize_newsletter_test_send(uuid,text,text,text,boolean)') IS NULL THEN
    v_missing := array_append(v_missing, 'finalize_newsletter_test_send(uuid,text,text,text,boolean)');
  END IF;
  IF to_regprocedure('public.recover_stale_newsletter_operator_reports(uuid,timestamp with time zone)') IS NULL THEN
    v_missing := array_append(v_missing, 'recover_stale_newsletter_operator_reports(uuid,timestamptz)');
  END IF;
  IF to_regprocedure('public.start_newsletter_attempt(uuid,uuid,integer,text)') IS NOT NULL THEN
    v_missing := array_append(v_missing, 'obsolete start_newsletter_attempt overload still exists');
  END IF;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'missing newsletter schema objects: %', array_to_string(v_missing, ', ');
  END IF;
END;
$$;

-- ASSERT: service-role grants and fixed search paths
-- ASSERT: Task 1.1 secured RPC grants
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
      'queue_newsletter_attempt',
      'start_newsletter_attempt',
      'finalize_newsletter_attempt',
      'record_accepted_newsletter_recovery',
      'create_newsletter_test_send',
      'finalize_newsletter_test_send',
      'recover_stale_newsletter_operator_reports',
      'record_newsletter_opt_out',
      'resolve_newsletter_unknown'
    ])
    AND proc.prosecdef = TRUE
    AND proc.proconfig @> ARRAY['search_path=public']
    AND has_function_privilege('service_role', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', proc.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    );

  IF v_function_count <> 10 THEN
    RAISE EXCEPTION 'RPC security contract matched % of 10 functions', v_function_count;
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

  -- ASSERT: newsletter sends least privilege and spoofed GUC
  IF NOT has_table_privilege('service_role', 'newsletter_sends', 'SELECT')
     OR has_table_privilege('service_role', 'newsletter_sends', 'INSERT')
     OR has_table_privilege('service_role', 'newsletter_sends', 'UPDATE')
     OR has_table_privilege('service_role', 'newsletter_sends', 'DELETE')
     OR has_table_privilege('service_role', 'newsletter_sends', 'TRUNCATE')
     OR has_table_privilege('service_role', 'newsletter_sends', 'REFERENCES')
     OR has_table_privilege('service_role', 'newsletter_sends', 'TRIGGER')
     OR has_table_privilege('anon', 'newsletter_sends', 'SELECT')
     OR has_table_privilege('anon', 'newsletter_sends', 'INSERT')
     OR has_table_privilege('anon', 'newsletter_sends', 'UPDATE')
     OR has_table_privilege('anon', 'newsletter_sends', 'DELETE')
     OR has_table_privilege('anon', 'newsletter_sends', 'TRUNCATE')
     OR has_table_privilege('anon', 'newsletter_sends', 'REFERENCES')
     OR has_table_privilege('anon', 'newsletter_sends', 'TRIGGER')
     OR has_table_privilege('authenticated', 'newsletter_sends', 'SELECT')
     OR has_table_privilege('authenticated', 'newsletter_sends', 'INSERT')
     OR has_table_privilege('authenticated', 'newsletter_sends', 'UPDATE')
     OR has_table_privilege('authenticated', 'newsletter_sends', 'DELETE')
     OR has_table_privilege('authenticated', 'newsletter_sends', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'newsletter_sends', 'REFERENCES')
     OR has_table_privilege('authenticated', 'newsletter_sends', 'TRIGGER')
     OR EXISTS (
       SELECT 1
       FROM pg_class AS relation
       CROSS JOIN LATERAL aclexplode(
         COALESCE(relation.relacl, acldefault('r', relation.relowner))
       ) AS acl
       WHERE relation.oid = 'newsletter_sends'::regclass
         AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'newsletter send table privileges are not service-role read-only';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    JOIN pg_class AS relation ON relation.oid = 'newsletter_sends'::regclass
    WHERE namespace.nspname = 'public'
      AND proc.proname IN ('create_newsletter_test_send', 'finalize_newsletter_test_send')
      AND proc.prosecdef = TRUE
      AND proc.proowner = relation.relowner
  ) <> 2 THEN
    RAISE EXCEPTION 'test-send RPCs are not owner-executed for ledger writes';
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

  INSERT INTO newsletter_issues (
    slug, status, audience_project_slug, created_by, approved_by, approved_at
  )
  VALUES (
    'newsletter-assertion-' || txid_current(),
    'approved',
    'newsletter-assertion-' || txid_current(),
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

CREATE OR REPLACE FUNCTION pg_temp.queue_and_start_newsletter_assertion(
  p_run_id UUID,
  p_lead_id UUID,
  p_slot_no INTEGER,
  p_claim_token TEXT,
  p_body TEXT
)
RETURNS newsletter_sends
LANGUAGE plpgsql
AS $$
DECLARE
  v_send newsletter_sends%ROWTYPE;
BEGIN
  v_send := queue_newsletter_attempt(
    p_run_id,
    p_lead_id,
    p_claim_token,
    p_body,
    jsonb_build_object('assertion', p_body)
  );
  RETURN start_newsletter_attempt(v_send.id, p_slot_no, p_claim_token);
END;
$$;

-- ASSERT: stale-run rejection and resume safety
-- ASSERT: stale claim takeover
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
    PERFORM queue_newsletter_attempt(
      v_stale_run_id,
      v_lead_ids[4],
      'schema-assertion-stale',
      'stale run must fail',
      '{"assertion":"stale"}'::JSONB
    );
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

  UPDATE newsletter_runs
  SET last_heartbeat_at = clock_timestamp() - INTERVAL '16 minutes'
  WHERE id = v_run_id;

  v_resumed := claim_newsletter_run('schema-assertion-takeover');
  IF v_resumed.id <> v_run_id
     OR v_resumed.claim_token <> 'schema-assertion-takeover'
     OR v_resumed.last_heartbeat_at < clock_timestamp() - INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'stale claim was not transferred atomically';
  END IF;

  v_resumed := claim_newsletter_run('schema-assertion-takeover');
  IF v_resumed.id <> v_run_id OR v_resumed.claim_token <> 'schema-assertion-takeover' THEN
    RAISE EXCEPTION 'same-token takeover resume was not idempotent';
  END IF;
END;
$$;

-- ASSERT: persisted queue restart safety
-- ASSERT: queue suppression before start
-- ASSERT: queued STOP release and replacement capacity
DO $$
DECLARE
  v_run_id UUID;
  v_lead_ids UUID[];
  v_queued newsletter_sends%ROWTYPE;
  v_resumed newsletter_sends%ROWTYPE;
  v_replacement newsletter_sends%ROWTYPE;
BEGIN
  SELECT run_id, lead_ids INTO v_run_id, v_lead_ids
  FROM newsletter_assertion_fixture;

  v_queued := queue_newsletter_attempt(
    v_run_id,
    v_lead_ids[5],
    'schema-assertion-takeover',
    'persisted queue body A',
    '{"value":500000,"source":"assertion-A"}'::JSONB
  );

  IF v_queued.status <> 'queued'
     OR v_queued.slot_no IS NOT NULL
     OR v_queued.attempt_no IS NOT NULL
     OR v_queued.attempt_started_at IS NOT NULL
     OR v_queued.valuation_snapshot ->> 'source' <> 'assertion-A' THEN
    RAISE EXCEPTION 'queued selection did not persist complete pre-POST snapshots';
  END IF;

  UPDATE crm_leads SET name = 'Changed Candidate Name' WHERE id = v_lead_ids[5];

  v_resumed := queue_newsletter_attempt(
    v_run_id,
    v_lead_ids[5],
    'schema-assertion-takeover',
    'changed body must not replace snapshot',
    '{"value":1,"source":"changed"}'::JSONB
  );
  IF v_resumed.id <> v_queued.id
     OR v_resumed.recipient_name <> v_queued.recipient_name
     OR v_resumed.rendered_body <> 'persisted queue body A'
     OR v_resumed.valuation_snapshot ->> 'source' <> 'assertion-A' THEN
    RAISE EXCEPTION 'restart did not preserve the original queued selection';
  END IF;

  PERFORM record_newsletter_opt_out('+6591000005', 'queue-stop-A', 'STOP before POST');

  v_resumed := start_newsletter_attempt(v_queued.id, 1, 'schema-assertion-takeover');
  IF v_resumed.status <> 'opted_out'
     OR v_resumed.slot_no IS NOT NULL
     OR v_resumed.attempt_started_at IS NOT NULL
     OR NOT EXISTS (
    SELECT 1 FROM newsletter_sends
    WHERE id = v_queued.id
      AND status = 'opted_out'
      AND slot_no IS NULL
      AND attempt_started_at IS NULL
  ) THEN
    RAISE EXCEPTION 'suppression before start did not preserve a no-POST opted-out row';
  END IF;

  v_replacement := queue_newsletter_attempt(
    v_run_id,
    v_lead_ids[6],
    'schema-assertion-takeover',
    'replacement queue body B',
    '{"value":600000,"source":"assertion-B"}'::JSONB
  );
  IF v_replacement.status <> 'queued' OR v_replacement.id = v_queued.id THEN
    RAISE EXCEPTION 'replacement was not queued after pre-POST suppression';
  END IF;

  UPDATE newsletter_sends
  SET status = 'skipped',
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_replacement.id;
END;
$$;

-- ASSERT: secured test-send RPCs
DO $$
DECLARE
  v_issue_id UUID;
  v_run_id UUID;
  v_lead_ids UUID[];
  v_send newsletter_sends%ROWTYPE;
  v_run_before newsletter_runs%ROWTYPE;
  v_lead_before crm_leads%ROWTYPE;
BEGIN
  SELECT issue_id, run_id, lead_ids INTO v_issue_id, v_run_id, v_lead_ids
  FROM newsletter_assertion_fixture;

  SELECT * INTO v_run_before FROM newsletter_runs WHERE id = v_run_id;
  SELECT * INTO v_lead_before FROM crm_leads WHERE id = v_lead_ids[8];

  v_send := create_newsletter_test_send(
    v_issue_id,
    v_lead_ids[8],
    '+65 9888 0000',
    'isolated test-send body',
    '{"value":800000,"source":"test-send-assertion"}'::JSONB
  );

  IF v_send.status <> 'test'
     OR v_send.is_test <> TRUE
     OR v_send.override_phone <> '+6598880000'
     OR v_send.run_id IS NOT NULL
     OR v_send.slot_no IS NOT NULL
     OR v_send.attempt_no IS NOT NULL
     OR v_send.attempt_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'test-send creation did not remain outside provider run accounting';
  END IF;

  v_send := finalize_newsletter_test_send(
    v_send.id,
    'sent',
    'test-provider-message',
    NULL,
    FALSE
  );

  IF v_send.status <> 'test'
     OR v_send.provider_outcome <> 'sent'
     OR v_send.waha_message_id <> 'test-provider-message'
     OR v_send.completed_at IS NULL
     OR v_send.sent_at IS NULL
     OR v_send.run_id IS NOT NULL
     OR v_send.slot_no IS NOT NULL
     OR v_send.attempt_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'test-send finalization did not preserve isolated provider evidence';
  END IF;

  IF (SELECT newsletter_runs FROM newsletter_runs WHERE id = v_run_id)
       IS DISTINCT FROM v_run_before
     OR (SELECT crm_leads FROM crm_leads WHERE id = v_lead_ids[8])
       IS DISTINCT FROM v_lead_before
     OR EXISTS (
       SELECT 1 FROM crm_lead_activities
       WHERE lead_id = v_lead_ids[8]
         AND metadata ->> 'newsletter_send_id' = v_send.id::TEXT
     ) THEN
    RAISE EXCEPTION 'test-send RPC mutated CRM or run state';
  END IF;
END;
$$;

-- ASSERT: post-queue phone change blocks start
DO $$
DECLARE
  v_run_id UUID;
  v_lead_ids UUID[];
  v_queued newsletter_sends%ROWTYPE;
  v_attempted_before INTEGER;
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT run_id, lead_ids INTO v_run_id, v_lead_ids
  FROM newsletter_assertion_fixture;

  v_queued := queue_newsletter_attempt(
    v_run_id,
    v_lead_ids[7],
    'schema-assertion-takeover',
    'phone-change queue body',
    '{"value":700000,"source":"phone-change"}'::JSONB
  );
  SELECT attempted_count INTO v_attempted_before
  FROM newsletter_runs
  WHERE id = v_run_id;

  UPDATE crm_leads
  SET phone = '92000007',
      phone_e164 = '+6592000007',
      updated_at = clock_timestamp()
  WHERE id = v_lead_ids[7];

  BEGIN
    PERFORM start_newsletter_attempt(v_queued.id, 1, 'schema-assertion-takeover');
  EXCEPTION WHEN serialization_failure THEN
    v_rejected := TRUE;
  END;

  IF NOT v_rejected
     OR NOT EXISTS (
       SELECT 1 FROM newsletter_sends
       WHERE id = v_queued.id
         AND status = 'queued'
         AND slot_no IS NULL
         AND attempt_no IS NULL
         AND attempt_started_at IS NULL
     )
     OR (SELECT attempted_count FROM newsletter_runs WHERE id = v_run_id)
       IS DISTINCT FROM v_attempted_before THEN
    RAISE EXCEPTION 'post-queue CRM phone change consumed or started a provider slot';
  END IF;

  UPDATE newsletter_sends
  SET status = 'skipped',
      retryable = FALSE,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_queued.id;
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
    v_send := pg_temp.queue_and_start_newsletter_assertion(
      v_run_id,
      v_lead_ids[1],
      v_i,
      'schema-assertion-takeover',
      'recipient attempt ' || v_i
    );
    IF v_i = 1 THEN
      v_first_send_id := v_send.id;
    END IF;
    v_send := finalize_newsletter_attempt(v_send.id, 'failed', NULL, 'attempt-' || v_i, TRUE);
  END LOOP;

  BEGIN
    PERFORM pg_temp.queue_and_start_newsletter_assertion(
      v_run_id,
      v_lead_ids[1],
      4,
      'schema-assertion-takeover',
      'fourth recipient attempt'
    );
  EXCEPTION WHEN SQLSTATE '54000' OR SQLSTATE '55000' THEN
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
  EXCEPTION WHEN SQLSTATE '54000' OR SQLSTATE '55000' THEN
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
-- ASSERT: accepted recovery persistence
-- ASSERT: accepted recovery auto-repairs run
DO $$
DECLARE
  v_run_id UUID;
  v_lead_ids UUID[];
  v_send newsletter_sends%ROWTYPE;
BEGIN
  SELECT run_id, lead_ids INTO v_run_id, v_lead_ids
  FROM newsletter_assertion_fixture;

  v_send := pg_temp.queue_and_start_newsletter_assertion(
    v_run_id,
    v_lead_ids[2],
    4,
    'schema-assertion-takeover',
    'fourth global attempt'
  );
  v_send := record_accepted_newsletter_recovery(
    v_send.id,
    'accepted-recovery-message',
    'CRM finalization unavailable after provider acceptance'
  );

  IF v_send.status <> 'unknown'
     OR v_send.provider_outcome <> 'sent'
     OR v_send.waha_message_id <> 'accepted-recovery-message'
     OR v_send.crm_sync_error <> 'CRM finalization unavailable after provider acceptance'
     OR v_send.retryable <> FALSE
     OR EXISTS (
       SELECT 1 FROM crm_leads
       WHERE id = v_lead_ids[2] AND status <> 'new'
     )
     OR EXISTS (
       SELECT 1 FROM crm_lead_activities
       WHERE lead_id = v_lead_ids[2]
         AND metadata ->> 'newsletter_send_id' = v_send.id::TEXT
     ) THEN
    RAISE EXCEPTION 'accepted recovery did not preserve evidence without CRM mutation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM newsletter_runs
    WHERE id = v_run_id
      AND status = 'failed'
      AND blocker = 'accepted send requires CRM finalization recovery'
      AND unknown_count = 1
  ) THEN
    RAISE EXCEPTION 'accepted recovery did not fail and block the run with counters';
  END IF;

  v_send := resolve_newsletter_unknown(
    v_send.id,
    'schema_assertion',
    'sent',
    'accepted provider evidence confirmed'
  );
  IF v_send.status <> 'sent'
     OR v_send.provider_outcome <> 'sent'
     OR v_send.unknown_resolution <> 'sent'
     OR NOT EXISTS (
       SELECT 1 FROM crm_leads
       WHERE id = v_lead_ids[2] AND status = 'contacted'
     ) THEN
    RAISE EXCEPTION 'accepted recovery resolution did not finalize CRM safely';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM newsletter_runs
    WHERE id = v_run_id
      AND status = 'running'
      AND blocker IS NULL
      AND unknown_count = 0
      AND attempted_count = 4
      AND completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'accepted recovery resolution did not automatically repair the run';
  END IF;

  v_send := pg_temp.queue_and_start_newsletter_assertion(
    v_run_id,
    v_lead_ids[3],
    5,
    'schema-assertion-takeover',
    'unknown global attempt'
  );
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
    PERFORM pg_temp.queue_and_start_newsletter_assertion(
      v_run_id,
      v_lead_ids[4],
      1,
      'schema-assertion-takeover',
      'sixth global attempt'
    );
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
  EXCEPTION WHEN SQLSTATE '54000' OR SQLSTATE '55000' THEN
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

-- ASSERT: stale operator report recovery is atomic
DO $$
DECLARE
  v_run_id UUID;
  v_report_id UUID;
  v_recovered INTEGER;
BEGIN
  SELECT run_id INTO v_run_id FROM newsletter_assertion_fixture;

  INSERT INTO newsletter_operator_reports (
    run_id, operator_key, kind, body, status, attempt_started_at
  ) VALUES (
    v_run_id,
    'schema-stale-operator',
    'summary',
    'stale summary',
    'sending',
    clock_timestamp() - INTERVAL '10 minutes'
  ) RETURNING id INTO v_report_id;

  v_recovered := recover_stale_newsletter_operator_reports(
    v_run_id,
    clock_timestamp() - INTERVAL '5 minutes'
  );

  IF v_recovered <> 1
     OR NOT EXISTS (
       SELECT 1 FROM newsletter_operator_reports
       WHERE id = v_report_id AND status = 'unknown'
     )
     OR NOT EXISTS (
       SELECT 1 FROM newsletter_runs
       WHERE id = v_run_id
         AND report_error = 'stale operator report outcome unknown'
     ) THEN
    RAISE EXCEPTION 'stale report and run recovery state were not committed atomically';
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

SET LOCAL ROLE service_role;

-- ASSERT: newsletter sends least privilege and spoofed GUC
DO $$
DECLARE
  v_send_id UUID;
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_send_id
  FROM newsletter_sends
  ORDER BY created_at, id
  LIMIT 1;

  PERFORM set_config('app.newsletter_start_send_id', v_send_id::TEXT, TRUE);
  BEGIN
    UPDATE newsletter_sends
    SET updated_at = clock_timestamp()
    WHERE id = v_send_id;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'service role bypassed the send ledger ACL with a spoofed start GUC';
  END IF;
END;
$$;

RESET ROLE;

ROLLBACK;
