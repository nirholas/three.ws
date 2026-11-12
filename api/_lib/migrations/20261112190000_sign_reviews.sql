-- Native-signer review of sign language packs (src/sign-packs/).
--
-- A sign in any pack but ASL is served only after enough distinct granted
-- reviewers approved its exact content hash (src/sign-packs/review.js). These
-- two tables are the live review workspace behind /sign-review and
-- /api/sign-review/*; scripts/export-sign-reviews.mjs writes the approvals into
-- the committed ledger that decides what is served.

create table if not exists sign_reviewers (
	user_id          uuid        not null references users(id) on delete cascade,
	pack             text        not null check (pack ~ '^[a-z]{3}$'),
	display_name     text        not null check (char_length(display_name) between 1 and 80),
	credential_note  text        check (credential_note is null or char_length(credential_note) <= 500),
	granted_by       uuid        references users(id) on delete set null,
	created_at       timestamptz not null default now(),
	revoked_at       timestamptz,
	primary key (user_id, pack)
);

create index if not exists sign_reviewers_pack_idx on sign_reviewers (pack) where revoked_at is null;

create table if not exists sign_reviews (
	id            bigserial   primary key,
	pack          text        not null check (pack ~ '^[a-z]{3}$'),
	sign_key      text        not null check (sign_key ~ '^[A-Z0-9]{1,40}$'),
	content_hash  text        not null check (content_hash ~ '^[0-9a-f]{64}$'),
	reviewer_id   uuid        not null references users(id) on delete cascade,
	verdict       text        not null check (verdict in ('approve', 'reject', 'needs_change')),
	note          text        check (note is null or char_length(note) <= 2000),
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now(),
	unique (pack, sign_key, content_hash, reviewer_id)
);

create index if not exists sign_reviews_pack_sign_idx on sign_reviews (pack, sign_key);
