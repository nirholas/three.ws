-- Migration: the agent commerce layer. Invoices an agent (or its owner) issues
-- and is paid for on-chain, offers an agent lists for other agents to buy, the
-- quotes that sit between "how much" and "yes, pay it", and the owner-gated
-- requests an agent can raise but never approve itself.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261010221500_agent_commerce.sql
-- Idempotent.
--
-- Service layer: api/_lib/agent-commerce/. Routes: /api/agent-commerce/*.
-- MCP tools: api/_mcpagent/commerce-tools.js. Doc: docs/agent-commerce.md.
--
-- agent_commerce_invoices
--   One invoice. `reference` is a fresh Solana public key that the payment
--   transaction must carry (Solana Pay `reference`), and `memo` is the exact
--   memo text the payer's wallet attaches, so the watcher finds the payment by
--   the reference and checks the memo names this invoice.
--   payer_address  null means an open invoice anyone may pay.
--   amount_atomics / paid_atomics  base units of `mint` (lamports for SOL).
--   status         open -> underpaid -> paid, or expired / cancelled. A payment
--                  that lands after due_at still settles the invoice (paid_late).
--   paid_usd       USD value fixed at the moment the invoice became paid, which
--                  is what the earnings ledger reports. Mainnet only counts as
--                  income; devnet invoices are test traffic.
--
-- agent_commerce_invoice_payments
--   Every on-chain transfer the watcher matched to an invoice, one row per
--   signature. `counted` is false for a transfer that carried the reference but
--   a memo naming something else; those never move paid_atomics.
--
-- agent_commerce_invoice_events
--   The invoice timeline the receipt page renders: created, payment, paid,
--   underpaid, expired, cancelled.
--
-- agent_commerce_offers
--   Something an agent sells to other agents at a fixed price. `fulfillment` is
--   what the buyer receives once the payment verifies; it is never served to
--   anyone else.
--
-- agent_commerce_quotes
--   A priced, unexecuted action (a send or a purchase) with a ten-minute life.
--   The confirm call must name the quote id, and a quote executes at most once.
--
-- agent_commerce_orders
--   One purchase of an offer. It is paid through an invoice issued by the
--   seller, so the seller's income lands in the same ledger as every other
--   invoice and the buyer's receipt is that invoice's receipt.
--
-- agent_commerce_requests
--   What an agent asked its owner for: a send to an address outside its
--   allowlist (kind 'send') or a change to its own spending limits (kind
--   'limits'). Only the owner's browser session, with a fresh step-up proof,
--   can approve one. `payload_hash` is the sha256 of the canonical payload the
--   owner was shown; the approve call must echo it.

CREATE TABLE IF NOT EXISTS agent_commerce_invoices (
	id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	number           text NOT NULL UNIQUE,
	user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	agent_id         uuid REFERENCES agent_identities(id) ON DELETE SET NULL,
	created_by       text NOT NULL CHECK (created_by IN ('agent', 'owner')),
	payer_address    text,
	payer_label      text,
	recipient_address text NOT NULL,
	network          text NOT NULL CHECK (network IN ('mainnet', 'devnet')),
	asset            text NOT NULL CHECK (asset IN ('USDC', 'SOL', 'THREE')),
	mint             text NOT NULL,
	decimals         int  NOT NULL CHECK (decimals BETWEEN 0 AND 18),
	amount_atomics   numeric(40, 0) NOT NULL CHECK (amount_atomics > 0),
	paid_atomics     numeric(40, 0) NOT NULL DEFAULT 0,
	memo             text NOT NULL,
	description      text,
	reference        text NOT NULL UNIQUE,
	due_at           timestamptz NOT NULL,
	status           text NOT NULL DEFAULT 'open'
	                 CHECK (status IN ('open', 'underpaid', 'paid', 'expired', 'cancelled')),
	paid_usd         numeric(20, 6),
	paid_at          timestamptz,
	paid_late        boolean NOT NULL DEFAULT false,
	paid_by          text,
	expired_at       timestamptz,
	cancelled_at     timestamptz,
	cancel_reason    text,
	last_checked_at  timestamptz,
	order_id         uuid,
	metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at       timestamptz NOT NULL DEFAULT now(),
	updated_at       timestamptz NOT NULL DEFAULT now()
);

-- The watcher's work queue: everything still waiting for money.
CREATE INDEX IF NOT EXISTS agent_commerce_invoices_watch
	ON agent_commerce_invoices (last_checked_at NULLS FIRST)
	WHERE status IN ('open', 'underpaid');
CREATE INDEX IF NOT EXISTS agent_commerce_invoices_late_watch
	ON agent_commerce_invoices (expired_at)
	WHERE status = 'expired';
CREATE INDEX IF NOT EXISTS agent_commerce_invoices_user
	ON agent_commerce_invoices (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_commerce_invoices_agent
	ON agent_commerce_invoices (agent_id, created_at DESC);
-- The earnings ledger sums paid mainnet invoices per agent.
CREATE INDEX IF NOT EXISTS agent_commerce_invoices_income
	ON agent_commerce_invoices (agent_id, paid_at)
	WHERE status = 'paid' AND network = 'mainnet';

CREATE TABLE IF NOT EXISTS agent_commerce_invoice_payments (
	id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	invoice_id     uuid NOT NULL REFERENCES agent_commerce_invoices(id) ON DELETE CASCADE,
	signature      text NOT NULL UNIQUE,
	payer          text,
	amount_atomics numeric(40, 0) NOT NULL,
	memo           text,
	counted        boolean NOT NULL DEFAULT true,
	reject_reason  text,
	slot           bigint,
	block_time     timestamptz,
	created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_commerce_invoice_payments_invoice
	ON agent_commerce_invoice_payments (invoice_id, block_time);

CREATE TABLE IF NOT EXISTS agent_commerce_invoice_events (
	id          bigserial PRIMARY KEY,
	invoice_id  uuid NOT NULL REFERENCES agent_commerce_invoices(id) ON DELETE CASCADE,
	type        text NOT NULL,
	data        jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_commerce_invoice_events_invoice
	ON agent_commerce_invoice_events (invoice_id, id);

CREATE TABLE IF NOT EXISTS agent_commerce_offers (
	id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id       uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title          text NOT NULL,
	description    text,
	network        text NOT NULL CHECK (network IN ('mainnet', 'devnet')),
	asset          text NOT NULL CHECK (asset IN ('USDC', 'SOL', 'THREE')),
	price_atomics  numeric(40, 0) NOT NULL CHECK (price_atomics > 0),
	fulfillment    text NOT NULL,
	stock          int CHECK (stock IS NULL OR stock >= 0),
	sold_count     int NOT NULL DEFAULT 0,
	status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
	created_at     timestamptz NOT NULL DEFAULT now(),
	updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_commerce_offers_active
	ON agent_commerce_offers (created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS agent_commerce_offers_agent
	ON agent_commerce_offers (agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_commerce_quotes (
	id           text PRIMARY KEY,
	kind         text NOT NULL CHECK (kind IN ('send', 'buy')),
	agent_id     uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	payload      jsonb NOT NULL,
	expires_at   timestamptz NOT NULL,
	consumed_at  timestamptz,
	result       jsonb,
	created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_commerce_quotes_agent
	ON agent_commerce_quotes (agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_commerce_orders (
	id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	offer_id        uuid NOT NULL REFERENCES agent_commerce_offers(id) ON DELETE CASCADE,
	invoice_id      uuid REFERENCES agent_commerce_invoices(id) ON DELETE SET NULL,
	quote_id        text NOT NULL UNIQUE,
	buyer_agent_id  uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	buyer_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	seller_agent_id uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	status          text NOT NULL DEFAULT 'pending'
	                CHECK (status IN ('pending', 'submitted', 'paid', 'failed')),
	signature       text,
	error           text,
	delivered_at    timestamptz,
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_commerce_orders_buyer
	ON agent_commerce_orders (buyer_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_commerce_orders_seller
	ON agent_commerce_orders (seller_agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_commerce_requests (
	id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	kind          text NOT NULL CHECK (kind IN ('send', 'limits')),
	agent_id      uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	payload       jsonb NOT NULL,
	payload_hash  text NOT NULL,
	reason        text,
	summary       text NOT NULL,
	status        text NOT NULL DEFAULT 'pending'
	              CHECK (status IN ('pending', 'approved', 'executed', 'denied', 'expired', 'failed')),
	result        jsonb,
	decided_via   text,
	decided_at    timestamptz,
	expires_at    timestamptz NOT NULL,
	created_at    timestamptz NOT NULL DEFAULT now(),
	updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_commerce_requests_owner
	ON agent_commerce_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_commerce_requests_pending
	ON agent_commerce_requests (agent_id) WHERE status = 'pending';
