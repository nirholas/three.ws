-- Agent cards: gift cards and prepaid cards an agent buys from its own wallet.
--
-- One row per card, from the quote through delivery. A quote IS a card row in
-- status 'quoted' so the confirm step can only ever settle the exact price and
-- address the owner was shown, and only while the quote is fresh.
--
--   quoted -> paying -> processing -> delivered
--         \-> expired | cancelled        \-> failed | refunded
--   any live state -> needs_verification (provider wants identity steps)
--
-- The redemption secret (card number, PIN, code, link) is never stored in
-- plaintext. It is secret-box encrypted (WALLET_ENCRYPTION_KEY, the same scheme
-- as custodial wallet keys) from delivery until the first confirmed reveal, and
-- the ciphertext is cleared by that reveal. Service layer: api/_lib/cards/.

CREATE TABLE IF NOT EXISTS agent_cards (
	id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id             uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	provider             text NOT NULL,
	mode                 text NOT NULL CHECK (mode IN ('sandbox', 'live')),
	kind                 text NOT NULL DEFAULT 'gift_card' CHECK (kind IN ('gift_card', 'prepaid_card')),
	product_id           text NOT NULL,
	product_name         text NOT NULL,
	merchant             text NOT NULL,
	country_code         text,
	image_url            text,
	face_value           numeric(20, 6) NOT NULL CHECK (face_value > 0),
	currency             text NOT NULL,
	status               text NOT NULL DEFAULT 'quoted'
		CHECK (status IN ('quoted', 'paying', 'processing', 'delivered', 'failed', 'refunded',
		                  'cancelled', 'expired', 'needs_verification')),
	-- The price-locked quote the owner confirmed.
	quote_total_usdc     numeric(20, 6) NOT NULL DEFAULT 0,
	quote_total_atomic   bigint NOT NULL DEFAULT 0,
	quote_fee_usdc       numeric(20, 6) NOT NULL DEFAULT 0,
	quote_expires_at     timestamptz NOT NULL,
	pay_network          text NOT NULL DEFAULT 'mainnet',
	pay_address          text,
	-- Provider handles.
	provider_invoice_id  text,
	provider_order_id    text,
	provider_status      text,
	-- Settlement.
	custody_event_id     bigint,
	pay_signature        text,
	-- Card data. Only the masked form and the list of secret fields are kept.
	masked_number        text,
	secret_fields        text[] NOT NULL DEFAULT '{}',
	secret_enc           text,
	redeem_instructions  text,
	expires_on           text,
	revealed_at          timestamptz,
	reveal_count         int NOT NULL DEFAULT 0,
	error_code           text,
	error_message        text,
	meta                 jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at           timestamptz NOT NULL DEFAULT now(),
	updated_at           timestamptz NOT NULL DEFAULT now(),
	delivered_at         timestamptz
);

CREATE INDEX IF NOT EXISTS agent_cards_agent_idx ON agent_cards (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_cards_open_idx ON agent_cards (status, updated_at)
	WHERE status IN ('paying', 'processing', 'needs_verification');
CREATE UNIQUE INDEX IF NOT EXISTS agent_cards_provider_invoice_uq ON agent_cards (provider, provider_invoice_id)
	WHERE provider_invoice_id IS NOT NULL;

-- Append-only audit of everything that happens to a card: status changes, the
-- reveal previews (single-use grants), reveals and refused reveals, each with
-- the actor and time. Never holds a secret.
CREATE TABLE IF NOT EXISTS agent_card_events (
	id                   bigserial PRIMARY KEY,
	card_id              uuid NOT NULL REFERENCES agent_cards(id) ON DELETE CASCADE,
	agent_id             uuid NOT NULL,
	actor_user_id        uuid,
	actor_kind           text NOT NULL DEFAULT 'system',
	event                text NOT NULL,
	from_status          text,
	to_status            text,
	-- Reveal grants: sha256 of the single-use preview id, its expiry, and when it
	-- was spent. A grant can be consumed exactly once.
	grant_hash           text,
	grant_expires_at     timestamptz,
	grant_consumed_at    timestamptz,
	ip                   text,
	detail               jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_card_events_card_idx ON agent_card_events (card_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agent_card_events_grant_uq ON agent_card_events (grant_hash)
	WHERE grant_hash IS NOT NULL;

-- Prepaid balances moved back to USDC, for providers that support it.
CREATE TABLE IF NOT EXISTS agent_card_withdrawals (
	id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	card_id              uuid NOT NULL REFERENCES agent_cards(id) ON DELETE CASCADE,
	agent_id             uuid NOT NULL,
	user_id              uuid NOT NULL,
	provider             text NOT NULL,
	amount               numeric(20, 6) NOT NULL CHECK (amount > 0),
	currency             text NOT NULL,
	usdc_amount          numeric(20, 6),
	destination          text NOT NULL,
	status               text NOT NULL DEFAULT 'requested'
		CHECK (status IN ('requested', 'processing', 'completed', 'failed')),
	provider_ref         text,
	signature            text,
	error_message        text,
	created_at           timestamptz NOT NULL DEFAULT now(),
	updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_card_withdrawals_card_idx ON agent_card_withdrawals (card_id, created_at DESC);
