-- x402 wallet custody: no wallet the loop creates can ever be lost.
--
-- The loop mints two kinds of custodial Solana wallets: the reused payer pool
-- (x402_ring_pool) and the one-shot fresh wallets (x402_fresh_wallets). Until now
-- their keys were safe only by convention, and recoverable only one way: the
-- secret-box ciphertext under WALLET_ENCRYPTION_KEY. A key change during the 2026-07
-- Cloud Run move already destroyed custody of 8 custodial wallets that way.
--
-- This migration makes custody a database guarantee:
--
-- 1. backup_secret: a second, independent sealed copy of each key, wrapped by a
--    Cloud KMS key (X402_WALLET_BACKUP_KMS_KEY) instead of an env string. Either
--    copy alone recovers the wallet. The daily custody audit backfills it for
--    every wallet minted before the column existed.
-- 2. custody_verified_at: when the audit last proved, by decrypting, that both
--    copies open to the row's own pubkey.
-- 3. A guard trigger on both tables that refuses DELETE and TRUNCATE, refuses any
--    change to a pubkey, refuses blanking a key, and copies the old ciphertext
--    into x402_wallet_key_history whenever a key is re-sealed (so
--    scripts/reseal-custodial-wallets.mjs keeps working and loses nothing).
-- 4. x402_wallet_key_history is itself append-only.

ALTER TABLE x402_fresh_wallets ADD COLUMN IF NOT EXISTS backup_secret text;
ALTER TABLE x402_fresh_wallets ADD COLUMN IF NOT EXISTS custody_verified_at timestamptz;
ALTER TABLE x402_ring_pool ADD COLUMN IF NOT EXISTS backup_secret text;
ALTER TABLE x402_ring_pool ADD COLUMN IF NOT EXISTS custody_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS x402_wallet_key_history (
	id                bigserial PRIMARY KEY,
	wallet_table      text NOT NULL,
	pubkey            text NOT NULL,
	column_name       text NOT NULL,
	old_ciphertext    text NOT NULL,
	replaced_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS x402_wallet_key_history_pubkey ON x402_wallet_key_history (pubkey, replaced_at DESC);

CREATE OR REPLACE FUNCTION x402_wallet_key_history_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'x402_wallet_key_history is append-only (% refused)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS x402_wallet_key_history_immutable ON x402_wallet_key_history;
CREATE TRIGGER x402_wallet_key_history_immutable
	BEFORE UPDATE OR DELETE ON x402_wallet_key_history
	FOR EACH ROW EXECUTE FUNCTION x402_wallet_key_history_guard();

DROP TRIGGER IF EXISTS x402_wallet_key_history_truncate ON x402_wallet_key_history;
CREATE TRIGGER x402_wallet_key_history_truncate
	BEFORE TRUNCATE ON x402_wallet_key_history
	FOR EACH STATEMENT EXECUTE FUNCTION x402_wallet_key_history_guard();

CREATE OR REPLACE FUNCTION x402_wallet_custody_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'custodial wallet rows are never deleted (% on %)', TG_OP, TG_TABLE_NAME;
	END IF;
	IF NEW.pubkey IS DISTINCT FROM OLD.pubkey THEN
		RAISE EXCEPTION 'a custodial wallet pubkey never changes (% on %)', OLD.pubkey, TG_TABLE_NAME;
	END IF;
	IF NEW.encrypted_secret IS NULL OR length(NEW.encrypted_secret) = 0 THEN
		RAISE EXCEPTION 'a custodial wallet key cannot be blanked (%)', OLD.pubkey;
	END IF;
	IF OLD.backup_secret IS NOT NULL AND (NEW.backup_secret IS NULL OR length(NEW.backup_secret) = 0) THEN
		RAISE EXCEPTION 'a custodial wallet backup key cannot be blanked (%)', OLD.pubkey;
	END IF;
	IF NEW.encrypted_secret IS DISTINCT FROM OLD.encrypted_secret THEN
		INSERT INTO x402_wallet_key_history (wallet_table, pubkey, column_name, old_ciphertext)
		VALUES (TG_TABLE_NAME, OLD.pubkey, 'encrypted_secret', OLD.encrypted_secret);
	END IF;
	IF OLD.backup_secret IS NOT NULL AND NEW.backup_secret IS DISTINCT FROM OLD.backup_secret THEN
		INSERT INTO x402_wallet_key_history (wallet_table, pubkey, column_name, old_ciphertext)
		VALUES (TG_TABLE_NAME, OLD.pubkey, 'backup_secret', OLD.backup_secret);
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS x402_fresh_wallets_custody ON x402_fresh_wallets;
CREATE TRIGGER x402_fresh_wallets_custody
	BEFORE UPDATE OR DELETE ON x402_fresh_wallets
	FOR EACH ROW EXECUTE FUNCTION x402_wallet_custody_guard();

DROP TRIGGER IF EXISTS x402_fresh_wallets_custody_truncate ON x402_fresh_wallets;
CREATE TRIGGER x402_fresh_wallets_custody_truncate
	BEFORE TRUNCATE ON x402_fresh_wallets
	FOR EACH STATEMENT EXECUTE FUNCTION x402_wallet_custody_guard();

DROP TRIGGER IF EXISTS x402_ring_pool_custody ON x402_ring_pool;
CREATE TRIGGER x402_ring_pool_custody
	BEFORE UPDATE OR DELETE ON x402_ring_pool
	FOR EACH ROW EXECUTE FUNCTION x402_wallet_custody_guard();

DROP TRIGGER IF EXISTS x402_ring_pool_custody_truncate ON x402_ring_pool;
CREATE TRIGGER x402_ring_pool_custody_truncate
	BEFORE TRUNCATE ON x402_ring_pool
	FOR EACH STATEMENT EXECUTE FUNCTION x402_wallet_custody_guard();

COMMENT ON TABLE x402_wallet_key_history IS
	'Append-only archive of every custodial x402 wallet ciphertext that was ever replaced (re-seal, backup rotation). Never updated or deleted.';
