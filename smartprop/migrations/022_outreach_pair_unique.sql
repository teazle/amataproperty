-- One outreach history per listing owner, including concurrent confirmations.
-- Existing history is retained. A pre-existing duplicate causes a safe failure
-- for operator reconciliation rather than automatic deletion.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE public.outreach
  ADD CONSTRAINT outreach_agent_listing_unique UNIQUE (agent_id, listing_id);
COMMIT;
