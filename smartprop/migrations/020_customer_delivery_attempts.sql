-- PREPARED ONLY: production application requires explicit migration approval.
-- Existing domain statuses are unchanged. Claimed/unknown attempts require
-- reconciliation; only an explicit pre-send blocked result can be reclaimed.
BEGIN;

CREATE TABLE public.customer_delivery_attempts (
  delivery_key TEXT PRIMARY KEY CHECK (length(delivery_key) BETWEEN 1 AND 256),
  purpose TEXT NOT NULL CHECK (purpose IN ('initial_cobroking', 'viewing_request')),
  recipient TEXT NOT NULL CHECK (length(btrim(recipient)) BETWEEN 1 AND 80),
  claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
  state TEXT NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed','accepted','blocked','rejected','unknown')),
  attempt_no INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no > 0),
  provider TEXT CHECK (provider IN ('waha','openclaw','unknown')),
  provider_message_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (delivery_key LIKE purpose || ':%'),
  CHECK (state <> 'accepted' OR (provider IS NOT NULL AND provider IN ('waha','openclaw')
    AND provider_message_id IS NOT NULL AND length(btrim(provider_message_id)) > 0))
);

ALTER TABLE public.customer_delivery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_delivery_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.customer_delivery_attempts TO service_role;

CREATE FUNCTION public.claim_customer_delivery(p_key TEXT, p_purpose TEXT, p_recipient TEXT)
RETURNS UUID LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  INSERT INTO public.customer_delivery_attempts AS existing (delivery_key, purpose, recipient)
  VALUES (p_key, p_purpose, p_recipient)
  ON CONFLICT (delivery_key) DO UPDATE SET
    claim_token = gen_random_uuid(), state = 'claimed', attempt_no = existing.attempt_no + 1,
    provider = NULL, provider_message_id = NULL, error = NULL, updated_at = now()
  WHERE existing.state = 'blocked' AND existing.purpose = EXCLUDED.purpose
    AND existing.recipient = EXCLUDED.recipient
  RETURNING claim_token;
$$;

CREATE FUNCTION public.finish_customer_delivery(
  p_key TEXT, p_token UUID, p_outcome TEXT, p_provider TEXT,
  p_message_id TEXT DEFAULT NULL, p_error TEXT DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE affected INTEGER;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted','blocked','rejected','unknown')
    OR p_provider IS NULL OR p_provider NOT IN ('waha','openclaw','unknown') THEN
    RAISE EXCEPTION 'Invalid delivery finalization';
  END IF;
  IF p_outcome = 'accepted' AND (p_provider = 'unknown' OR p_message_id IS NULL OR length(btrim(p_message_id)) = 0) THEN
    RAISE EXCEPTION 'Accepted delivery requires provider and message id';
  END IF;
  UPDATE public.customer_delivery_attempts SET
    state = p_outcome, provider = p_provider, provider_message_id = p_message_id,
    error = p_error, updated_at = now()
  WHERE delivery_key = p_key AND claim_token = p_token AND state = 'claimed';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_customer_delivery(TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_customer_delivery(TEXT,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_customer_delivery(TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_customer_delivery(TEXT,UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;
COMMIT;
