-- Admin two-factor authentication (TOTP, RFC 6238).
-- Microsoft 365 Certification OS 16: MFA on every administrative interface.
-- Helper: api/_lib/admin-mfa.js. Endpoint: api/admin/mfa.js. Page: /admin/mfa.
-- Idempotent and additive.

create table if not exists admin_mfa (
    user_id          uuid primary key references users(id) on delete cascade,
    secret_enc       text not null,
    confirmed_at     timestamptz,
    last_used_step   bigint not null default 0,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

alter table sessions add column if not exists mfa_verified_at timestamptz;
