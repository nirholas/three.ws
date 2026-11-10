-- Robinhood Crypto connector: an owner's own Crypto Trading API credential,
-- their spend caps, and a ledger of every order preview and placement.
--
-- Crypto pairs only (BTC-USD and the like). The API key and the Ed25519
-- private key are stored only as secret-box ciphertext (api/_lib/secret-box.js)
-- and never leave the server; public_key_b64 is the half the owner registered
-- with Robinhood and is safe to show back to them.
--
-- Spend caps bound BUY orders. A buy counts against today's (UTC) cap from the
-- moment it is reserved ('submitting') and keeps counting once 'placed', and
-- also while 'unknown' (Robinhood did not answer, so the order may exist).
-- Reservation happens under a per-user advisory lock (api/_lib/locked-sql.js),
-- so two concurrent orders cannot both fit into the last dollar of the cap.

CREATE TABLE IF NOT EXISTS robinhood_crypto_connections (
	user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	api_key_enc          text NOT NULL,
	private_key_enc      text NOT NULL,
	api_key_hint         text NOT NULL,
	public_key_b64       text NOT NULL,
	account_number       text,
	per_order_cap_usd    numeric(12, 2) NOT NULL DEFAULT 25,
	daily_cap_usd        numeric(12, 2) NOT NULL DEFAULT 100,
	trading_enabled      boolean NOT NULL DEFAULT true,
	last_verified_at     timestamptz,
	created_at           timestamptz NOT NULL DEFAULT now(),
	updated_at           timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT robinhood_crypto_caps_positive CHECK (per_order_cap_usd > 0 AND daily_cap_usd > 0),
	CONSTRAINT robinhood_crypto_caps_ordered CHECK (per_order_cap_usd <= daily_cap_usd)
);

CREATE TABLE IF NOT EXISTS robinhood_crypto_orders (
	id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	client_order_id      uuid NOT NULL UNIQUE,
	symbol               text NOT NULL,
	side                 text NOT NULL CHECK (side IN ('buy', 'sell')),
	order_type           text NOT NULL CHECK (order_type IN ('market', 'limit')),
	asset_quantity       numeric(38, 18) NOT NULL CHECK (asset_quantity > 0),
	limit_price          numeric(38, 18),
	est_price_usd        numeric(38, 18) NOT NULL,
	notional_usd         numeric(14, 2) NOT NULL CHECK (notional_usd > 0),
	status               text NOT NULL DEFAULT 'previewed'
		CHECK (status IN ('previewed', 'submitting', 'placed', 'unknown', 'failed', 'expired')),
	source               text NOT NULL,
	robinhood_order_id   text,
	robinhood_state      text,
	error_code           text,
	error_message        text,
	preview_expires_at   timestamptz NOT NULL,
	reserved_at          timestamptz,
	placed_at            timestamptz,
	created_at           timestamptz NOT NULL DEFAULT now(),
	updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS robinhood_crypto_orders_user_recent ON robinhood_crypto_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS robinhood_crypto_orders_user_spend
	ON robinhood_crypto_orders (user_id, reserved_at)
	WHERE side = 'buy' AND status IN ('submitting', 'placed', 'unknown');
