-- three.ws Forge for Supabase: a table where inserting a prompt produces a
-- textured 3D model (GLB) in Supabase Storage.
--
-- A signed-in user inserts { prompt, tier }. The three-ws-forge Edge Function
-- claims the row, submits it to three.ws Forge, polls the job, copies the GLB
-- into the private `three-ws-models` bucket under <user id>/<row id>.glb and
-- marks the row done. Every step is a row update, so the client follows
-- progress over Realtime with no extra API.
--
-- Status flow: queued -> submitting -> generating -> storing -> done
--              (any active state) -> failed
-- A sweep holds a row through `lease_until`, so concurrent sweeps (the insert
-- trigger and the per-minute cron) never work the same row twice, and a sweep
-- that dies mid-step frees its rows when the lease runs out.

create table if not exists public.three_ws_models (
	id uuid primary key default gen_random_uuid(),
	user_id uuid default auth.uid() references auth.users (id) on delete cascade,
	prompt text not null check (char_length(btrim(prompt)) between 3 and 600),
	tier text not null default 'standard' check (tier in ('draft', 'standard', 'high')),
	status text not null default 'queued'
		check (status in ('queued', 'submitting', 'generating', 'storing', 'done', 'failed')),
	forge_job_id text,
	backend text,
	source_glb_url text,
	storage_path text,
	preview_image_url text,
	error_code text,
	error text,
	attempts integer not null default 0,
	next_attempt_at timestamptz not null default now(),
	lease_until timestamptz,
	created_at timestamptz not null default now(),
	-- When three.ws accepted the job; the age limit counts from here, so time
	-- spent waiting for a quota reset never times a row out.
	submitted_at timestamptz,
	updated_at timestamptz not null default now(),
	completed_at timestamptz
);

comment on table public.three_ws_models is
	'three.ws Forge: insert a prompt, get a GLB in the three-ws-models bucket. Worked by the three-ws-forge Edge Function.';

create index if not exists three_ws_models_user_created_idx
	on public.three_ws_models (user_id, created_at desc);
create index if not exists three_ws_models_active_idx
	on public.three_ws_models (next_attempt_at)
	where status in ('queued', 'submitting', 'generating', 'storing');

create or replace function public.three_ws_models_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

drop trigger if exists three_ws_models_touch on public.three_ws_models;
create trigger three_ws_models_touch
	before update on public.three_ws_models
	for each row execute function public.three_ws_models_touch();

-- How many unfinished models one user may have at once. Every model spends
-- generations from the project's three.ws key, so one user cannot queue a
-- thousand. Replace this function to change the cap.
create or replace function public.three_ws_max_active_per_user()
returns integer
language sql
immutable
set search_path = ''
as $$ select 3 $$;

create or replace function public.three_ws_models_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	active integer;
	cap integer := public.three_ws_max_active_per_user();
begin
	if new.user_id is null then
		return new;
	end if;
	select count(*) into active
	from public.three_ws_models
	where user_id = new.user_id
		and status in ('queued', 'submitting', 'generating', 'storing');
	if active >= cap then
		raise exception 'You already have % models generating. Wait for one to finish, then try again.', active
			using errcode = 'P0001', hint = 'three_ws_active_limit';
	end if;
	return new;
end;
$$;

drop trigger if exists three_ws_models_guard_insert on public.three_ws_models;
create trigger three_ws_models_guard_insert
	before insert on public.three_ws_models
	for each row execute function public.three_ws_models_guard_insert();

-- Row level security: a user sees and deletes only their own rows, and may
-- insert only the prompt and tier. Status, URLs and errors are written by the
-- Edge Function with the service role.
alter table public.three_ws_models enable row level security;

revoke all on public.three_ws_models from public, anon, authenticated;
grant select, delete on public.three_ws_models to authenticated;
grant insert (prompt, tier) on public.three_ws_models to authenticated;
grant all on public.three_ws_models to service_role;

drop policy if exists "three_ws_models read own" on public.three_ws_models;
create policy "three_ws_models read own" on public.three_ws_models
	for select to authenticated
	using ((select auth.uid()) = user_id);

drop policy if exists "three_ws_models insert own" on public.three_ws_models;
create policy "three_ws_models insert own" on public.three_ws_models
	for insert to authenticated
	with check ((select auth.uid()) = user_id);

drop policy if exists "three_ws_models delete own" on public.three_ws_models;
create policy "three_ws_models delete own" on public.three_ws_models
	for delete to authenticated
	using ((select auth.uid()) = user_id);

-- Claim up to max_rows rows that are due, leasing each for lease_seconds.
-- A queued row moves to submitting; generating and storing rows keep their
-- status. Rows another sweep holds are skipped, never waited on.
create or replace function public.three_ws_claim_models(max_rows integer default 4, lease_seconds integer default 150)
returns setof public.three_ws_models
language sql
security definer
set search_path = ''
as $$
	with picked as (
		select id
		from public.three_ws_models
		where status in ('queued', 'submitting', 'generating', 'storing')
			and next_attempt_at <= now()
			and (lease_until is null or lease_until < now())
		order by next_attempt_at, created_at
		limit greatest(1, least(max_rows, 25))
		for update skip locked
	)
	update public.three_ws_models m
	set status = case when m.status = 'queued' then 'submitting' else m.status end,
		lease_until = now() + make_interval(secs => greatest(30, least(lease_seconds, 600)))
	from picked
	where m.id = picked.id
	returning m.*;
$$;

-- Seconds until the next unleased active row is due (0 when one is due now),
-- or null when nothing is waiting. Lets a sweep sleep instead of spinning.
create or replace function public.three_ws_next_due_seconds()
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
	select case
		when due is null then null
		else greatest(0, extract(epoch from due - now()))::double precision
	end
	from (
		select min(greatest(next_attempt_at, coalesce(lease_until, next_attempt_at))) as due
		from public.three_ws_models
		where status in ('queued', 'submitting', 'generating', 'storing')
	) pending;
$$;

revoke all on function public.three_ws_claim_models(integer, integer) from public, anon, authenticated;
revoke all on function public.three_ws_next_due_seconds() from public, anon, authenticated;
grant execute on function public.three_ws_claim_models(integer, integer) to service_role;
grant execute on function public.three_ws_next_due_seconds() to service_role;

-- Private bucket for the finished GLBs. A user reads (and may delete) only
-- objects under their own <user id>/ folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('three-ws-models', 'three-ws-models', false, 52428800, array['model/gltf-binary'])
on conflict (id) do nothing;

drop policy if exists "three-ws-models read own" on storage.objects;
create policy "three-ws-models read own" on storage.objects
	for select to authenticated
	using (bucket_id = 'three-ws-models' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "three-ws-models delete own" on storage.objects;
create policy "three-ws-models delete own" on storage.objects
	for delete to authenticated
	using (bucket_id = 'three-ws-models' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Stream row changes to clients over Realtime (RLS still applies).
do $$
begin
	if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
		and not exists (
			select 1 from pg_publication_tables
			where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'three_ws_models'
		)
	then
		alter publication supabase_realtime add table public.three_ws_models;
	end if;
end;
$$;
