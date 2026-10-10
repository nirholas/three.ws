-- Durable record of every EVM launch (paired and Uniswap lanes).
--
-- A launch signs several things and takes seconds to minutes, so a client that
-- times out used to have no way to learn whether the coin exists. Each launch
-- now writes one row before anything is signed. The row carries the stages the
-- launch has passed, the transaction hash once sent, and the finished result.
-- GET /api/launches/:id reads it and settles a launch whose transaction landed
-- after the request that sent it went away.
--
-- `idempotency_key` is the client's Idempotency-Key header. Together with the
-- caller it is unique, and `fingerprint` (sha256 of the lane and request body)
-- lets a retry with the same key return the same row while the same key with a
-- different body is refused. Rows without a key are still recorded.
--
-- Service layer: api/_lib/evm-launch-records.js.

CREATE TABLE IF NOT EXISTS evm_launch_records (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	agent_id uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	lane text NOT NULL,
	chain text NOT NULL,
	idempotency_key text,
	fingerprint text NOT NULL,
	status text NOT NULL DEFAULT 'pending'
		CHECK (status IN ('pending', 'submitted', 'confirmed', 'finalized', 'failed')),
	stages jsonb NOT NULL DEFAULT '[]'::jsonb,
	tx_hash text,
	context jsonb NOT NULL DEFAULT '{}'::jsonb,
	token text,
	result jsonb,
	error jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS evm_launch_records_user_key
	ON evm_launch_records (user_id, idempotency_key)
	WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS evm_launch_records_user_created
	ON evm_launch_records (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS evm_launch_records_open
	ON evm_launch_records (updated_at)
	WHERE status IN ('pending', 'submitted', 'confirmed');
