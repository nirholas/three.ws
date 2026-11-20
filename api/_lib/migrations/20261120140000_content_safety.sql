-- Content safety: the pre-publication screen for public Forge listings.
--
-- A model becomes public only after api/_lib/content-safety.js clears its prompt
-- and preview render. forge_creations carries the verdict; content_safety_reviews
-- is the append-only audit trail (automatic verdicts and admin decisions).
--
--   safety_status       null     never screened (private/unlisted models, and rows
--                                that predate the screen until the sweep reaches them)
--                       pending  a publish was requested, screening has not answered
--                       clear    screened and clean (or an admin approved it)
--                       held     screening could not answer within the deadline;
--                                waits for an admin
--                       blocked  screening returned an unsafe verdict; forced private
--   publish_requested_at the maker asked for public; the sweep promotes it the
--                       moment it is cleared, so an outage delays but never loses it
--
-- subject_id carries no foreign key: a review row is evidence and must outlive
-- the creation it judged, including after a takedown deletes that creation.

alter table forge_creations add column if not exists safety_status text
	check (safety_status in ('pending', 'clear', 'held', 'blocked'));
alter table forge_creations add column if not exists safety_checked_at timestamptz;
alter table forge_creations add column if not exists publish_requested_at timestamptz;

-- The sweep's two scans: requested-but-not-yet-public, and public-but-never-screened.
create index if not exists forge_creations_publish_requested_idx
	on forge_creations (publish_requested_at)
	where publish_requested_at is not null;

create index if not exists forge_creations_safety_unscreened_idx
	on forge_creations (created_at desc)
	where safety_status is null and status = 'done' and (visibility is null or visibility = 'public');

create index if not exists forge_creations_safety_attention_idx
	on forge_creations (safety_checked_at desc)
	where safety_status in ('held', 'blocked');

create table if not exists content_safety_reviews (
	id          uuid primary key default gen_random_uuid(),
	subject     text not null default 'forge_creation',
	subject_id  uuid not null,
	verdict     text not null check (verdict in ('clear', 'blocked', 'undecided')),
	categories  text[] not null default '{}',
	csam        boolean not null default false,
	signals     jsonb,
	models      text[] not null default '{}',
	reviewer    text not null default 'auto',
	note        text,
	created_at  timestamptz not null default now()
);

create index if not exists content_safety_reviews_subject_idx
	on content_safety_reviews (subject, subject_id, created_at desc);

create index if not exists content_safety_reviews_csam_idx
	on content_safety_reviews (created_at desc) where csam;
