-- Forge storage purges: bucket objects a deleted creation still owes.
--
-- Deleting a forge creation removes its bucket objects first, then the row. When
-- object storage itself is down (from 2026-11-15 R2 rejected the production
-- credential with 401 on every signed call), refusing the delete left the model
-- public and blocked every owner delete and takedown (issue #639). Now the row
-- comes down regardless and each object storage could not delete lands here;
-- /api/cron/forge-storage-purge retries until storage accepts, and /cdn/ refuses
-- to serve anything still listed, so a removed model stops being served from
-- three.ws the moment its row is gone.
--
-- target is a bucket key (kind 'object') or a key prefix (kind 'prefix') whose
-- listing failed too, swept in full once listing works again. creation_id has
-- no foreign key: the row it belonged to is already deleted.

create table if not exists forge_storage_purges (
	target          text primary key,
	kind            text not null default 'object'
		check (kind in ('object', 'prefix')),
	creation_id     uuid,
	attempts        integer not null default 0,
	last_error      text,
	created_at      timestamptz not null default now(),
	last_attempt_at timestamptz,
	purged_at       timestamptz
);

create index if not exists forge_storage_purges_pending_idx
	on forge_storage_purges (created_at)
	where purged_at is null;
