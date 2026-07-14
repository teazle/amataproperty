\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.newsletter_valuation_runs') IS NULL THEN
    RAISE EXCEPTION 'relation "newsletter_valuation_runs" does not exist';
  END IF;
  IF to_regprocedure('public.claim_newsletter_valuation_run(text,text)') IS NULL THEN
    RAISE EXCEPTION 'function claim_newsletter_valuation_run(text,text) does not exist';
  END IF;
END;
$$;

DELETE FROM newsletter_sends;
DELETE FROM newsletter_runs;
DELETE FROM newsletter_valuation_items;
DELETE FROM newsletter_valuation_runs;
DELETE FROM newsletter_issues;
DELETE FROM crm_leads;
DELETE FROM crm_projects WHERE slug = 'valuation-refresh-test';

INSERT INTO crm_projects (
  slug,
  title,
  source,
  valuation_location,
  valuation_property_type,
  valuation_tenure,
  valuation_area_distribution,
  valuation_profile_updated_at
)
VALUES (
  'valuation-refresh-test',
  'Valuation Refresh Test',
  'test',
  'Singapore',
  'Condominium',
  'Freehold',
  '[{"areaSqft":1000,"count":1}]'::jsonb,
  clock_timestamp()
);

INSERT INTO newsletter_issues (
  slug,
  status,
  audience_project_slug,
  approved_at,
  created_at
)
VALUES (
  'valuation-refresh-test-issue',
  'approved',
  'valuation-refresh-test',
  clock_timestamp() - interval '1 minute',
  clock_timestamp() - interval '1 minute'
);

INSERT INTO crm_leads (
  project_id,
  name,
  phone,
  phone_e164,
  email,
  message,
  property_title,
  source_path,
  lead_code,
  status,
  priority
)
SELECT
  id,
  'Private Test Lead',
  '91234567',
  '+6591234567',
  'private@example.invalid',
  'private note',
  title,
  '/test',
  'valuationtestlead',
  'new',
  'normal'
FROM crm_projects
WHERE slug = 'valuation-refresh-test';

CREATE TEMP TABLE valuation_assertion_state AS
SELECT claim_newsletter_valuation_run('assertion-worker', 'assertion-revision') AS queue;

DO $$
DECLARE
  v_queue jsonb := (SELECT queue FROM valuation_assertion_state);
  v_again jsonb;
BEGIN
  IF v_queue->>'runId' IS NULL OR v_queue->>'leaseToken' IS NULL THEN
    RAISE EXCEPTION 'claim did not return run and lease identifiers';
  END IF;
  IF jsonb_array_length(v_queue->'candidates') <> 1 THEN
    RAISE EXCEPTION 'claim did not produce exactly one project research item';
  END IF;
  IF v_queue::text ~* '(Private Test Lead|91234567|private@example|private note)' THEN
    RAISE EXCEPTION 'queue leaked recipient PII';
  END IF;

  v_again := claim_newsletter_valuation_run('assertion-worker', 'assertion-revision');
  IF v_again->>'runId' <> v_queue->>'runId'
     OR v_again->>'leaseToken' <> v_queue->>'leaseToken' THEN
    RAISE EXCEPTION 'claim is not idempotent';
  END IF;
END;
$$;

DO $$
DECLARE
  v_queue jsonb := (SELECT queue FROM valuation_assertion_state);
BEGIN
  BEGIN
    PERFORM heartbeat_newsletter_valuation_run(
      (v_queue->>'runId')::uuid,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'wrong lease heartbeat unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END;
$$;

DO $$
DECLARE
  v_queue jsonb := (SELECT queue FROM valuation_assertion_state);
  v_run uuid := (v_queue->>'runId')::uuid;
  v_lease uuid := (v_queue->>'leaseToken')::uuid;
  v_item uuid := (v_queue->'candidates'->0->>'itemId')::uuid;
  v_outcome jsonb := jsonb_build_object(
    'kind', 'accepted',
    'evidence', jsonb_build_object(
      'lowSgd', 1500000,
      'midSgd', 1600000,
      'highSgd', 1700000,
      'psfLow', 1500,
      'psfHigh', 1700,
      'areaSqft', 1000,
      'comparablesCount', 4,
      'confidence', 'high',
      'asOf', current_date::text,
      'expiresAt', (clock_timestamp() + interval '30 days')::text,
      'evidenceContractVersion', 'chloe-valuation-v1',
      'evidenceHash', repeat('a', 64),
      'basis', 'Four comparable transactions.',
      'acquisitionMethod', 'ura',
      'sources', '[]'::jsonb,
      'agentIdentity', 'assertion-worker',
      'sourceRevision', 'assertion-revision'
    )
  );
  v_first jsonb;
  v_replay jsonb;
  v_complete jsonb;
BEGIN
  PERFORM heartbeat_newsletter_valuation_run(v_run, v_lease);
  v_first := record_newsletter_valuation_item(v_run, v_item, v_lease, v_outcome);
  v_replay := record_newsletter_valuation_item(v_run, v_item, v_lease, v_outcome);
  IF v_first <> v_replay THEN
    RAISE EXCEPTION 'identical accepted replay is not idempotent';
  END IF;

  BEGIN
    PERFORM record_newsletter_valuation_item(
      v_run,
      v_item,
      v_lease,
      jsonb_build_object('kind', 'blocked', 'reason', 'conflicting replay', 'attemptedSources', '[]'::jsonb)
    );
    RAISE EXCEPTION 'conflicting replay unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  v_complete := complete_newsletter_valuation_run(v_run, v_lease);
  IF v_complete->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'accepted run did not complete';
  END IF;
END;
$$;

DO $$
DECLARE
  v_item newsletter_valuation_items%rowtype;
BEGIN
  SELECT * INTO v_item FROM newsletter_valuation_items LIMIT 1;
  IF v_item.cache_valuation_id IS NULL OR v_item.status <> 'accepted' THEN
    RAISE EXCEPTION 'accepted item is not linked to cache';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM propnex_valuations
    WHERE id = v_item.cache_valuation_id
      AND address_key = 'project:valuation-refresh-test'
      AND project_slug = 'valuation-refresh-test'
      AND evidence_item_id = v_item.id
      AND evidence_status = 'accepted'
      AND evidence_contract_version = 'chloe-valuation-v1'
      AND validated_confidence = 'high'
  ) THEN
    RAISE EXCEPTION 'accepted cache contract is incomplete';
  END IF;

  BEGIN
    UPDATE newsletter_valuation_items
    SET project_slug = 'changed'
    WHERE id = v_item.id;
    RAISE EXCEPTION 'immutable project snapshot unexpectedly changed';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END;
$$;

DO $$
DECLARE
  v_issue uuid := (SELECT id FROM newsletter_issues WHERE slug = 'valuation-refresh-test-issue');
  v_gate jsonb;
  v_claim newsletter_runs%rowtype;
BEGIN
  v_gate := get_newsletter_valuation_gate(v_issue);
  IF NOT (v_gate->>'healthy')::boolean THEN
    RAISE EXCEPTION 'completed preparation gate is not healthy: %', v_gate;
  END IF;

  v_claim := claim_newsletter_run('assertion-send-legacy');
  IF v_claim.issue_id <> v_issue THEN
    RAISE EXCEPTION 'legacy campaign claim selected the wrong issue';
  END IF;
  v_claim := claim_newsletter_run('assertion-send-legacy', v_issue);
  IF v_claim.issue_id <> v_issue THEN
    RAISE EXCEPTION 'explicit campaign claim selected the wrong issue';
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_table_privilege('service_role', 'newsletter_valuation_runs', 'INSERT')
     OR has_table_privilege('service_role', 'newsletter_valuation_items', 'UPDATE')
     OR has_table_privilege('service_role', 'propnex_valuations', 'DELETE') THEN
    RAISE EXCEPTION 'service_role retained a direct valuation write privilege';
  END IF;
END;
$$;

SELECT 'valuation refresh schema assertions passed' AS result;
ROLLBACK;
