-- Add viewing timeslot tracking to listings
ALTER TABLE listings
ADD COLUMN IF NOT EXISTS viewing_requested_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS viewing_timeslots TEXT,
ADD COLUMN IF NOT EXISTS viewing_status TEXT CHECK (viewing_status IN ('pending', 'requested', 'received', 'failed')) DEFAULT 'pending';

-- Add message tracking to outreach table for viewing timeslot requests
ALTER TABLE outreach
ADD COLUMN IF NOT EXISTS message_text TEXT,
ADD COLUMN IF NOT EXISTS reply_text TEXT,
ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

-- Create index for efficient querying of pending viewing requests
CREATE INDEX IF NOT EXISTS idx_listings_viewing_status ON listings(viewing_status);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach(status);

-- Add comment for clarity
COMMENT ON COLUMN listings.viewing_timeslots IS 'Agent-provided viewing timeslots (text format)';
COMMENT ON COLUMN listings.viewing_status IS 'Status: pending (not yet requested), requested (message sent), received (response received), failed (message failed)';

