-- Enhance conversation tracking for smarter AI dialogue management
-- This removes hard reply limits and adds pattern recognition

ALTER TABLE outreach
ADD COLUMN IF NOT EXISTS first_message_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS deflection_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS conversation_history JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS conversation_phase TEXT CHECK (
  conversation_phase IN (
    'initial_request',      -- First message sent
    'agent_engaging',       -- Agent is responsive  
    'agent_checking',       -- "Let me check" pattern
    'agent_stalling',       -- Multiple deflections
    'timeslots_received',   -- Success!
    'gracefully_ended',     -- We gave up politely
    'property_unavailable'  -- Sold/not available
  )
) DEFAULT 'initial_request';

-- Update existing records to set first_message_sent_at for already sent messages
UPDATE outreach 
SET first_message_sent_at = created_at 
WHERE first_message_sent_at IS NULL AND status IN ('sent', 'delivered', 'replied');

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_outreach_conversation_phase ON outreach(conversation_phase);
CREATE INDEX IF NOT EXISTS idx_outreach_first_message_sent_at ON outreach(first_message_sent_at);
CREATE INDEX IF NOT EXISTS idx_outreach_deflection_count ON outreach(deflection_count);

-- Add comments for clarity
COMMENT ON COLUMN outreach.first_message_sent_at IS 'Timestamp when the first message was sent to the agent';
COMMENT ON COLUMN outreach.last_message_at IS 'Timestamp of the last message in the conversation (sent or received)';
COMMENT ON COLUMN outreach.deflection_count IS 'Number of times agent deflected without providing timeslots';
COMMENT ON COLUMN outreach.conversation_history IS 'JSON array of conversation messages for AI context';
COMMENT ON COLUMN outreach.conversation_phase IS 'Current phase of the conversation for intelligent decision making';

-- Note: We keep auto_reply_count for logging but don't use it as a hard limit
COMMENT ON COLUMN outreach.auto_reply_count IS 'Count of auto-replies sent (for logging only, not a hard limit)';

