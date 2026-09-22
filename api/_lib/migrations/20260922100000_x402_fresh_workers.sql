-- x402 fresh-wallet workers: one brand-new Solana wallet per paid job.
--
-- The ring's payer pool reuses wallets to amortize USDC-ATA rent. This lane does
-- the opposite on purpose: every job is bought by a wallet that never existed on
-- chain before, and the wallet is emptied and its token account closed the moment
-- the job is done, so the rent it borrowed goes straight back to the funder. Net
-- cost per job is three base transaction fees; nothing strands.
--
-- Each row is one wallet's whole life:
--   minted -> funded -> paid | pay_failed -> closed
--                    \-> sweep_failed (retried) -> stranded (alerted)
--   fund_failed is terminal and moved no money.
--
-- The key is secret-box encrypted (WALLET_ENCRYPTION_KEY) exactly like the payer
-- pool and custodial agent wallets. Rows are never deleted: the pubkey history is
-- what lets the on-chain leak scanner classify the funding leg as internal.

CREATE TABLE IF NOT EXISTS x402_fresh_wallets (
	id                      bigserial PRIMARY KEY,
	pubkey                  text NOT NULL UNIQUE,
	usdc_ata                text NOT NULL,
	encrypted_secret        text NOT NULL,
	state                   text NOT NULL DEFAULT 'minted',
	job_kind                text NOT NULL,                  -- 'forge' | 'data'
	job_slug                text NOT NULL,                  -- ring-catalog slug the wallet buys
	job_title               text,
	sol_funded_lamports     bigint NOT NULL DEFAULT 0,
	usdc_funded_atomic      bigint NOT NULL DEFAULT 0,
	fund_sig                text,
	pay_sig                 text,
	amount_atomic           bigint NOT NULL DEFAULT 0,      -- USDC the job actually cost
	sweep_sig               text,
	sol_reclaimed_lamports  bigint NOT NULL DEFAULT 0,
	usdc_returned_atomic    bigint NOT NULL DEFAULT 0,
	rent_reclaimed_lamports bigint NOT NULL DEFAULT 0,
	attempts                int NOT NULL DEFAULT 0,
	error                   text,
	run_id                  uuid,
	created_at              timestamptz NOT NULL DEFAULT now(),
	updated_at              timestamptz NOT NULL DEFAULT now(),
	funded_at               timestamptz,
	paid_at                 timestamptz,
	closed_at               timestamptz
);

CREATE INDEX IF NOT EXISTS x402_fresh_wallets_state_updated ON x402_fresh_wallets (state, updated_at);
CREATE INDEX IF NOT EXISTS x402_fresh_wallets_created ON x402_fresh_wallets (created_at DESC);

COMMENT ON TABLE x402_fresh_wallets IS
	'One row per throwaway payer wallet in the x402 fresh-workers lane: minted, funded, pays one useful job, swept back and closed. Secrets secret-box encrypted.';

-- The data desk: what the fresh wallets bought from the paid market-data and
-- intel endpoints, kept so the site can show it with the receipt attached. One
-- row per purchase; the public feed reads the newest row per slug.
CREATE TABLE IF NOT EXISTS x402_data_desk (
	id             bigserial PRIMARY KEY,
	ts             timestamptz NOT NULL DEFAULT now(),
	slug           text NOT NULL,
	title          text NOT NULL,
	endpoint_path  text NOT NULL,
	payload        jsonb NOT NULL,
	payer          text,
	tx_sig         text,
	amount_atomic  bigint NOT NULL DEFAULT 0,
	run_id         uuid,
	wallet_id      bigint
);

CREATE INDEX IF NOT EXISTS x402_data_desk_slug_ts ON x402_data_desk (slug, ts DESC);
CREATE INDEX IF NOT EXISTS x402_data_desk_ts ON x402_data_desk (ts DESC);

COMMENT ON TABLE x402_data_desk IS
	'Datasets bought over x402 by fresh worker wallets, with payer, price and settlement signature. Served by /api/data-desk and rendered at /data-desk.';
