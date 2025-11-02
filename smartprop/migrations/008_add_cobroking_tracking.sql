-- Add co-broking tracking to outreach table
-- This tracks whether the listing agent is willing to co-broke

ALTER TABLE outreach
ADD COLUMN IF NOT EXISTS co_broking_status TEXT CHECK (
  co_broking_status IN (
    'unknown',        -- Haven't asked or unclear response
    'willing',        -- Agent confirmed yes to co-broking
    'not_willing',    -- Agent said no co-broking
    'needs_discussion' -- Agent wants to discuss terms
  )
) DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS co_broking_notes TEXT;

-- Create index for querying co-broking status
CREATE INDEX IF NOT EXISTS idx_outreach_co_broking_status ON outreach(co_broking_status);

-- Add comments
COMMENT ON COLUMN outreach.co_broking_status IS 'Whether listing agent is willing to co-broke commission';
COMMENT ON COLUMN outreach.co_broking_notes IS 'Additional notes about co-broking terms or conditions';

-- Also useful to have on agents table for historical tracking
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS typically_co_brokes BOOLEAN DEFAULT NULL,
ADD COLUMN IF NOT EXISTS co_broking_notes TEXT;

COMMENT ON COLUMN agents.typically_co_brokes IS 'Historical pattern: does this agent typically co-broke?';
COMMENT ON COLUMN agents.co_broking_notes IS 'Notes about this agent co-broking preferences or terms';

