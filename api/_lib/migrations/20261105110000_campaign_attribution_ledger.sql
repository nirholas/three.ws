-- First-party campaign attribution. A visitor who lands on a page with a valid
-- marketing campaign tag (utm_campaign or c=, ids from marketing/growth/campaigns.csv)
-- records one first touch; later signups, agent creations, forge generations and
-- paid calls made in the same browser are written as conversions against it.
--
-- Privacy: no IP, no user agent, no referrer, no query string. The landing path is
-- the pathname only. anon_id is a random id the browser generated; it is unique so
-- a second visit with a different campaign can never replace the first touch.

CREATE TABLE IF NOT EXISTS campaign_touches (
	id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	anon_id       UUID NOT NULL UNIQUE,
	campaign      TEXT NOT NULL,
	source        TEXT,
	medium        TEXT,
	landing_path  TEXT NOT NULL,
	created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_touches_campaign_time ON campaign_touches (campaign, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_conversions (
	id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	touch_id    UUID NOT NULL REFERENCES campaign_touches(id) ON DELETE CASCADE,
	user_id     UUID,
	event       TEXT NOT NULL CHECK (event IN ('signup', 'agent_created', 'forge_generation', 'paid_call')),
	created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_conversions_touch ON campaign_conversions (touch_id, event);
CREATE INDEX IF NOT EXISTS campaign_conversions_time ON campaign_conversions (created_at DESC);
-- A person signs up once; every other event may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_conversions_signup_once
	ON campaign_conversions (user_id) WHERE event = 'signup' AND user_id IS NOT NULL;
