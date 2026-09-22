-- Bounty feed and the three.ws Build program.
--
-- bounty_listings is the aggregated, normalized feed of open bounties, tasks,
-- hackathons and grants across public sources (api/_lib/bounties/sources/),
-- refreshed by /api/cron/bounties-refresh and triaged by an LLM. It is named
-- apart from `bounties`, which is the /go community board's own table.
--
-- The program_* tables back three.ws Build: rounds with a prize pool, agent
-- submissions, a leaderboard the economy cron recomputes, and payouts that
-- stop at an owner confirmation before anything is signed.

-- ── bounty feed ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bounty_listings (
	id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	source             text NOT NULL,
	external_id        text NOT NULL,
	kind               text NOT NULL DEFAULT 'bounty'
		CHECK (kind IN ('bounty', 'project', 'hackathon', 'grant', 'task')),
	title              text NOT NULL,
	summary            text,
	body               text,
	url                text NOT NULL,
	venue              text NOT NULL,
	venue_url          text,
	sponsor            text,
	sponsor_logo       text,
	reward_amount      numeric(24, 6),
	reward_max         numeric(24, 6),
	reward_currency    text,
	reward_usd         numeric(20, 2),
	deadline           timestamptz,
	requirements       text[] NOT NULL DEFAULT '{}',
	skills             text[] NOT NULL DEFAULT '{}',
	agent_eligible     boolean,
	submit_mode        text NOT NULL DEFAULT 'checklist' CHECK (submit_mode IN ('api', 'checklist')),
	status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
	submissions_count  int,
	program_round_id   uuid,
	content_hash       text NOT NULL,
	triage             jsonb,
	triage_hash        text,
	triage_model       text,
	triaged_at         timestamptz,
	raw                jsonb NOT NULL DEFAULT '{}'::jsonb,
	first_seen_at      timestamptz NOT NULL DEFAULT now(),
	last_seen_at       timestamptz NOT NULL DEFAULT now(),
	updated_at         timestamptz NOT NULL DEFAULT now(),
	UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS bounty_listings_open_idx ON bounty_listings (status, deadline) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS bounty_listings_reward_idx ON bounty_listings (reward_usd DESC NULLS LAST) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS bounty_listings_untriaged_idx ON bounty_listings (first_seen_at DESC)
	WHERE status = 'open' AND triage_hash IS DISTINCT FROM content_hash;

-- A run an agent started to work a bounty, with the plan it was given.
CREATE TABLE IF NOT EXISTS bounty_runs (
	id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	listing_id   uuid NOT NULL REFERENCES bounty_listings(id) ON DELETE CASCADE,
	run_id       uuid NOT NULL,
	agent_id     uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	plan         jsonb NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bounty_runs_listing_idx ON bounty_runs (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bounty_runs_user_idx ON bounty_runs (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS bounty_runs_run_uidx ON bounty_runs (run_id);

-- An agent's account on a venue that takes submissions over an API. The venue
-- key is sealed with the platform secret box; the claim code is what the human
-- owner redeems on the venue to collect a payout.
CREATE TABLE IF NOT EXISTS bounty_venue_accounts (
	agent_id           uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	venue              text NOT NULL,
	user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	external_agent_id  text,
	username           text,
	api_key_enc        text NOT NULL,
	claim_code         text,
	created_at         timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (agent_id, venue)
);

-- The confirmation a submission preview issued. The submit call must cite it,
-- for the same listing, agent and payload, within ten minutes, exactly once.
CREATE TABLE IF NOT EXISTS bounty_submit_previews (
	id           text PRIMARY KEY,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	listing_id   uuid NOT NULL REFERENCES bounty_listings(id) ON DELETE CASCADE,
	agent_id     uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	params_hash  text NOT NULL,
	payload      jsonb NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	consumed_at  timestamptz
);

-- Every submission an agent sent to a venue.
CREATE TABLE IF NOT EXISTS bounty_submissions_out (
	id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	listing_id    uuid NOT NULL REFERENCES bounty_listings(id) ON DELETE CASCADE,
	agent_id      uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	venue         text NOT NULL,
	status        text NOT NULL CHECK (status IN ('submitted', 'failed')),
	external_ref  text,
	payload       jsonb NOT NULL,
	response      jsonb,
	error         text,
	created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bounty_submissions_out_agent_idx ON bounty_submissions_out (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bounty_submissions_out_listing_idx ON bounty_submissions_out (listing_id);

-- ── three.ws Build program ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_rounds (
	id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	slug                   text NOT NULL UNIQUE,
	title                  text NOT NULL,
	tagline                text,
	description            text NOT NULL DEFAULT '',
	status                 text NOT NULL DEFAULT 'draft'
		CHECK (status IN ('draft', 'open', 'judging', 'closed')),
	starts_at              timestamptz NOT NULL,
	ends_at                timestamptz NOT NULL,
	judging_ends_at        timestamptz,
	prize_pool             jsonb NOT NULL DEFAULT '[]'::jsonb,
	tracks                 jsonb NOT NULL DEFAULT '[]'::jsonb,
	criteria               jsonb NOT NULL DEFAULT '[]'::jsonb,
	sponsors               jsonb NOT NULL DEFAULT '[]'::jsonb,
	buyback_bps            int NOT NULL DEFAULT 5000 CHECK (buyback_bps BETWEEN 0 AND 10000),
	fee_revenue_usd        numeric(20, 6) NOT NULL DEFAULT 0,
	participants           int NOT NULL DEFAULT 0,
	stats_computed_at      timestamptz,
	created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
	opened_at              timestamptz,
	created_at             timestamptz NOT NULL DEFAULT now(),
	updated_at             timestamptz NOT NULL DEFAULT now(),
	CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS program_rounds_status_idx ON program_rounds (status, starts_at DESC);

CREATE TABLE IF NOT EXISTS program_submissions (
	id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	round_id      uuid NOT NULL REFERENCES program_rounds(id) ON DELETE CASCADE,
	track_id      text NOT NULL,
	agent_id      uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title         text NOT NULL,
	summary       text NOT NULL,
	repo_url      text,
	demo_url      text,
	launch_mint   text,
	status        text NOT NULL DEFAULT 'submitted'
		CHECK (status IN ('submitted', 'shortlisted', 'winner', 'rejected', 'withdrawn')),
	score         numeric(6, 2),
	judge_notes   text,
	placement     int,
	prize         jsonb,
	created_at    timestamptz NOT NULL DEFAULT now(),
	updated_at    timestamptz NOT NULL DEFAULT now(),
	UNIQUE (round_id, track_id, agent_id)
);
CREATE INDEX IF NOT EXISTS program_submissions_round_idx ON program_submissions (round_id, status);
CREATE INDEX IF NOT EXISTS program_submissions_user_idx ON program_submissions (user_id, created_at DESC);

-- Activity metrics per participating agent inside a round's window, rewritten
-- by /api/cron/build-leaderboard (an economy-tick target).
CREATE TABLE IF NOT EXISTS program_leaderboard (
	round_id         uuid NOT NULL REFERENCES program_rounds(id) ON DELETE CASCADE,
	agent_id         uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	volume_usd       numeric(20, 6) NOT NULL DEFAULT 0,
	calls_served     int NOT NULL DEFAULT 0,
	launches         int NOT NULL DEFAULT 0,
	fee_revenue_usd  numeric(20, 6) NOT NULL DEFAULT 0,
	score            numeric(12, 4) NOT NULL DEFAULT 0,
	rank             int NOT NULL,
	computed_at      timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (round_id, agent_id)
);
CREATE INDEX IF NOT EXISTS program_leaderboard_rank_idx ON program_leaderboard (round_id, rank);

-- Prize payouts and buyback routing. A row is born `pending_confirmation`
-- holding the exact recipient, amount, token and chain; nothing is signed
-- until an admin confirms that row with its confirm token.
CREATE TABLE IF NOT EXISTS program_payouts (
	id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	round_id            uuid NOT NULL REFERENCES program_rounds(id) ON DELETE CASCADE,
	kind                text NOT NULL CHECK (kind IN ('prize', 'buyback')),
	submission_id       uuid REFERENCES program_submissions(id) ON DELETE SET NULL,
	agent_id            uuid REFERENCES agent_identities(id) ON DELETE SET NULL,
	recipient_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
	recipient_address   text NOT NULL,
	recipient_source    text NOT NULL,
	currency            text NOT NULL CHECK (currency IN ('USDC', 'THREE')),
	mint                text NOT NULL,
	decimals            int NOT NULL,
	amount_atomic       numeric(40, 0) NOT NULL CHECK (amount_atomic > 0),
	chain               text NOT NULL DEFAULT 'solana' CHECK (chain = 'solana'),
	status              text NOT NULL DEFAULT 'pending_confirmation'
		CHECK (status IN ('pending_confirmation', 'sending', 'sent', 'failed', 'cancelled')),
	confirm_token       text NOT NULL,
	tx_signature        text,
	error               text,
	created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
	confirmed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at          timestamptz NOT NULL DEFAULT now(),
	confirmed_at        timestamptz,
	sent_at             timestamptz
);
CREATE INDEX IF NOT EXISTS program_payouts_round_idx ON program_payouts (round_id, created_at DESC);
-- One live prize payout per winning submission and currency: a double prepare cannot queue two.
CREATE UNIQUE INDEX IF NOT EXISTS program_payouts_prize_uidx ON program_payouts (submission_id, currency)
	WHERE kind = 'prize' AND status IN ('pending_confirmation', 'sending', 'sent');
-- One live buyback routing per round at a time.
CREATE UNIQUE INDEX IF NOT EXISTS program_payouts_buyback_uidx ON program_payouts (round_id)
	WHERE kind = 'buyback' AND status IN ('pending_confirmation', 'sending');

-- ── runtime changelog entries ────────────────────────────────────────────────
-- Announcements born at runtime (a Build round opening) rather than in the
-- baked data/changelog.json. /api/cron/changelog-push merges these into the
-- community Telegram lane under the same posted-state and pacing.
CREATE TABLE IF NOT EXISTS changelog_runtime_entries (
	id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	entry_date  date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
	title       text NOT NULL,
	summary     text NOT NULL,
	tags        text[] NOT NULL DEFAULT '{feature}',
	link        text,
	source      text NOT NULL,
	source_ref  text,
	created_at  timestamptz NOT NULL DEFAULT now(),
	UNIQUE (source, source_ref)
);
