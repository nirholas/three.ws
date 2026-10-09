-- Migration: ledger of creations the X mention bot made that a person claimed.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261009213000_x_creation_claims.sql
-- Idempotent.
--
-- A creation made from an X mention belongs to the system bot account
-- (users.service_account, email x-mentions@forge.three.ws, created on first
-- use by api/_lib/x-mention-make.js ensureBotUser, no credentials) and carries
-- forge_creations.x_author_id until the author links the same X account. The
-- move to that user writes one row here: which creation, which X author, which
-- user, and which path did it (the OAuth link, the /x/claim page, or the bot
-- handing a fresh creation to an author who had already linked).

create table if not exists x_creation_claims (
	id           bigserial   primary key,
	creation_id  uuid        not null,
	x_author_id  text        not null,
	user_id      uuid        not null references users(id) on delete cascade,
	source       text        not null check (source in ('link', 'claim_page', 'mention')),
	claimed_at   timestamptz not null default now(),
	unique (creation_id)
);

create index if not exists x_creation_claims_user_idx on x_creation_claims (user_id, claimed_at desc);
