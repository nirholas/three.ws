begin;

-- Supply-chain scan of marketplace skills (api/_lib/skill-supply-scan.js).
--
-- A skill row may now carry its manifest and handlers.js beside the prose
-- (`content`) and tool list (`schema_json`) it already had. Every publish and
-- every edit is scanned; the verdict, findings and scanner version are stored
-- so the publish UI, moderators and rescans all read the same record.
--
--   scan_verdict  clean | review | blocked. NULL means never scanned.
--   review_status none      nothing to review (clean)
--                 pending   verdict was `review`; held until a moderator decides
--                 approved  a moderator released it
--                 rejected  a moderator declined it, or the verdict is `blocked`
--
-- A row is public only while it is clean or approved. The scanner and the
-- moderation endpoint are the only writers of is_public = true for a held row.

alter table marketplace_skills
	add column if not exists manifest jsonb,
	add column if not exists handlers_src text,
	add column if not exists scan_verdict text,
	add column if not exists scan_findings jsonb not null default '[]'::jsonb,
	add column if not exists scan_version text,
	add column if not exists scanned_at timestamptz,
	add column if not exists review_status text not null default 'none',
	add column if not exists reviewed_by uuid references users(id) on delete set null,
	add column if not exists reviewed_at timestamptz,
	add column if not exists review_note text;

do $$ begin
	alter table marketplace_skills
		add constraint marketplace_skills_scan_verdict_check
		check (scan_verdict is null or scan_verdict in ('clean', 'review', 'blocked'));
exception when duplicate_object then null; end $$;

do $$ begin
	alter table marketplace_skills
		add constraint marketplace_skills_review_status_check
		check (review_status in ('none', 'pending', 'approved', 'rejected'));
exception when duplicate_object then null; end $$;

create index if not exists marketplace_skills_review_queue
	on marketplace_skills (scanned_at desc) where review_status = 'pending';

commit;
