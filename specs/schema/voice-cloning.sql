-- Voice cloning: store ElevenLabs voice_id per agent.
-- Apply with: psql "$DATABASE_URL" -f specs/schema/voice-cloning.sql

ALTER TABLE agent_identities
	ADD COLUMN IF NOT EXISTS voice_provider   text DEFAULT 'browser',
	ADD COLUMN IF NOT EXISTS voice_id         text,
	ADD COLUMN IF NOT EXISTS voice_cloned_at  timestamptz;
