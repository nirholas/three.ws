-- Agents are now public by default so newly-created agents are reachable
-- immediately by their owner-share links and public listings. Every INSERT
-- path in api/ omits is_public, so changing the column default is enough
-- to fix new rows; existing rows are backfilled because the prior false
-- default was effectively a bug — there is no UI to opt agents into private.
--
-- On databases that predate the original CREATE TABLE definition, is_public
-- never landed (it was only in the inline create, not an additive migration).
-- Add it here with the intended default in one step.

alter table agent_identities
    add column if not exists is_public boolean not null default true;

alter table agent_identities alter column is_public set default true;

update agent_identities
   set is_public = true
 where is_public = false
   and deleted_at is null;
