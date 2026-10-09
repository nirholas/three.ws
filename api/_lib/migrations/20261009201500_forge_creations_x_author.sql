-- Migration: remember which X account asked the mention bot for a creation.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261009201500_forge_creations_x_author.sql
-- Idempotent.
--
-- A creation the @-mention bot makes belongs to the system bot account
-- (users.service_account) until its author links their X profile. The X
-- author's numeric id is the key that later claim step uses: when someone
-- links an X profile whose provider_uid equals x_author_id, the creation can
-- move to them. NULL for every creation made on the site.

alter table forge_creations
	add column if not exists x_author_id text;

create index if not exists idx_forge_creations_x_author
	on forge_creations (x_author_id)
	where x_author_id is not null;
