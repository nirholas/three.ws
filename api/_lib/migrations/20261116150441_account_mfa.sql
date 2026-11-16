-- Account two-step verification (TOTP authenticator app plus one-time
-- recovery codes), opt-in for every account, and a per-team switch that lets a
-- team owner require it of everyone the team admitted.
-- Helper: api/_lib/account-mfa.js. Endpoint: api/auth/mfa/[action].js.
-- Pages: /settings (Security), /login/verify.
-- Idempotent and additive.

create table if not exists user_mfa (
	user_id         uuid        primary key references users(id) on delete cascade,
	-- base32 TOTP secret sealed with secret-box (AES-256-GCM); never stored clear.
	secret_enc      text        not null,
	-- null while enrolment waits for the first correct code.
	enabled_at      timestamptz,
	-- The last accepted time step. Codes at or before it are refused (replay).
	last_used_step  bigint      not null default 0,
	created_at      timestamptz not null default now(),
	updated_at      timestamptz not null default now()
);

create table if not exists user_mfa_recovery_codes (
	id          uuid        primary key default gen_random_uuid(),
	user_id     uuid        not null references users(id) on delete cascade,
	-- sha256 of the normalised code; the code itself is shown once and never stored.
	code_hash   text        not null,
	used_at     timestamptz,
	created_at  timestamptz not null default now()
);
create index if not exists user_mfa_recovery_codes_user_idx on user_mfa_recovery_codes (user_id) where used_at is null;

-- mfa_pending: the first factor passed but the second has not. getSessionUser
-- ignores such a session; /api/auth/mfa/verify replaces it with a full one.
-- mfa_verified_at: when this session passed a second factor (an authenticator
-- code, a recovery code, or Microsoft Entra MFA reported in the sign-in token).
alter table sessions add column if not exists mfa_pending boolean not null default false;
alter table sessions add column if not exists mfa_attempts integer not null default 0;
alter table sessions add column if not exists mfa_verified_at timestamptz;

-- Team owners can require two-step verification of the people a team admits.
alter table teams add column if not exists require_mfa boolean not null default false;
