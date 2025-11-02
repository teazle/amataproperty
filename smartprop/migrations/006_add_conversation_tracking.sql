-- Add conversation tracking to outreach table
ALTER TABLE outreach
ADD COLUMN IF NOT EXISTS conversation_state TEXT CHECK (conversation_state IN ('initial', 'awaiting_timeslots', 'timeslots_received', 'failed')) DEFAULT 'initial',
ADD COLUMN IF NOT EXISTS auto_reply_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_auto_reply_at TIMESTAMPTZ;

-- Add index for querying conversation state
CREATE INDEX IF NOT EXISTS idx_outreach_conversation_state ON outreach(conversation_state);

-- Add comments
COMMENT ON COLUMN outreach.conversation_state IS 'Tracks conversation: initial (first message), awaiting_timeslots (waiting for agent reply), timeslots_received (got slots), failed (gave up)';
COMMENT ON COLUMN outreach.auto_reply_count IS 'Number of auto-replies sent in this conversation';
COMMENT ON COLUMN outreach.last_auto_reply_at IS 'Timestamp of last automatic reply';

