-- Self-funded inference: an agent pays for its own model usage from its wallet.
--
-- Three pieces of state, all owned by api/_lib/inference-billing.js and
-- api/_lib/inference-topup.js:
--
--   inference_topups   one row per wallet-funded credit top-up. A row is born as
--                      a preview (the exact recipient, amount and credits the
--                      owner is asked to confirm) and is single-use: execution
--                      flips it previewed -> executing -> settled | pending |
--                      failed, so a preview_id can never move money twice.
--                      Previews expire ten minutes after they are created.
--                      Rows written by an armed wallet intent (source 'intent')
--                      skip the preview state and are born 'executing'.
--   inference_keys     API keys minted by POST /api/me/inference/provision. The
--                      key itself lives in api_keys (scope 'inference'); this
--                      row binds it to the agent whose wallet funded it, so its
--                      model calls count against that agent's inference budget.
--   credit_ledger      unchanged schema. Inference spends are ordinary 'spend'
--                      rows with action 'inference.agent' and ref_type 'agent', so the
--                      per-agent budget sums come from the same ledger the
--                      balance does. The partial index below keeps that sum an
--                      index scan.

CREATE TABLE IF NOT EXISTS inference_topups (
	id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	agent_id           uuid NOT NULL,
	source             text NOT NULL DEFAULT 'owner',       -- owner | provision | intent
	status             text NOT NULL DEFAULT 'previewed',   -- previewed | executing | pending | settled | failed | expired
	amount_usdc        numeric(20, 6) NOT NULL,
	credits_usd        numeric(20, 6) NOT NULL,             -- amount_usdc * published rate, no fee
	payer_address      text NOT NULL,                       -- the agent's custodial Solana wallet
	pay_to             text NOT NULL,                       -- platform treasury (self-facilitator allowlist)
	network            text NOT NULL DEFAULT 'mainnet',
	signature          text,
	custody_event_id   bigint,
	ledger_id          uuid,
	api_key_id         uuid,                                -- provision only: the key minted after settlement
	intent_id          uuid,                                -- intent only: the rule that fired
	error              text,
	idempotency_key    text,                                -- intent fires: one top-up per (intent, window)
	created_at         timestamptz NOT NULL DEFAULT now(),
	expires_at         timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
	executed_at        timestamptz,
	settled_at         timestamptz,
	CONSTRAINT inference_topups_status_chk
		CHECK (status IN ('previewed', 'executing', 'pending', 'settled', 'failed', 'expired')),
	CONSTRAINT inference_topups_source_chk
		CHECK (source IN ('owner', 'provision', 'intent')),
	CONSTRAINT inference_topups_amount_chk CHECK (amount_usdc > 0)
);

CREATE INDEX IF NOT EXISTS inference_topups_user_created
	ON inference_topups (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inference_topups_agent_created
	ON inference_topups (agent_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS inference_topups_idem
	ON inference_topups (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inference_topups_signature
	ON inference_topups (signature) WHERE signature IS NOT NULL;

CREATE TABLE IF NOT EXISTS inference_keys (
	api_key_id   uuid PRIMARY KEY,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	agent_id     uuid NOT NULL,
	topup_id     uuid REFERENCES inference_topups(id),
	created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inference_keys_user ON inference_keys (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS credit_ledger_inference_agent
	ON credit_ledger (ref_id, created_at DESC)
	WHERE action = 'inference.agent' AND ref_type = 'agent';
