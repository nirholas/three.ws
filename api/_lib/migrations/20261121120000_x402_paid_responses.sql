-- x402 paid-response store: the full response of every x402 call the platform
-- paid for, kept for our own accounting and for reuse of the data we bought.
--
-- Before this table the loop threw the data away. The ring tick recorded only an
-- HTTP status and a liveness summary in x402_autonomous_log, and the fresh-workers
-- lane kept a trimmed copy (40 items, 60 KB) in x402_data_desk. payX402 now writes
-- every paid response here before it returns, so no pipeline can skip it.
--
-- Two tables:
--   x402_paid_response_bodies  content-addressed bodies (sha256 of the canonical
--                              JSON text). The ring buys the same dataset many
--                              times a day and much of it is identical between
--                              calls, so each distinct body is stored once.
--   x402_paid_responses        one row per paid call: the receipt (tx signature,
--                              payer, wallet kind, amount, asset) plus a pointer to
--                              its body.
--
-- Bodies up to 1 MB live inline as jsonb. A larger body goes to object storage
-- (R2, with the GCS failover) under x402-paid/<sha[0:2]>/<sha>.json and the row
-- keeps the key; if that upload fails the body is stored inline instead.
--
-- Rows are never deleted: the guard trigger below refuses DELETE and TRUNCATE,
-- and refuses any change to a body once written.

CREATE TABLE IF NOT EXISTS x402_paid_response_bodies (
	sha256         text PRIMARY KEY,
	bytes          integer NOT NULL,
	content_type   text NOT NULL DEFAULT 'application/json',
	body           jsonb,
	object_key     text,
	first_seen_at  timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT x402_paid_response_bodies_has_body CHECK (body IS NOT NULL OR object_key IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS x402_paid_responses (
	id               bigserial PRIMARY KEY,
	created_at       timestamptz NOT NULL DEFAULT now(),
	tx_sig           text UNIQUE,
	pipeline         text NOT NULL,
	endpoint_key     text,
	url              text NOT NULL,
	endpoint_path    text NOT NULL,
	method           text NOT NULL,
	request_body     jsonb,
	status           integer NOT NULL,
	payer            text,
	wallet_kind      text NOT NULL DEFAULT 'unknown',
	fresh_wallet_id  bigint,
	amount_atomic    bigint NOT NULL DEFAULT 0,
	asset            text,
	network          text NOT NULL DEFAULT 'solana:mainnet',
	body_sha256      text NOT NULL REFERENCES x402_paid_response_bodies (sha256),
	bytes            integer NOT NULL,
	run_id           text,
	duration_ms      integer
);

CREATE INDEX IF NOT EXISTS x402_paid_responses_created ON x402_paid_responses (created_at DESC);
CREATE INDEX IF NOT EXISTS x402_paid_responses_endpoint ON x402_paid_responses (endpoint_path, created_at DESC);
CREATE INDEX IF NOT EXISTS x402_paid_responses_payer ON x402_paid_responses (payer);
CREATE INDEX IF NOT EXISTS x402_paid_responses_pipeline ON x402_paid_responses (pipeline, created_at DESC);

CREATE OR REPLACE FUNCTION x402_paid_data_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'paid x402 data is never deleted (% on %)', TG_OP, TG_TABLE_NAME;
	END IF;
	IF TG_TABLE_NAME = 'x402_paid_response_bodies' THEN
		IF NEW.sha256 IS DISTINCT FROM OLD.sha256
			OR NEW.body IS DISTINCT FROM OLD.body
			OR NEW.object_key IS DISTINCT FROM OLD.object_key THEN
			RAISE EXCEPTION 'a stored paid response body is immutable (%)', OLD.sha256;
		END IF;
	ELSIF NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256 OR NEW.tx_sig IS DISTINCT FROM OLD.tx_sig THEN
		RAISE EXCEPTION 'a paid response receipt is immutable (id %)', OLD.id;
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS x402_paid_response_bodies_guard ON x402_paid_response_bodies;
CREATE TRIGGER x402_paid_response_bodies_guard
	BEFORE UPDATE OR DELETE ON x402_paid_response_bodies
	FOR EACH ROW EXECUTE FUNCTION x402_paid_data_guard();

DROP TRIGGER IF EXISTS x402_paid_response_bodies_truncate ON x402_paid_response_bodies;
CREATE TRIGGER x402_paid_response_bodies_truncate
	BEFORE TRUNCATE ON x402_paid_response_bodies
	FOR EACH STATEMENT EXECUTE FUNCTION x402_paid_data_guard();

DROP TRIGGER IF EXISTS x402_paid_responses_guard ON x402_paid_responses;
CREATE TRIGGER x402_paid_responses_guard
	BEFORE UPDATE OR DELETE ON x402_paid_responses
	FOR EACH ROW EXECUTE FUNCTION x402_paid_data_guard();

DROP TRIGGER IF EXISTS x402_paid_responses_truncate ON x402_paid_responses;
CREATE TRIGGER x402_paid_responses_truncate
	BEFORE TRUNCATE ON x402_paid_responses
	FOR EACH STATEMENT EXECUTE FUNCTION x402_paid_data_guard();

COMMENT ON TABLE x402_paid_responses IS
	'One row per paid x402 call: receipt (tx, payer, wallet kind, amount) plus a pointer to its full body. Written by payX402 before it returns. Never deleted.';
COMMENT ON TABLE x402_paid_response_bodies IS
	'Content-addressed full bodies of paid x402 responses (sha256 of canonical JSON). Inline up to 1 MB, else object storage. Immutable, never deleted.';
