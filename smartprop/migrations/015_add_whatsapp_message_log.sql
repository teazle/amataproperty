-- Durable WhatsApp message log and expanded conversation phases.

ALTER TABLE outreach
DROP CONSTRAINT IF EXISTS outreach_conversation_phase_check;

ALTER TABLE outreach
ADD CONSTRAINT outreach_conversation_phase_check CHECK (
  conversation_phase IN (
    'initial_request',
    'initial_contact',
    'awaiting_cobroking',
    'awaiting_timeslots',
    'agent_engaging',
    'agent_checking',
    'agent_stalling',
    'timeslots_received',
    'completed',
    'manual_review',
    'gracefully_ended',
    'property_unavailable'
  )
);

ALTER TABLE outreach
DROP CONSTRAINT IF EXISTS outreach_conversation_state_check;

ALTER TABLE outreach
ADD CONSTRAINT outreach_conversation_state_check CHECK (
  conversation_state IN (
    'initial',
    'awaiting_cobroking',
    'awaiting_timeslots',
    'timeslots_received',
    'completed',
    'manual_review',
    'gracefully_ended',
    'failed'
  )
);

CREATE TABLE IF NOT EXISTS wa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outreach_id uuid REFERENCES outreach(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  direction text CHECK (direction IN ('inbound', 'outbound')) NOT NULL,
  phone text NOT NULL,
  chat_id text,
  waha_message_id text,
  dedupe_key text NOT NULL UNIQUE,
  body text NOT NULL,
  raw_payload jsonb,
  occurred_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_outreach_created ON wa_messages(outreach_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_messages_phone_created ON wa_messages(phone, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_messages_waha_message_id ON wa_messages(waha_message_id);

COMMENT ON TABLE wa_messages IS 'Durable WhatsApp inbound/outbound log used for AI memory and webhook idempotency';
COMMENT ON COLUMN wa_messages.dedupe_key IS 'Stable idempotency key, usually WAHA message id plus direction';
