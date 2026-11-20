-- Forge removal requests: the takedown path for a published 3D model when the
-- person asking cannot prove ownership with a forge credential (issue #639).
--
-- Owners normally delete their own model (DELETE /api/forge-creation with the
-- browser id, the signed-in account, or the creation's manage token). This table
-- is for everyone else: a maker who lost every credential, a rights holder whose
-- character or artwork was uploaded by someone else, or a person whose likeness
-- was turned into a model. Anyone can file one (POST /api/forge-removal-request);
-- a platform admin reviews it at /admin/forge-removals and either removes the
-- model (the same full delete an owner gets) or dismisses the request.
--
-- creation_id deliberately has no foreign key: the row is the audit record of a
-- takedown and must outlive the creation it removed.

create table if not exists forge_removal_requests (
	id               uuid primary key default gen_random_uuid(),
	creation_id      uuid not null,
	reason           text not null
		check (reason in ('my_content', 'copyright', 'likeness', 'harmful', 'other')),
	details          text,
	contact          text,
	reporter_user_id uuid,
	reporter_key     text not null,
	status           text not null default 'open'
		check (status in ('open', 'removed', 'dismissed')),
	resolution       text,
	reviewed_by      text,
	reviewed_at      timestamptz,
	created_at       timestamptz not null default now()
);

create index if not exists forge_removal_requests_status_created_idx
	on forge_removal_requests (status, created_at desc);

create index if not exists forge_removal_requests_creation_idx
	on forge_removal_requests (creation_id);

-- One open request per reporter per model: a double submit or an impatient
-- retry keeps the first instead of stacking duplicates in the queue.
create unique index if not exists forge_removal_requests_open_once
	on forge_removal_requests (creation_id, reporter_key)
	where status = 'open';
