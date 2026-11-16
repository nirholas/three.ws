-- Admin two-factor rule (api/_lib/admin-mfa.js): an admin request needs a
-- session that passed a second factor. The factor itself is account two-step
-- verification (20261116150441_account_mfa.sql, which adds the same column);
-- this guarantees the column the admin gates read exists even when this
-- migration is applied first. Idempotent and additive.

alter table sessions add column if not exists mfa_verified_at timestamptz;
