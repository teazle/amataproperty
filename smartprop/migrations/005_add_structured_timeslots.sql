-- Add JSONB column for AI-parsed structured viewing timeslots
ALTER TABLE listings
ADD COLUMN IF NOT EXISTS viewing_timeslots_structured JSONB;

-- Create index for JSONB queries (optional but useful)
CREATE INDEX IF NOT EXISTS idx_listings_timeslots_structured ON listings USING GIN (viewing_timeslots_structured);

-- Add comment
COMMENT ON COLUMN listings.viewing_timeslots_structured IS 'AI-parsed structured viewing timeslots (JSON format with days, times, notes)';

