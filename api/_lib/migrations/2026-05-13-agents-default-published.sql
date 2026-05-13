-- Agents are now published by default so newly-created agents appear in the
-- marketplace immediately. The prior false default (from 2026-04-29) meant
-- every signup produced an unreachable draft until the user manually clicked
-- publish, which contradicts the rest of the visibility model (is_public,
-- avatar visibility) that already defaults to public.
--
-- Flip the column default and backfill non-deleted rows that have never been
-- published. Rows that were explicitly unpublished are left alone — only ones
-- that were waiting on the old default get pulled forward.

alter table agent_identities alter column is_published set default true;

update agent_identities
   set is_published = true,
       published_at = coalesce(published_at, now())
 where is_published = false
   and deleted_at is null
   and published_at is null;
