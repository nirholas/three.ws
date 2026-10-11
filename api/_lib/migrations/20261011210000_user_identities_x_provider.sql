-- Migration: allow 'x' as a user_identities sign-in provider alongside google.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261011210000_user_identities_x_provider.sql
-- Idempotent.
--
-- user_identities (20260922190000_account_social_sso.sql) only allowed
-- provider='google', so an X user had no way to sign in with X even though
-- api/auth/x/[action].js already runs the OAuth2 client for connecting an
-- account to post as it. Widening the check constraint lets the new `login`
-- action in that file link and sign in through the same generic
-- api/_lib/identities.js code google already uses.

alter table user_identities drop constraint if exists user_identities_provider_check;
alter table user_identities add constraint user_identities_provider_check
	check (provider in ('google', 'x'));
